import { memo, useCallback, useMemo, useState } from 'react';
import { Handle, Position, useNodeConnections, useNodesData, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { Download, ImagePlus, Loader2, ScanLine, Sparkles } from 'lucide-react';
import { generateImage } from '../../services/generation';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { logBus } from '../../stores/logs';
import {
  CREATIVE_TARGET_NODE_TYPE,
  buildCreativeTargetResult,
  collectCanvasSelectionSummary,
} from '../../utils/canvasCreativeWorkflow';
import { getMediaItemsFromData } from '../../utils/mediaCollection';
import { extractRunProviderTrace } from '../../utils/runProviderTrace';
import {
  createSecondaryProviderAction,
  requestCanvasSecondaryProviderAction,
  resolveSecondaryProviderActionForRun,
  secondaryProviderActionFromNodeData,
  secondaryProviderActionNodePatch,
  type SecondaryProviderActionEnvelope,
} from '../../utils/secondaryProviderAction';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { useUpdateNodeData } from './useUpdateNodeData';
import NodeVisible from '../../i18n/NodeVisible';

function textFromData(data: any): string {
  return String(
    data?.prompt ||
      data?.text ||
      data?.directOutputText ||
      data?.outputText ||
      data?.resultText ||
      '',
  ).trim();
}

function urlsFromNodes(nodes: Array<{ data?: any }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of nodes) {
    for (const item of getMediaItemsFromData(node.data, 'image')) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      out.push(item.url);
    }
  }
  return out.slice(0, 8);
}

function selectedNodesForTarget(targetId: string, nodes: Node[]) {
  return nodes.filter((node) => node.selected && node.id !== targetId);
}

