import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  createCanvasNodeExecutionKey,
  getRunExecutionBinding,
  getRunNodeExecutionContext,
  isRunExecutionCancelled,
  registerRunExecutionCancelHandler,
  releaseRunExecutionBinding,
  useRunBusStore,
} from '../stores/runBus';
import { useCanvasStore } from '../stores/canvas';
import { registerTaskCompletionSoundNode } from '../stores/taskCompletionSound';
import {
  appendProjectRunEvent,
  createProjectNodeRun,
  createProjectRunAttempt,
  finalizeProjectNodeRunAttempt,
  persistProjectRunOutputAssets,
  updateProjectNodeRun,
  updateProjectRunAttempt,
} from '../services/api';
import { normalizeRunError } from '../utils/runErrors';
import { captureRunNodeInputSnapshot } from '../utils/runReplay';
import { captureGenerationHistoryInput } from '../utils/generationHistoryCapture';
import { inferRunRecoveryDescriptor } from '../utils/runRecovery';
import {
  createRunNodeLifecycleController,
  executeAfterRunLifecycleBarrier,
  resolveRunExecutionDisposition,
} from '../utils/runLifecycle';
import {
  collectRunOutputAssets,
  extractRunProviderTrace,
  providerTraceAttemptPatch,
} from '../utils/runProviderTrace';
import type { RunNodeLifecycleReporter } from '../types/project';
import { captureHistoryExecution } from '../utils/historyResolvedSeedanceInput';
import type { RunOutputAssetCandidate, RunProviderTrace } from '../utils/runProviderTrace';

export interface RunTriggerInitializationFailureDependencies {
  appendRunEvent: typeof appendProjectRunEvent;
  markDone: (executionNodeId: string, executionToken: string, ok: boolean, error?: string) => unknown;
  clearActiveNodeRun: () => void;
  releaseBinding: () => void;
  forgetToken: () => void;
  reportError: (message: string, error: unknown) => void;
}

export interface RunTriggerInitializationFailureInput {
  executionNodeId: string;
  executionToken: string;
  nodeId: string;
  runId: string | null;
  error: unknown;
}

/**
 * Last-resort containment for failures that happen before the main execution
 * try/finally has been installed. It records run-level evidence when possible,
 * always terminates the execution token, and never leaks a rejected Promise.
 */
export async function containRunTriggerInitializationFailure(
  input: RunTriggerInitializationFailureInput,
  dependencies: RunTriggerInitializationFailureDependencies,
) {
  let message = '未知初始化错误';
  try {
    message = input.error instanceof Error ? input.error.message : String(input.error || message);
  } catch {
    message = '无法读取初始化错误';
  }
  const report = (label: string, error: unknown) => {
    try {
      dependencies.reportError(label, error);
    } catch {
      // Error reporting itself must not revive an unhandled rejection.
    }
  };
  report(`[run-center] execution listener initialization failed: ${message}`, input.error);

  let evidencePersisted = false;
  if (input.runId) {
    try {
      await dependencies.appendRunEvent(input.runId, {
        type: 'node.initialization_failed',
        payload: {
          nodeId: input.nodeId,
          executionToken: input.executionToken,
          error: normalizeRunError(input.error) as unknown as Record<string, unknown>,
        },
      });
      evidencePersisted = true;
    } catch (persistenceError) {
      report('[run-center] initialization failure evidence persistence failed', persistenceError);
    }
  }
  try {
    dependencies.markDone(
      input.executionNodeId,
      input.executionToken,
      false,
      `节点运行初始化失败：${message}`,
    );
  } catch (cleanupError) {
    report('[run-center] failed to mark initialization failure', cleanupError);
  }
  for (const cleanup of [
    dependencies.clearActiveNodeRun,
    dependencies.releaseBinding,
    dependencies.forgetToken,
  ]) {
    try {
      cleanup();
    } catch (cleanupError) {
      report('[run-center] initialization failure cleanup failed', cleanupError);
    }
  }
  return { message, evidencePersisted };
}

/**
 * 节点运行总线监听器
 * 节点在内部调用:`useRunTrigger(id, async () => { await handleGenerate(); })`
 * 每次 triggerRun/triggerRunMany 都为节点签发新的 execution token；完成后仅用捕获的
 * token 回报 markDone。停止前的旧 Promise 即使较晚结束，也不能完成或覆盖新任务。
 *
 * 设计要点:
 * - runFn 通过 ref 保存,避免依赖项导致 effect 反复执行
 * - startedTokensRef 按 token 防重入，避免 React StrictMode 对同一轮重复发起
 * - 同一 nodeId 被连续触发时允许新 token 启动；旧 token 只能归档到原 Run/Attempt
 */
export function useRunTrigger(
  nodeId: string,
  runFn: (() => Promise<void> | void) | ((reporter: RunNodeLifecycleReporter) => Promise<void> | void),
  completionSoundNodeType?: string,
  options: {
    lifecycleAware?: boolean;
    shouldReuseResult?: (nodeData: Record<string, unknown>) => boolean;
    captureHistoryInput?: () => Record<string, unknown>;
    /** Explicit local maintenance, such as installing an engine or refreshing a catalog. */
    nonGeneratingOperation?: () => boolean;
  } = {},
) {
  const { getNodes, getEdges } = useReactFlow();
  const originCanvasIdRef = useRef(useCanvasStore.getState().activeId);
  const executionNodeId = createCanvasNodeExecutionKey(originCanvasIdRef.current, nodeId);
  const executionToken = useRunBusStore((s) => s.executionTokens[executionNodeId] || null);
  const markDone = useRunBusStore((s) => s.markDone);
  const runFnRef = useRef(runFn);
  runFnRef.current = runFn;
  const lifecycleAwareRef = useRef(Boolean(options.lifecycleAware));
  lifecycleAwareRef.current = Boolean(options.lifecycleAware);
  const shouldReuseResultRef = useRef(options.shouldReuseResult);
  shouldReuseResultRef.current = options.shouldReuseResult;
  const captureHistoryInputRef = useRef(options.captureHistoryInput);
  captureHistoryInputRef.current = options.captureHistoryInput;
  const nonGeneratingOperationRef = useRef(options.nonGeneratingOperation);
  nonGeneratingOperationRef.current = options.nonGeneratingOperation;
  const startedTokensRef = useRef(new Set<string>());

  useEffect(
    () => registerTaskCompletionSoundNode(executionNodeId, completionSoundNodeType),
    [executionNodeId, completionSoundNodeType],
  );

  useEffect(() => {
    if (!executionToken || startedTokensRef.current.has(executionToken)) return;
    startedTokensRef.current.add(executionToken);
    const capturedExecutionToken = executionToken;
    void (async () => {
      const binding = getRunExecutionBinding(executionNodeId, capturedExecutionToken);
      const executionAbortController = new AbortController();
      const runContext = binding?.runContext || null;
      const runId = runContext?.runId || null;
      // Capture the operation once. Mutable node data cannot opt a generation
      // into the zero-output maintenance path after it has started.
      const nonGeneratingOperation = nonGeneratingOperationRef.current?.() === true;
      const executionContext = binding?.nodeContext || getRunNodeExecutionContext(nodeId);
      let nodeRunId: string | undefined;
      let attemptId: string | undefined;
      let providerSubmissionKey: string | undefined;
      let providerSubmissionState = '';
      let providerSubmissionExpected = false;
      let executionCallbackStarted = false;
      let historyExecution: ReturnType<typeof captureHistoryExecution<typeof runFn>>;
      let reusedExistingResult = false;
      let terminalWrite: Promise<void> | null = null;
      let acceptLifecycleEvents = true;
      let providerSubmittedRecorded = false;
      let providerResponseRecorded = false;
      let activeProviderTrace: RunProviderTrace = {};
      let unregisterCancelHandler: () => void = () => undefined;
      let resolvePersistenceReady: () => void = () => undefined;
      const persistenceReady = new Promise<void>((resolve) => {
        resolvePersistenceReady = resolve;
      });
      const rememberProviderTrace = (trace: RunProviderTrace): RunProviderTrace => {
        activeProviderTrace = {
          ...activeProviderTrace,
          ...trace,
          ...(activeProviderTrace.usage || trace.usage
            ? { usage: { ...(activeProviderTrace.usage || {}), ...(trace.usage || {}) } }
            : {}),
        };
        return activeProviderTrace;
      };
      const hasProviderIdentity = (trace: RunProviderTrace) => Boolean(
        trace.provider || trace.model || trace.upstreamTaskId || trace.requestId,
      );
      const attemptTimestampsForEvent = (type: string, at: number): Record<string, number> => {
        if (type === 'provider.request') return { requestedAt: at };
        if (type === 'provider.submitted') return { submittedAt: at };
        if (type === 'provider.polling') return { lastPolledAt: at };
        if (type === 'provider.response') return { respondedAt: at };
        return {};
      };
      const providerSubmissionMetadata = (
        state: string,
        payload: Record<string, unknown> = {},
      ): Record<string, unknown> => {
        providerSubmissionState = state;
        return {
          providerSubmission: {
            version: 1,
            slot: 'primary',
            submissionKey: providerSubmissionKey || null,
            state,
            expectedOutput: providerSubmissionExpected,
            ...payload,
          },
        };
      };
      const lifecycle = createRunNodeLifecycleController({
        runContext,
        executionToken: capturedExecutionToken,
        signal: executionAbortController.signal,
        executionEvidence: () => ({ nodeRunId, attemptId, providerSubmissionKey }),
        basePayload: {
          nodeId: executionContext?.runNodeId || nodeId,
          contextId: runContext?.contextId || null,
        },
        sink: {
          write: async (type, payload) => {
            if (!runId || !nodeRunId || !acceptLifecycleEvents) return;
            try {
              if (type === 'node.polling') {
                const trace = rememberProviderTrace(extractRunProviderTrace(payload));
                const recovery = inferRunRecoveryDescriptor(payload);
                if (hasProviderIdentity(trace) && !providerSubmittedRecorded) {
                  await appendProjectRunEvent(runId, {
                    nodeRunId,
                    type: 'provider.submitted',
                    payload: { ...trace, observedFrom: 'first-poll', executionToken: capturedExecutionToken },
                  });
                  providerSubmittedRecorded = true;
                }
                const attemptPatch = providerTraceAttemptPatch(trace);
                await updateProjectNodeRun(runId, nodeRunId, { status: 'polling', eventPayload: payload });
                if (attemptId) {
                  await updateProjectRunAttempt(runId, nodeRunId, attemptId, {
                    ...attemptPatch,
                    status: 'polling',
                    timestamps: { lastPolledAt: Date.now() },
                    metadata: { lastProviderEvent: 'provider.polling', ...(recovery ? { recovery } : {}) },
                  });
                }
                if (hasProviderIdentity(trace)) {
                  await appendProjectRunEvent(runId, {
                    nodeRunId,
                    type: 'provider.polling',
                    payload,
                  });
                }
              } else if (type === 'node.output' && nonGeneratingOperation) {
                if (!Array.isArray(payload.assets) || payload.assets.length !== 0 || payload.outputCount !== 0) {
                  throw new Error('NON_GENERATING_OUTPUT_INVALID');
                }
                const { assets: _assets, ...eventPayload } = payload;
                // No artifact was generated. Do not forge the host-only
                // node.output event or rearchive previously selected media.
                await appendProjectRunEvent(runId, { nodeRunId, type: 'node.progress', payload: {
                  ...eventPayload, phase: 'completed-without-output', nonGeneratingOperation: true,
                } });
              } else if (type === 'node.output' && Array.isArray(payload.assets) && payload.assets.length > 0) {
                const { assets, ...eventPayload } = payload;
                await persistProjectRunOutputAssets(runId, nodeRunId, {
                  attemptId,
                  outputs: assets as RunOutputAssetCandidate[],
                  eventPayload,
                });
                if (attemptId && providerSubmissionExpected) {
                  await updateProjectRunAttempt(runId, nodeRunId, attemptId, {
                    metadata: providerSubmissionMetadata('verified', {
                      verifiedAt: Date.now(),
                      outputCount: assets.length,
                    }),
                  });
                }
              } else if (type.startsWith('provider.')) {
                const trace = rememberProviderTrace(extractRunProviderTrace(
                  type === 'provider.usage' && !payload.usage ? { ...payload, usage: payload } : payload,
                ));
                const now = Date.now();
                if (type !== 'provider.usage' && hasProviderIdentity(trace)) {
                  providerSubmissionExpected = true;
                }
                const attemptPatch = providerTraceAttemptPatch(trace);
                const recovery = type === 'provider.submitted' || type === 'provider.polling'
                  ? inferRunRecoveryDescriptor(payload)
                  : null;
                await appendProjectRunEvent(runId, { nodeRunId, type, payload });
                if (attemptId) {
                  const submissionMetadata = type === 'provider.request'
                    ? providerSubmissionMetadata('ambiguous', {
                        dispatchStartedAt: now,
                        provider: trace.provider || null,
                        model: trace.model || null,
                      })
                    : type === 'provider.submitted'
                      ? providerSubmissionMetadata('submitted', {
                          submittedAt: now,
                          provider: trace.provider || null,
                          model: trace.model || null,
                          upstreamTaskId: trace.upstreamTaskId || null,
                          requestId: trace.requestId || null,
                        })
                      : type === 'provider.response'
                        ? providerSubmissionMetadata(
                            providerSubmissionState === 'verified' ? 'verified' : 'responded',
                            {
                              respondedAt: now,
                              provider: trace.provider || null,
                              model: trace.model || null,
                              upstreamTaskId: trace.upstreamTaskId || null,
                              requestId: trace.requestId || null,
                            },
                          )
                        : {};
                  await updateProjectRunAttempt(runId, nodeRunId, attemptId, {
                    ...attemptPatch,
                    timestamps: attemptTimestampsForEvent(type, now),
                    metadata: {
                      lastProviderEvent: type,
                      ...(recovery ? { recovery } : {}),
                      ...submissionMetadata,
                    },
                  });
                }
                if (type === 'provider.submitted') providerSubmittedRecorded = true;
                if (type === 'provider.response') providerResponseRecorded = true;
              } else {
                await appendProjectRunEvent(runId, { nodeRunId, type, payload });
              }
            } catch (error) {
              console.warn(`[run-center] failed to persist ${type}:`, error);
              if (!executionCallbackStarted
                || type === 'node.output'
                || type === 'provider.request'
                || type === 'provider.submitted') throw error;
            }
          },
        },
      });

      const disposition = () => resolveRunExecutionDisposition(
        useRunBusStore.getState().executionTokens[executionNodeId],
        capturedExecutionToken,
        isRunExecutionCancelled(capturedExecutionToken),
      );

      const persistTerminal = (
        status: 'succeeded' | 'failed' | 'stopped',
        error?: unknown,
      ) => {
        if (terminalWrite) return terminalWrite;
        terminalWrite = (async () => {
          const finishedAt = Date.now();
          const normalizedError = status === 'succeeded'
            ? null
            : status === 'stopped'
              ? {
                  kind: 'cancelled',
                  message: error instanceof Error ? error.message : String(error || '节点运行已停止'),
                  code: 'RUN_EXECUTION_STOPPED',
                  retryable: true,
                }
              : normalizeRunError(error) as unknown as Record<string, unknown>;
          const terminalNodeData = getNodes().find((node) => node.id === nodeId)?.data as Record<string, unknown> | undefined;
          const terminalTrace = rememberProviderTrace(extractRunProviderTrace(terminalNodeData));
          if (!nonGeneratingOperation && !reusedExistingResult && hasProviderIdentity(terminalTrace) && !providerResponseRecorded) {
            await lifecycle.reporter.providerResponse({
              ...terminalTrace,
              status,
              ...(normalizedError ? { error: normalizedError } : {}),
            });
          }
          try {
            await lifecycle.flush();
          } catch (lifecyclePersistenceError) {
            // A successful run is not allowed to outrun its authoritative
            // output evidence. Failed/stopped runs still need a durable
            // terminal record even when an earlier output write failed.
            if (status === 'succeeded') throw lifecyclePersistenceError;
          }
          acceptLifecycleEvents = false;
          if (!runId || !nodeRunId || !attemptId) return;
          let lastPersistenceError: unknown = null;
          for (let writeAttempt = 0; writeAttempt < 3; writeAttempt += 1) {
            try {
              await finalizeProjectNodeRunAttempt(runId, nodeRunId, attemptId, {
                status,
                timestamps: { finishedAt },
                error: normalizedError,
                eventPayload: {
                  executionToken: capturedExecutionToken,
                  contextId: runContext?.contextId || null,
                },
              });
              return;
            } catch (persistenceError) {
              lastPersistenceError = persistenceError;
              if (writeAttempt < 2) {
                await new Promise<void>((resolve) => window.setTimeout(resolve, 120 * (writeAttempt + 1)));
              }
            }
          }
          throw new Error(
            `无法原子持久化 NodeRun/Attempt 终态：${lastPersistenceError instanceof Error ? lastPersistenceError.message : String(lastPersistenceError)}`,
          );
        })();
        return terminalWrite;
      };

      unregisterCancelHandler = registerRunExecutionCancelHandler(
        executionNodeId,
        capturedExecutionToken,
        async () => {
          executionAbortController.abort(new Error('节点运行已由用户停止'));
          await persistenceReady;
          await persistTerminal('stopped', new Error('节点运行已由用户停止'));
        },
      );

      try {
        // Every Provider-facing execution must be anchored to a durable Run.
        // Continuing without it would create an untraceable operation that the
        // E4 Run/NodeRun/Attempt diagnosis contract cannot cite.
        if (!runId) {
          throw new Error('缺少持久化 Run 上下文，已停止调用 Provider');
        }
        try {
          const inputSnapshot = captureRunNodeInputSnapshot(getNodes(), getEdges(), nodeId);
          historyExecution = captureHistoryExecution(runFnRef.current, captureHistoryInputRef.current);
          const historyInputSnapshot = captureGenerationHistoryInput(getNodes(), getEdges(), nodeId, historyExecution?.resolvedInput);
          const nodeDataAtStart = getNodes().find((node) => node.id === nodeId)?.data as Record<string, unknown> | undefined;
          reusedExistingResult = Boolean(
            nodeDataAtStart
            && shouldReuseResultRef.current?.(nodeDataAtStart),
          );
          const nodeRun = await createProjectNodeRun(runId, {
            nodeId: executionContext?.runNodeId || nodeId,
            parentNodeRunId: executionContext?.parentNodeRunId,
            originalNodeId: executionContext?.originalNodeId,
            definitionId: executionContext?.definitionId,
            definitionVersion: executionContext?.definitionVersion,
            subflowPath: executionContext?.subflowPath || [],
            status: 'queued',
            inputSnapshot: inputSnapshot as unknown as Record<string, unknown>,
            historyInputSnapshot: historyInputSnapshot as unknown as Record<string, unknown>,
          });
          nodeRunId = nodeRun.id;
          useRunBusStore.getState().setActiveNodeRun(executionNodeId, nodeRunId, capturedExecutionToken);
          const snapshot = inputSnapshot.replayable
            ? inputSnapshot.node.data
            : executionContext?.inputSnapshot || {};
          const initialTrace = nonGeneratingOperation ? {} : rememberProviderTrace(extractRunProviderTrace(snapshot));
          const generatedAttemptId = `attempt-${typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
          const generatedAttemptEntityUid = typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID()
            : null;
          providerSubmissionKey = generatedAttemptEntityUid || generatedAttemptId;
          providerSubmissionExpected = hasProviderIdentity(initialTrace);
          providerSubmissionState = providerSubmissionExpected ? 'prepared' : '';
          const attempt = await createProjectRunAttempt(runId, nodeRun.id, {
            id: generatedAttemptId,
            ...(generatedAttemptEntityUid ? { entityUid: generatedAttemptEntityUid } : {}),
            ...(reusedExistingResult
              ? { metadata: { reusedResult: true, source: 'existing-node-output' } }
              : {
                  ...providerTraceAttemptPatch(initialTrace),
                  ...(providerSubmissionExpected
                    ? {
                        metadata: providerSubmissionMetadata('prepared', {
                          preparedAt: Date.now(),
                          provider: initialTrace.provider || null,
                          model: initialTrace.model || null,
                        }),
                      }
                    : {}),
                }),
            status: 'running',
            timestamps: { queuedAt: Date.now(), startedAt: Date.now() },
          });
          attemptId = attempt.id;
          await updateProjectNodeRun(runId, nodeRun.id, {
            status: 'running',
            eventPayload: {
              executionToken: capturedExecutionToken,
              contextId: runContext?.contextId || null,
            },
          });
          if (!reusedExistingResult && (initialTrace.provider || initialTrace.model)) {
            await lifecycle.reporter.providerRequest({ ...initialTrace, phase: 'request' });
          }
        } catch (error) {
          throw new Error(`无法建立持久化 NodeRun/Attempt，已停止调用 Provider：${error instanceof Error ? error.message : String(error)}`);
        }
        resolvePersistenceReady();

        if (disposition() !== 'active') {
          await persistTerminal('stopped', new Error('节点运行在开始前已停止或被新任务替代'));
          markDone(executionNodeId, capturedExecutionToken, false, 'stopped');
          return;
        }

        await executeAfterRunLifecycleBarrier(
          async () => {
            // Keep the first executable callback behind an explicit durable
            // lifecycle write. If this write fails, runFn (and therefore the
            // Provider/ffmpeg call it owns) must remain at zero invocations.
            await lifecycle.reporter.progress({ phase: 'executing', progress: 0 });
            if (!reusedExistingResult && providerSubmissionExpected && runId && nodeRunId && attemptId) {
              await updateProjectRunAttempt(runId, nodeRunId, attemptId, {
                metadata: providerSubmissionMetadata('ambiguous', {
                  dispatchStartedAt: Date.now(),
                  reason: 'provider-call-may-have-side-effect',
                }),
              });
            }
          },
          async () => {
            executionCallbackStarted = true;
            if (reusedExistingResult) {
              await lifecycle.reporter.progress({
                phase: 'reused-existing-output',
                progress: 100,
                reusedResult: true,
              });
              return;
            }
            if (lifecycleAwareRef.current) {
              await ((historyExecution?.run || runFnRef.current) as (reporter: RunNodeLifecycleReporter) => Promise<void> | void)(lifecycle.reporter);
            } else {
              await ((historyExecution?.run || runFnRef.current) as () => Promise<void> | void)();
            }
          },
        );
        if (disposition() !== 'active') {
          await persistTerminal('stopped', new Error('节点运行已停止或被新任务替代'));
          markDone(executionNodeId, capturedExecutionToken, false, 'stopped');
          return;
        }
        const latestNodeData = getNodes().find((node) => node.id === nodeId)?.data as Record<string, unknown> | undefined;
        const latestStatus = String(latestNodeData?.status || latestNodeData?.taskStatus || '').trim().toLowerCase();
        if (!reusedExistingResult && (latestStatus === 'error' || latestStatus === 'failed' || latestStatus === 'failure')) {
          throw new Error(String(latestNodeData?.error || latestNodeData?.failReason || '节点运行失败'));
        }
        if (!nonGeneratingOperation && !reusedExistingResult) {
          const finalTrace = rememberProviderTrace(extractRunProviderTrace(latestNodeData));
          if ((finalTrace.upstreamTaskId || finalTrace.requestId) && !providerSubmittedRecorded) {
            await lifecycle.reporter.providerSubmitted({ ...finalTrace, observedFrom: 'node-result' });
          }
          if (finalTrace.usage && Object.keys(finalTrace.usage).length > 0) {
            await lifecycle.reporter.providerUsage({ ...finalTrace, usage: finalTrace.usage });
          }
          if (hasProviderIdentity(finalTrace) && !providerResponseRecorded) {
            await lifecycle.reporter.providerResponse({ ...finalTrace, status: 'succeeded' });
          }
        }
        if (reusedExistingResult) {
          await lifecycle.reporter.progress({ phase: 'completed', progress: 100, reusedResult: true });
        } else {
          await lifecycle.reporter.progress({ phase: 'completed', progress: 100 });
        }
        if (!lifecycle.outputEmitted()) {
          const assets = nonGeneratingOperation ? [] : collectRunOutputAssets(latestNodeData);
          if (reusedExistingResult) {
            await lifecycle.reporter.output({ status: 'succeeded', outputCount: assets.length, assets, reusedResult: true });
          } else {
            await lifecycle.reporter.output({ status: 'succeeded', outputCount: assets.length, assets });
          }
        }
        await persistTerminal('succeeded');
        markDone(executionNodeId, capturedExecutionToken, true);
      } catch (error: any) {
        resolvePersistenceReady();
        const stopped = disposition() !== 'active';
        let completionError: unknown = error;
        try {
          if (terminalWrite) await terminalWrite;
          else await persistTerminal(stopped ? 'stopped' : 'failed', error);
        } catch (persistenceError) {
          completionError = new Error(
            `节点执行结果无法写入持久证据：${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`,
          );
          console.error('[run-center] terminal evidence persistence failed:', persistenceError);
        }
        markDone(
          executionNodeId,
          capturedExecutionToken,
          false,
          stopped && completionError === error ? 'stopped' : completionError instanceof Error ? completionError.message : String(completionError),
        );
      } finally {
        unregisterCancelHandler();
        useRunBusStore.getState().setActiveNodeRun(executionNodeId, undefined, capturedExecutionToken);
        releaseRunExecutionBinding(executionNodeId, capturedExecutionToken);
        startedTokensRef.current.delete(capturedExecutionToken);
      }
    })()
      .catch(async (initializationError) => {
        let failedRunId: string | null = null;
        try {
          failedRunId = getRunExecutionBinding(executionNodeId, capturedExecutionToken)?.runContext?.runId || null;
        } catch {
          // The containment helper still terminates the visible token below.
        }
        await containRunTriggerInitializationFailure({
          executionNodeId,
          executionToken: capturedExecutionToken,
          nodeId,
          runId: failedRunId,
          error: initializationError,
        }, {
          appendRunEvent: appendProjectRunEvent,
          markDone,
          clearActiveNodeRun: () => useRunBusStore.getState().setActiveNodeRun(executionNodeId, undefined, capturedExecutionToken),
          releaseBinding: () => releaseRunExecutionBinding(executionNodeId, capturedExecutionToken),
          forgetToken: () => startedTokensRef.current.delete(capturedExecutionToken),
          reportError: (message, error) => console.error(message, error),
        });
      })
      .catch((containmentError) => console.error('[run-center] failed to contain listener initialization error', containmentError));
  }, [executionNodeId, executionToken, getEdges, getNodes, nodeId, markDone]);
  // Capture this render's identity, never look up a newer token when clicked.
  return () => {
    const state = useRunBusStore.getState();
    const currentToken = state.executionTokens[executionNodeId] || null;
    if (currentToken !== executionToken) return false;
    // No live token: allow clearing a restored local busy indicator, without
    // inventing a durable stop or reaching a newer execution on another canvas.
    if (!executionToken) return null;
    void state.cancelExecution(executionNodeId, executionToken);
    return true;
  };
}