const GenerationTargetNode = ({ id, data, selected }: NodeProps) => {
  const d = (data as any) || {};
  const rf = useReactFlow();
  const update = useUpdateNodeData(id);
  const creativeTargetId = id;
  const [busyMode, setBusyMode] = useState<'replace' | 'keep-version' | null>(null);
  const connections = useNodeConnections({ handleType: 'target' });
  const upstreamNodeData = useNodesData(connections.map((connection) => connection.source));
  const upstreamNodes = useMemo(
    () => upstreamNodeData.map((item) => ({ id: item.id, data: item.data })),
    [upstreamNodeData],
  );
  const upstreamPrompt = useMemo(
    () => upstreamNodes.map((node) => textFromData(node.data)).filter(Boolean).join('\n\n'),
    [upstreamNodes],
  );
  const upstreamImages = useMemo(() => urlsFromNodes(upstreamNodes), [upstreamNodes]);
  const prompt = String(d.prompt || upstreamPrompt || '').trim();
  const resultUrl = String(d.resultUrl || '').trim();
  const aspectRatio = String(d.aspectRatio || '1:1');
  const sizeLevel = String(d.sizeLevel || '1K');
  const status = String(d.status || 'idle');
  const isBusy = status === 'generating' || !!busyMode;

  const executeGenerateAction = useCallback(async (
    action: Extract<SecondaryProviderActionEnvelope, { actionId: 'generation-target.generate' }>,
    reporter: RunNodeLifecycleReporter,
  ) => {
    const mode = action.target;
    const params = action.params;
    let providerRequested = false;
    let providerResponded = false;
    setBusyMode(mode);
    update({ status: 'generating', error: '', prompt: params.prompt });
    try {
      await reporter.providerRequest({
        provider: 'zhenzhen',
        model: params.apiModel,
        actionId: action.actionId,
        actionTarget: action.target,
      });
      providerRequested = true;
      const result = await generateImage({
        model: params.model,
        apiModel: params.apiModel,
        prompt: params.prompt,
        aspectRatio: params.aspectRatio,
        aspect_ratio: params.aspectRatio,
        sizeLevel: params.sizeLevel,
        image_size: params.sizeLevel,
        images: params.images,
        n: 1,
      });
      const urls = Array.isArray(result.urls) ? result.urls.filter(Boolean) : [];
      if (urls.length === 0) throw new Error('生成完成但没有返回图片');
      await reporter.providerResponse({
        provider: 'zhenzhen',
        model: params.apiModel,
        ...extractRunProviderTrace(result),
        status: 'succeeded',
      });
      providerResponded = true;
      const target = rf.getNode(id) || ({
        id: creativeTargetId,
        type: CREATIVE_TARGET_NODE_TYPE,
        position: { x: 0, y: 0 },
        data: d,
      } as Node);
      const built = buildCreativeTargetResult(target, urls, {
        mode,
        sourceNodeIds: params.sourceNodeIds,
        prompt: params.prompt,
      });
      rf.setNodes((prev) => {
        const patched = prev.map((node) =>
          node.id === id
            ? { ...node, data: { ...(node.data as any), ...built.targetPatch } }
            : { ...node, selected: built.outputNode ? false : node.selected }
        );
        return built.outputNode ? [...patched, built.outputNode] : patched;
      });
      await reporter.output({
        status: 'succeeded',
        assets: urls.map((url) => ({ kind: 'image', sourceUrl: url })),
      });
      logBus.success(mode === 'replace' ? '已替换到生成目标框内' : '已在目标框右侧保留一个新版本', '生成目标框');
    } catch (error: any) {
      const message = error?.message || '生成失败';
      update({ status: 'failed', error: message });
      logBus.error(message, '生成目标框');
      if (providerRequested && !providerResponded) {
        await reporter.providerResponse({
          provider: 'zhenzhen',
          model: params.apiModel,
          status: 'failed',
        });
      }
      throw error;
    } finally {
      setBusyMode(null);
    }
  }, [creativeTargetId, d, id, rf, update]);

  const runSecondaryAction = useCallback(async (reporter: RunNodeLifecycleReporter) => {
    const liveData = rf.getNode(id)?.data;
    const action = resolveSecondaryProviderActionForRun({
      nodeId: id,
      nodeType: 'generation-target',
      nodeData: liveData,
      runContext: reporter.runContext,
    });
    if (!action || action.actionId !== 'generation-target.generate') {
      throw new Error('生成目标框缺少已确认的次级 Provider action，已停止调用 Provider');
    }
    try {
      await executeGenerateAction(action, reporter);
    } finally {
      const current = secondaryProviderActionFromNodeData(rf.getNode(id)?.data);
      if (current?.requestId === action.requestId) update(secondaryProviderActionNodePatch(null));
    }
  }, [executeGenerateAction, id, rf, update]);

  useRunTrigger(id, runSecondaryAction, 'image', { lifecycleAware: true });

  const requestGenerateAction = (mode: 'replace' | 'keep-version') => {
    const finalPrompt = prompt.trim();
    if (!finalPrompt) {
      update({ status: 'failed', error: '请先输入提示词，或把文本节点连接到目标框。' });
      return;
    }
    const selectedSummary = collectCanvasSelectionSummary(selectedNodesForTarget(id, rf.getNodes()), {
      viewportAnchor: rf.getNode(id)?.position,
    });
    try {
      const action = createSecondaryProviderAction({
        nodeId: id,
        nodeType: 'generation-target',
        actionId: 'generation-target.generate',
        target: mode,
        params: {
          prompt: finalPrompt,
          model: String(d.model || 'gpt-image-2'),
          apiModel: String(d.apiModel || d.model || 'gpt-image-2'),
          aspectRatio,
          sizeLevel,
          images: upstreamImages.length > 0 ? upstreamImages : selectedSummary.images.map((item) => item.url),
          sourceNodeIds: [...upstreamNodes.map((node) => node.id), ...selectedSummary.selectedNodeIds],
        },
      });
      update({ ...secondaryProviderActionNodePatch(action), error: '' });
      queueMicrotask(() => {
        if (!requestCanvasSecondaryProviderAction(action)) {
          const current = secondaryProviderActionFromNodeData(rf.getNode(id)?.data);
          if (current?.requestId === action.requestId) {
            update({ ...secondaryProviderActionNodePatch(null), status: 'failed', error: '无法请求运行体检' });
          }
        }
      });
    } catch (error: any) {
      update({ status: 'failed', error: error?.message || '次级生成动作参数无效' });
    }
  };

  return (
    <NodeVisible>
      <div
      className={`t8-generation-target-node rounded-xl border p-3 shadow-lg ${selected ? 'is-selected' : ''}`}
      data-target-status={status}
      data-has-result={resultUrl ? 'true' : 'false'}
    >
      <Handle type="target" position={Position.Left} className="!bg-teal-400 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-teal-400 !border-0" />

      <div className="t8-generation-target-header">
        <div className="t8-generation-target-icon">
          <ScanLine size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <input
            className="t8-generation-target-title nodrag"
            value={String(d.title || '生成目标框')}
            onChange={(event) => update({ title: event.target.value })}
            title="目标框标题"
          />
          <div className="t8-generation-target-subtitle">
            {d.targetType || '图像'} · {aspectRatio} · {sizeLevel}
          </div>
        </div>
        <span className="t8-generation-target-chip">{resultUrl ? '已生成' : '待填充'}</span>
      </div>

      <div className="t8-generation-target-preview">
        {resultUrl ? (
          <>
            <img
              src={resultUrl}
              alt={String(d.title || '生成目标框结果')}
              data-drag-source
              data-drag-kind="image"
              data-drag-url={resultUrl}
              data-drag-preview={resultUrl}
              data-drag-node-id={id}
              data-resource-title={resultUrl.split('/').pop()}
            />
            <a
              className="t8-generation-target-download nodrag nopan"
              href={resultUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              title="下载框内结果"
              aria-label="下载框内结果"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <Download size={12} />
              <span>下载</span>
            </a>
          </>
        ) : (
          <div className="t8-generation-target-empty">
            <ImagePlus size={22} />
            <span>把结果准确放到这里</span>
          </div>
        )}
      </div>

      <textarea
        className="t8-generation-target-prompt nodrag nowheel"
        value={String(d.prompt ?? '')}
        placeholder={upstreamPrompt ? '已读取上游提示词，也可在这里覆盖...' : '输入提示词，或连接文本节点...'}
        onChange={(event) => update({ prompt: event.target.value })}
      />

      <div className="t8-generation-target-meta">
        <label>
          比例
          <select className="nodrag" value={aspectRatio} onChange={(event) => update({ aspectRatio: event.target.value })}>
            <option value="1:1">1:1</option>
            <option value="3:4">3:4</option>
            <option value="4:3">4:3</option>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </select>
        </label>
        <label>
          尺寸
          <select className="nodrag" value={sizeLevel} onChange={(event) => update({ sizeLevel: event.target.value })}>
            <option value="1K">1K</option>
            <option value="2K">2K</option>
            <option value="4K">4K</option>
          </select>
        </label>
      </div>

      {d.error ? <div className="t8-generation-target-error">{String(d.error)}</div> : null}
      {upstreamImages.length > 0 ? <div className="t8-generation-target-hint">参考图 {upstreamImages.length} 张</div> : null}

      <div className="t8-generation-target-actions">
        <button type="button" className="nodrag" disabled={isBusy} onClick={() => requestGenerateAction('replace')}>
          {busyMode === 'replace' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          <span>替换到框内</span>
        </button>
        <button type="button" className="nodrag" disabled={isBusy} onClick={() => requestGenerateAction('keep-version')}>
          {busyMode === 'keep-version' ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          <span>保留版本</span>
        </button>
      </div>
      </div>
    </NodeVisible>
  );
};

export default memo(GenerationTargetNode);
