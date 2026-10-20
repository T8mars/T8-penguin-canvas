'use strict';

const { parseArgs } = require('./args.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AgentClientError, requestAgentControl, selectInstance } = require('./agentClient.cjs');
const { CONTROL_PROTOCOL, EXIT_CODES, RESPONSE_SCHEMA } = require('./constants.cjs');
const { discoverInstances } = require('./discovery.cjs');
const { readManifest } = require('./manifest.cjs');
const { envelope, writeHuman, writeJson } = require('./output.cjs');
const {
  InstallerError,
  install: installSkill,
  readTrustedBundleSignerPolicy,
  rollback: rollbackSkill,
  uninstall: uninstallSkill,
  verifyInstallation,
} = require('./installer.cjs');
const {
  SecureStoreError,
  configuredInstances,
  deletePending,
  deleteApproval,
  deleteSession,
  loadPending,
  loadApproval,
  loadSession,
  getWorkspaceContext,
  storePending,
  storeApproval,
  storeSession,
  setWorkspaceContext,
} = require('./secureStore.cjs');
const {
  CreatorSessionError,
  getCreatorSession,
  listCreatorSessions,
  mergeCreatorSessionAuthority,
  saveCreatorSession,
} = require('./creatorSessions.cjs');
const {
  RECIPE_EXPORT_SCHEMA,
  exportRecipe,
  findRecipe,
  importRecipe,
  listRecipes,
  pinRecipe,
  readRecipeFile,
  rollbackRecipe,
  saveRecipe,
  verifyProjectRecipes,
} = require('./recipeStore.cjs');
const commandCatalog = require('../commandCatalog.json');
const creativeCapabilitySurfaces = require('../generated/creative-capability-surfaces.json');

const BUILT_IN_RECIPE_IDS = new Set([
  'general',
  'short-drama',
  'tvc',
  'mv',
  'product',
  'education',
  'remake',
  'character-sheet',
  'storyboard',
]);

const COMMANDS = Object.freeze(commandCatalog.commands.map((command) => Object.freeze({
  ...command,
  subcommands: Object.freeze([...command.subcommands]),
})));
const CREATIVE_CLI_SCOPE_REQUIREMENTS = Object.freeze(Object.fromEntries(
  creativeCapabilitySurfaces.capabilities.map((capability) => [
    capability.cli.operation,
    Object.freeze([...capability.requiredScopes]),
  ]),
));
const CREATIVE_CLI_OPERATIONS = Object.freeze(
  creativeCapabilitySurfaces.capabilities.map((capability) => capability.cli.operation),
);

function operationCapabilities(runtime = {}) {
  const offlineSafe = new Set(['help', 'version', 'capabilities', 'status', 'skill', 'app', 'sessions']);
  const appOnly = new Set(['auth']);
  const pairingOnly = new Set(['workspace.list', 'workspace.use']);
  const scopeRequirements = {
    'workspace.list': ['canvas:read'],
    'workspace.use': ['canvas:read'],
    'doctor.inspect': ['canvas:read'],
    'doctor.validate': ['canvas:read'],
    'doctor.schema': ['canvas:read'],
    'doctor.simulate': ['canvas:read'],
    'patch.preview': ['canvas:write'],
    'patch.apply': ['canvas:write'],
    'patch.history': ['canvas:read'],
    'patch.revert': ['canvas:write'],
    'graph.connect': ['canvas:read', 'canvas:write'],
    'graph.disconnect': ['canvas:read', 'canvas:write'],
    'graph.group': ['canvas:read', 'canvas:write'],
    'graph.batch': ['canvas:write'],
    'asset.search': ['asset:read'],
    'asset.inspect': ['asset:read'],
    'asset.version': ['asset:read'],
    'asset.lineage': ['asset:read'],
    'asset.place-apply': ['canvas:read', 'canvas:write', 'asset:read'],
    'asset.upload': ['asset:transfer'],
    'asset.download': ['asset:transfer'],
    'asset.apply': ['asset:transfer'],
    'delivery.collect': ['asset:read'],
    'delivery.download': ['asset:transfer'],
    'delivery.apply': ['asset:transfer'],
    'delivery.verify': ['asset:read'],
    'model.list': ['canvas:read'],
    'model.search': ['canvas:read'],
    'model.schema': ['canvas:read'],
    'run.plan': ['run:read'],
    'run.watch': ['run:read'],
    'run.resume': ['run:read'],
    'run.cancel': ['run:read', 'run:execute'],
    'run.retry': ['run:execute'],
    ask: ['canvas:read'],
    continue: ['canvas:read'],
    'create.plan-card': ['canvas:read'],
    'story.inspect': ['canvas:read'],
    'director.inspect': ['canvas:read'],
    'video-edit.deliver': ['canvas:read'],
    'browser.status': ['browser:handoff'],
    'browser.focus': ['browser:handoff'],
    'browser.highlight': ['browser:handoff'],
    'browser.screenshot': ['browser:handoff'],
    'browser.inspect-visible-error': ['browser:handoff'],
    ...CREATIVE_CLI_SCOPE_REQUIREMENTS,
  };
  const contractVerified = new Set([
    'version', 'capabilities', 'status', 'skill.install', 'skill.update', 'skill.rollback',
    'skill.verify', 'skill.uninstall', 'app.list', 'app.discover', 'sessions',
    'recipe.list', 'recipe.show', 'recipe.save', 'recipe.export', 'recipe.import',
    'recipe.pin', 'recipe.rollback', 'recipe.verify',
    'doctor.inspect', 'doctor.validate', 'doctor.schema', 'doctor.simulate',
    'run.plan', 'run.watch', 'run.resume', 'run.cancel', 'run.retry',
    'ask', 'continue', 'story.inspect', 'director.inspect', 'video-edit.deliver',
    'delivery.collect', 'delivery.download', 'delivery.apply', 'delivery.verify',
    ...CREATIVE_CLI_OPERATIONS,
  ]);
  return COMMANDS.flatMap((command) => {
    const names = command.subcommands.length
      ? command.subcommands.map((subcommand) => `${command.name}.${subcommand}`)
      : [command.name];
    return names.map((operation) => {
      const browserHandoff = command.name === 'browser' && operation !== 'browser.status';
      // `create.*` only prepares and applies editable graph structure. Provider work
      // starts later through `run.start`, with its own visible approval.
      const externalProvider = operation === 'run.start';
      const needsPairing = !offlineSafe.has(command.name) && !appOnly.has(command.name);
      const needsWorkspace = needsPairing && !pairingOnly.has(operation);
      const requiredScopes = scopeRequirements[operation] || [];
      const grantedScopes = new Set(Array.isArray(runtime.scopes) ? runtime.scopes : []);
      const missingScopes = requiredScopes.filter((scope) => !grantedScopes.has(scope));
      const runtimeAvailable = offlineSafe.has(command.name)
        || (appOnly.has(command.name) && runtime.instanceSelected === true)
        || (
          runtime.instanceSelected === true
          && (!needsPairing || runtime.pairingAuthenticated === true)
          && (!needsWorkspace || runtime.workspaceBound === true)
          && missingScopes.length === 0
          && (!browserHandoff || runtime.hostChromeAvailable === true)
        );
      return {
        operation,
        implemented: true,
        runtimeAvailable,
        verified: contractVerified.has(operation),
        evidence: browserHandoff
          ? 'handoff-contract-tested; host-Chrome execution not performed by CLI'
          : externalProvider
            ? 'local contract tested; real Provider result depends on configured desktop runtime'
            : contractVerified.has(operation)
              ? 'local contract test'
              : 'implemented; requires connected-instance or release evidence',
        requires: [
          ...(!offlineSafe.has(command.name) ? ['desktop-instance'] : []),
          ...(needsPairing ? ['pairing'] : []),
          ...(needsWorkspace ? ['workspace-context'] : []),
          ...requiredScopes,
          ...(browserHandoff ? ['host-chrome-capability'] : []),
          ...(externalProvider ? ['configured-provider', 'explicit-run-approval'] : []),
        ],
        missing: [
          ...(!offlineSafe.has(command.name) && runtime.instanceSelected !== true ? ['desktop-instance'] : []),
          ...(needsPairing && runtime.pairingAuthenticated !== true ? ['pairing'] : []),
          ...(needsWorkspace && runtime.workspaceBound !== true ? ['workspace-context'] : []),
          ...missingScopes.map((scope) => `scope:${scope}`),
          ...(browserHandoff && runtime.hostChromeAvailable !== true ? ['host-chrome-capability'] : []),
        ],
      };
    });
  });
}

async function capabilityRuntime(instances = [], options = {}) {
  const select = options.selectInstance || selectInstance;
  const readSession = options.loadSession || loadSession;
  const readWorkspace = options.getWorkspaceContext || getWorkspaceContext;
  const request = options.requestAgentControl || requestAgentControl;
  const now = options.now || (() => Date.now());
  const state = {
    appConnected: instances.length > 0,
    instanceSelected: instances.length === 1,
    pairingAuthenticated: false,
    workspaceBound: false,
    hostChromeAvailable: String(process.env.ZCANVAS_HOST_CHROME || '').trim() === '1',
    scopes: [],
    creativeCapabilityGraphReady: false,
    creativeRuntimeReadiness: null,
    creativeCapabilityRuntimeError: null,
  };
  if (instances.length !== 1) return state;
  let instance;
  try {
    instance = await select(instances[0].instanceId, {
      discoverInstances: async () => instances,
    });
  } catch (_) {
    state.instanceSelected = false;
    return state;
  }
  const session = readSession(instance.instanceId);
  const context = readWorkspace(instance.instanceId);
  if (!session?.accessToken || Date.parse(String(session.expiresAt || '')) <= now()) return state;
  try {
    const payload = await request(instance, '/api/agent-control/v1/session', {
      accessToken: session.accessToken,
    });
    state.pairingAuthenticated = true;
    state.scopes = Array.isArray(payload?.data?.scopes)
      ? payload.data.scopes.map((scope) => String(scope))
      : [];
    state.workspaceBound = Boolean(
      context?.projectId
      && context?.canvasId,
    );
  } catch (_) {
    state.pairingAuthenticated = false;
    state.workspaceBound = false;
    state.scopes = [];
    return state;
  }
  if (!state.scopes.includes('canvas:read')) return state;
  try {
    const payload = await request(instance, '/api/agent-control/v1/capabilities', {
      accessToken: session.accessToken,
    });
    const live = payload?.data;
    const graph = live?.capabilityGraph;
    const local = readManifest();
    if (live?.schema !== 't8-creative-capability-manifest-v1'
      || graph?.schema !== 't8-creative-capability-graph-v1'
      || graph?.aggregateDigest !== local.creativeCapabilityGraphDigest
      || graph?.artifactDigest !== local.creativeCapabilityGraphArtifactDigest
      || Number(graph?.counts?.missingOperationRisk) !== 0
      || !graph?.readinessSummary) {
      throw new AgentClientError(
        'CREATIVE_CAPABILITY_DRIFT',
        '桌面与 zcanvas 的创作能力图谱或逐操作风险合同不一致，请先更新后再执行创作动作',
      );
    }
    state.creativeCapabilityGraphReady = true;
    state.creativeRuntimeReadiness = graph.readinessSummary;
  } catch (error) {
    state.creativeCapabilityRuntimeError = {
      code: String(error?.code || 'CREATIVE_CAPABILITY_RUNTIME_UNAVAILABLE'),
      message: String(error?.message || '暂时无法读取当前模型与动作的运行就绪状态'),
    };
  }
  return state;
}

function helpData() {
  return {
    usage: 'zcanvas <command> [--json|--human]',
    defaultFormat: 'json',
    commands: COMMANDS,
    examples: [
      'zcanvas status',
      'zcanvas skill install',
      'zcanvas skill verify',
      'zcanvas skill update',
      'zcanvas skill rollback',
      'zcanvas skill uninstall',
      'zcanvas auth pair',
      'zcanvas auth complete',
      'zcanvas auth status',
      'zcanvas auth revoke',
      'zcanvas workspace list',
      'zcanvas workspace use --canvas <canvasId>',
      'zcanvas doctor inspect',
      'zcanvas doctor validate',
      'zcanvas doctor simulate',
      'zcanvas doctor simulate --file <absolute-execution-proposal.json>',
      'zcanvas patch preview --file <patch.json>',
      'zcanvas patch apply',
      'zcanvas patch history',
      'zcanvas patch revert --patch <patchId>',
      'zcanvas graph add --type image [--x 120 --y 240 --file C:\\absolute\\node-data.json]',
      'zcanvas graph connect --source <nodeId> --target <nodeId>',
      'zcanvas graph group --nodes <nodeId,nodeId> --name "角色参考"',
      'zcanvas asset search --kind image --query "角色参考"',
      'zcanvas asset place --asset <assetId> [--x 120 --y 240 --target <nodeId> --target-handle <port>]',
      'zcanvas asset place-apply',
      'zcanvas asset import --file <absolute-path>',
      'zcanvas asset download --asset <assetId> --to <absolute-path>',
      'zcanvas asset apply',
      'zcanvas delivery collect --scope canvas',
      'zcanvas delivery package --scope project --to <absolute-package-directory>',
      'zcanvas delivery apply',
      'zcanvas delivery verify --from <absolute-package-directory> --digest <pinned-package-digest>',
      'zcanvas browser open',
      'zcanvas browser highlight --node <nodeId>',
      'zcanvas run plan --node <nodeId>',
      'zcanvas run start --plan <planId>',
      'zcanvas media extract-frames --node <videoNodeId> --count 6',
      'zcanvas media remove-solid-background --node <imageNodeId>',
      'zcanvas media resample-upscale --node <imageNodeId> --scale 2',
      'zcanvas run watch --intent <intentId>',
      'zcanvas ask "为透明折叠伞做20秒竖屏雨季广告，先给方案"',
      'zcanvas ask --asset <assetId>',
      'zcanvas ask "只调整这两个节点的构图，其他不变" --node <nodeId>,<nodeId>',
      'zcanvas continue --session <creatorSessionId>',
      'zcanvas recipe save --name my-director --file <absolute-recipe.json>',
      'zcanvas recipe pin --name my-director --revision 2',
      'zcanvas recipe export --name my-director --to <absolute-recipe-export.json>',
      'zcanvas ask "把这段剧本做成30秒竖屏短片" --recipe my-director',
      'zcanvas create plan-card --type image --prompt "电影感角色海报"',
      'zcanvas create image --prompt "雨夜唐人街女主角" --profile balanced --template character-sheet',
      'zcanvas edit image --asset <assetId> --prompt "只把外套改为红色，其余保持不变"',
      'zcanvas edit video --asset <assetId> --prompt "保留人物与动作，只调整为雨夜氛围"',
      'zcanvas create audio --prompt "轻快的产品广告配乐" --audio-model suno-v5.5-generate',
      'zcanvas ask "用温和女声把这段旁白读成中文音频" --audio-model xai-tts --voice eve',
      'zcanvas ask "把这段采访音频转成文字" --audio-model xai-stt --asset <audioAssetId>',
      'zcanvas create story --prompt "一场雨夜追逐" --duration 60 --ratio 16:9 --llm-model gemini-3.5-flash --image-model zhenzhen-image-g2-t2i --video-model doubao-seedance-2-0-fast-260128',
      'zcanvas create story --file <absolute-utf8-script.txt> --duration 60 --ratio 16:9 --audience "悬疑短片观众"',
      'zcanvas iterate compare --node <candidateNodeId>',
      'zcanvas iterate review --node <candidateNodeId> --file <absolute-visual-review.json>',
      'zcanvas iterate accept --node <candidateNodeId>',
      'zcanvas story import --story <storyNodeId> --file <shots-and-assets.json>',
      'zcanvas story analyze --story <storyNodeId>',
      'zcanvas story plan-previews --story <storyNodeId>',
      'zcanvas director materialize --story <storyNodeId>',
      'zcanvas video-edit compose --node <directorNodeId>',
      'zcanvas capabilities',
      'zcanvas version --human',
    ],
  };
}

function humanHelp() {
  return [
    'zcanvas — 贞贞无限画布 Agent CLI',
    '',
    'Usage: zcanvas <command> [--json|--human]',
    '',
    ...COMMANDS.map((item) => `  ${item.name.padEnd(14)} ${item.available ? '' : '[planned] '}${item.summary}`),
  ];
}

function emit(result, human, humanLines = null) {
  if (human) writeHuman(humanLines || result.message);
  else writeJson(result);
}

function exitCodeForError(error) {
  if (error?.code === 'APP_NOT_RUNNING') return EXIT_CODES.APP_NOT_RUNNING;
  if (error?.code === 'APP_INSTANCE_AMBIGUOUS') return EXIT_CODES.CONFLICT;
  if (error instanceof SecureStoreError || /^(AUTH|PAIRING|CREDENTIAL_)/.test(String(error?.code || ''))) {
    return EXIT_CODES.AUTH_ERROR;
  }
  if (error instanceof InstallerError) return EXIT_CODES.INTERNAL_ERROR;
  return EXIT_CODES.INTERNAL_ERROR;
}

function creatorRecoveryForError(error = {}) {
  const code = String(error.code || 'INTERNAL_ERROR');
  const details = error.details && typeof error.details === 'object' ? error.details : {};
  const result = {
    schema: 't8-creator-recovery-v1',
    whatFailed: '本次操作没有完成',
    existingWorkSafe: true,
    existingWorkState: '已有画布、已采用结果、已锁定素材和已完成任务保持不变',
    duplicateSubmissionPrevented: true,
    nextActions: ['重新检查当前画布状态后，再继续同一个操作。'],
  };
  if (code.startsWith('INSTALL_BUNDLE_DIGEST')) {
    return {
      ...result,
      whatFailed: '版本包的 SHA-256 完整性校验没有通过',
      existingWorkState: '当前 Skill、CLI、配对凭据和画布均未被替换',
      nextActions: ['重新获取官方版本包和对应的 64 位 SHA-256，再执行同一次安装或更新。'],
    };
  }
  if (code.startsWith('INSTALL_BUNDLE_SIGNATURE')
    || code === 'INSTALL_BUNDLE_SIGNER_UNTRUSTED'
    || code === 'INSTALL_BUNDLE_TRUST_NOT_CONFIGURED'
    || code === 'INSTALL_TRUST_POLICY_INVALID') {
    return {
      ...result,
      whatFailed: '版本包签名无法确认来自受信任的发布者',
      existingWorkState: '安装在替换文件前已停止；当前版本、配对凭据和画布保持不变',
      nextActions: ['先从当前项目或官方桌面包建立可信安装，再使用带官方签名的完整版本包更新。'],
    };
  }
  if (code.startsWith('INSTALL_SOURCE_') || code === 'INSTALL_MANIFEST_INVALID') {
    return {
      ...result,
      whatFailed: '版本包结构、版本号或协议清单不兼容',
      existingWorkState: '未启用不兼容文件；当前安装和创作内容保持不变',
      nextActions: ['换用与当前贞贞无限画布版本匹配的完整 Skill + CLI 版本包。'],
    };
  }
  if (code === 'INSTALL_VERIFY_FAILED'
    || code === 'DISCOVERY_VERIFY_FAILED'
    || code === 'DISCOVERY_MARKER_INVALID'
    || code === 'DISCOVERY_TARGET_UNOWNED') {
    return {
      ...result,
      whatFailed: 'Skill/CLI 文件与安装清单不一致，或发现目录不属于当前安装',
      existingWorkState: '安装器没有覆盖不属于自己的目录；配对凭据和画布不受影响',
      nextActions: ['保留现有目录，运行 zcanvas skill verify；确认目录归属后再更新或回滚。'],
    };
  }
  if (code.startsWith('INSTALL_ROLLBACK')) {
    return {
      ...result,
      whatFailed: '上一版本没有完成原子恢复',
      existingWorkState: '安装器优先恢复原版本并保留 last-known-good；配对凭据和画布没有被删除',
      nextActions: ['不要手动删除安装目录；先运行 zcanvas skill verify，再重试 zcanvas skill rollback。'],
    };
  }
  if (code === 'APP_NOT_RUNNING') {
    return {
      ...result,
      whatFailed: '没有连接到正在运行的贞贞无限画布',
      existingWorkState: '没有执行画布写入或 Provider 请求，已有项目不受影响',
      nextActions: ['启动贞贞无限画布，等待画布加载完成后继续原创作要求。'],
    };
  }
  if (code === 'APP_INSTANCE_AMBIGUOUS') {
    return {
      ...result,
      whatFailed: '发现多个画布实例，暂时无法确定要操作哪一个',
      existingWorkState: '没有选择实例，因此没有修改任何画布或素材',
      nextActions: ['向创作者展示实例名称、项目和最后活动时间，让其选择目标作品。'],
    };
  }
  if (['PAIRING_REQUIRED', 'AUTH_EXPIRED'].includes(code)) {
    return {
      ...result,
      whatFailed: '当前 Agent 与画布的安全连接不可用',
      existingWorkState: '连接失败发生在业务操作前，已有作品保持不变',
      nextActions: ['重新完成本机配对，然后从同一 Creator Session 继续。'],
    };
  }
  if (['CREATIVE_CANVAS_STALE', 'REVISION_STALE', 'SCHEMA_STALE'].includes(code)) {
    return {
      ...result,
      whatFailed: '画布在预览后发生了变化，旧方案不能安全应用',
      existingWorkState: '旧方案已失败关闭，创作者刚刚的修改没有被覆盖',
      nextActions: ['重新读取最新画布并生成新的影响范围预览。'],
    };
  }
  if (code === 'RUN_WATCH_TIMEOUT') {
    return {
      ...result,
      whatFailed: '本次进度观察已超时，但后台任务没有被取消',
      existingWorkState: '已完成结果和正在运行的任务都保留，可从原 intent/cursor 继续观察',
      nextActions: ['使用原运行记录恢复观察，不要重新提交 Provider 任务。'],
    };
  }
  if (code.includes('ARTIFACT') || code.includes('DOWNLOAD') || code.includes('DELIVERY')) {
    return {
      ...result,
      whatFailed: '结果下载、验证、落库或交付环节没有完成',
      existingWorkState: '源素材和已验证结果保持不变；未验证结果不会被宣称为成功或覆盖旧版',
      nextActions: ['查看缺失的产物证据，只恢复下载或验证环节，不重复生成。'],
    };
  }
  if (code.includes('APPROVAL') || code.includes('CONFIRMATION')) {
    return {
      ...result,
      whatFailed: '当前变更或运行尚未获得画布确认',
      existingWorkState: '确认前画布写入和 Provider 提交均为 0',
      nextActions: ['回到画布核对影响范围；确认后继续同一个批准，不要新建重复操作。'],
    };
  }
  if (code.startsWith('RUN_') || code.includes('PROVIDER')) {
    return {
      ...result,
      whatFailed: '运行或 Provider 阶段没有完成',
      existingWorkState: '已完成素材继续保留；失败项可以单独重试，不会重跑已完成范围',
      nextActions: ['恢复原运行记录并只重试失败项。'],
    };
  }
  if (details.questions) {
    result.nextActions = ['只补充返回的关键问题，然后继续同一个 Creator Session。'];
  }
  return result;
}

function emitHandledError(error, human) {
  const known = error instanceof AgentClientError
    || error instanceof SecureStoreError
    || error instanceof InstallerError
    || error instanceof CreatorSessionError;
  const recovery = creatorRecoveryForError(known ? error : {
    code: 'INTERNAL_ERROR',
    details: {},
  });
  emit(envelope({
    ok: false,
    code: known ? error.code : 'INTERNAL_ERROR',
    message: `${recovery.whatFailed}。${known ? error.message : '没有执行未确认的操作'}`,
    data: {
      ...(known && error.details ? error.details : {}),
      recovery,
    },
    nextActions: recovery.nextActions,
  }), human);
  return exitCodeForError(error);
}

function handleSkill(subcommand, parsed, human) {
  const action = subcommand || 'verify';
  if (!['install', 'update', 'rollback', 'verify', 'uninstall'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 skill 子命令：${action}；可用 install、update、rollback、verify、uninstall`);
  }
  const options = {
    ...(parsed.flags.get('target') ? { installRoot: String(parsed.flags.get('target')) } : {}),
    ...(parsed.flags.get('bundle') ? { bundlePath: String(parsed.flags.get('bundle')) } : {}),
    ...(parsed.flags.get('sha256') ? { bundleSha256: String(parsed.flags.get('sha256')) } : {}),
  };
  if (parsed.flags.get('trust-policy')) {
    const trustedBundlePolicyPath = path.resolve(String(parsed.flags.get('trust-policy')));
    options.trustedBundlePolicyPath = trustedBundlePolicyPath;
    options.trustedBundleSigners = readTrustedBundleSignerPolicy(trustedBundlePolicyPath);
  }
  const data = action === 'install' || action === 'update'
    ? installSkill(options)
    : action === 'uninstall'
      ? uninstallSkill(options)
      : action === 'rollback'
        ? rollbackSkill(options)
        : verifyInstallation(options);
  const message = action === 'uninstall'
    ? 'zhenzhen-canvas Skill 与 zcanvas CLI 已从当前用户安装目录卸载；配对凭据保持不变'
    : action === 'rollback'
      ? 'zhenzhen-canvas Skill 与 zcanvas CLI 已回滚到上一份校验通过的安装'
    : action === 'verify'
      ? 'zhenzhen-canvas Skill 与 zcanvas CLI 校验通过'
      : data.updated
        ? 'zhenzhen-canvas Skill 与 zcanvas CLI 已原子更新并校验通过'
        : 'zhenzhen-canvas Skill 与 zcanvas CLI 已安装到当前用户目录并校验通过';
  emit(envelope({ message, data }), human, [
    message,
    `root ${data.root}`,
    `skill ${data.skillVersion}`,
    `cli ${data.cliVersion}`,
  ]);
  return EXIT_CODES.OK;
}

function requestedScopes(value) {
  const supported = new Set([
    'canvas:read',
    'canvas:write',
    'run:read',
    'run:execute',
    'asset:read',
    'asset:transfer',
    'browser:handoff',
  ]);
  const scopes = value
    ? [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))]
    : ['canvas:read', 'run:read', 'asset:read'];
  if (!scopes.length || scopes.some((scope) => !supported.has(scope))) {
    const error = new AgentClientError(
      'PAIRING_SCOPE_INVALID',
      '权限范围无效；请使用逗号分隔的 canvas:read、canvas:write、run:read、run:execute、asset:read、asset:transfer、browser:handoff',
    );
    throw error;
  }
  return scopes;
}

async function handleAuth(subcommand, parsed, human) {
  const action = subcommand || 'status';
  if (action === 'list') {
    const data = configuredInstances();
    emit(envelope({
      message: '已返回本机 Agent 配置状态；不会显示任何凭据',
      data,
    }), human, [
      ...data.sessions.map((item) => `paired ${item.instanceId} expires ${item.expiresAt}`),
      ...data.pending.map((item) => `pending ${item.instanceId} code ${item.userCode}`),
      ...(data.sessions.length || data.pending.length ? [] : ['没有已配置或待确认的 Agent 连接']),
    ]);
    return EXIT_CODES.OK;
  }

  const instance = await selectInstance(String(parsed.flags.get('instance') || ''));

  if (action === 'pair') {
    if (configuredInstances().pending.some(item => item.instanceId === instance.instanceId)) throw new AgentClientError('PAIRING_ALREADY_PENDING', '此实例已有待确认配对，请先在画布处理已有请求');
    const payload = await requestAgentControl(instance, '/api/agent-control/v1/pairings', {
      method: 'POST',
      body: {
        clientName: String(parsed.flags.get('name') || 'Codex 创作 Agent').slice(0, 80),
        agentKind: 'codex',
        requestedScopes: requestedScopes(parsed.flags.get('scopes')),
      },
    });
    const pairing = payload.data;
    storePending(instance, pairing);
    emit(envelope({
      code: 'PAIRING_CONFIRMATION_REQUIRED',
      message: '配对请求已发到贞贞无限画布，请核对验证码并在应用中批准',
      data: {
        instanceId: instance.instanceId,
        clientName: pairing.clientName,
        userCode: pairing.userCode,
        requestedScopes: pairing.requestedScopes,
        expiresAt: pairing.expiresAt,
        status: pairing.status,
      },
      nextActions: [
        `确认应用弹窗和终端验证码均为 ${pairing.userCode}，选择权限并批准。`,
        `批准后运行 zcanvas auth complete --instance ${instance.instanceId}。`,
      ],
    }), human, [
      '请在贞贞无限画布中批准 Agent 连接',
      `验证码：${pairing.userCode}`,
      `权限：${pairing.requestedScopes.join(', ')}`,
      `批准后运行：zcanvas auth complete --instance ${instance.instanceId}`,
    ]);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }

  if (action === 'complete') {
    const pending = loadPending(instance.instanceId);
    if (!pending) {
      throw new AgentClientError('PAIRING_NOT_STARTED', '没有找到此画布实例的待确认配对，请先运行 zcanvas auth pair');
    }
    if (Date.parse(String(pending.expiresAt || '')) <= Date.now()) {
      deletePending(instance.instanceId, { expectedPairingId: pending.pairingId, expectedOrigin: instance.origin });
      throw new AgentClientError('PAIRING_EXPIRED', 'Agent 配对验证码已过期，请重新发起配对并核对新的验证码');
    }
    const payload = await requestAgentControl(
      instance,
      `/api/agent-control/v1/pairings/${encodeURIComponent(pending.pairingId)}/poll`,
      { method: 'POST', body: { pollSecret: pending.pollSecret } },
    );
    const result = payload.data;
    if (result.status === 'pending') {
      emit(envelope({
        ok: false,
        code: 'PAIRING_PENDING',
        message: '画布仍在等待你批准此 Agent',
        data: {
          instanceId: instance.instanceId,
          userCode: pending.userCode,
          expiresAt: pending.expiresAt,
          status: 'pending',
        },
        nextActions: ['回到贞贞无限画布核对验证码并点击“批准连接”，然后重新运行此命令。'],
      }), human);
      return EXIT_CODES.CONFIRMATION_REQUIRED;
    }
    if (result.status === 'denied') {
      deletePending(instance.instanceId, { expectedPairingId: pending.pairingId, expectedOrigin: instance.origin });
      throw new AgentClientError('PAIRING_DENIED', '画布用户已拒绝此 Agent 连接');
    }
    if (result.status !== 'approved' || !result.accessToken) {
      deletePending(instance.instanceId, { expectedPairingId: pending.pairingId, expectedOrigin: instance.origin });
      throw new AgentClientError('PAIRING_TOKEN_ALREADY_ISSUED', '配对凭据已领取或失效，请重新发起配对');
    }
    storeSession(instance, result);
    emit(envelope({
      message: 'Codex Agent 已安全连接贞贞无限画布',
      data: {
        instanceId: instance.instanceId,
        sessionId: result.sessionId,
        expiresAt: result.expiresAt,
        authenticated: true,
      },
      nextActions: ['运行 zcanvas auth status 检查权限，或开始只读画布操作。'],
    }), human, [
      '连接成功',
      `instance ${instance.instanceId}`,
      `session ${result.sessionId}`,
      `expires ${result.expiresAt}`,
    ]);
    return EXIT_CODES.OK;
  }

  if (action === 'status') {
    const session = loadSession(instance.instanceId);
    if (!session) {
      throw new AgentClientError('PAIRING_REQUIRED', '此画布实例尚未连接 Agent，请先运行 zcanvas auth pair');
    }
    try {
      const payload = await requestAgentControl(instance, '/api/agent-control/v1/session', {
        accessToken: session.accessToken,
      });
      emit(envelope({
        message: 'Agent 配对有效',
        data: { ...payload.data, instanceId: instance.instanceId, authenticated: true },
      }), human, [
        `authenticated ${payload.data.clientName}`,
        `scopes ${payload.data.scopes.join(', ')}`,
        `expires ${payload.data.expiresAt}`,
      ]);
      return EXIT_CODES.OK;
    } catch (error) {
      if (['AUTH_EXPIRED', 'PAIRING_REQUIRED'].includes(error?.code)) deleteSession(instance.instanceId, { expectedSessionId: session.sessionId, expectedOrigin: instance.origin });
      throw error;
    }
  }

  if (action === 'revoke') {
    const session = loadSession(instance.instanceId);
    if (!session) {
      emit(envelope({
        message: '此画布实例没有已保存的 Agent 连接',
        data: { instanceId: instance.instanceId, revoked: false },
      }), human);
      return EXIT_CODES.OK;
    }
    const payload = await requestAgentControl(instance, '/api/agent-control/v1/session', {
      method: 'DELETE',
      accessToken: session.accessToken,
    });
    deleteSession(instance.instanceId, { expectedSessionId: session.sessionId, expectedOrigin: instance.origin });
    emit(envelope({
      message: 'Agent 连接已撤销，本机安全凭据已删除',
      data: { instanceId: instance.instanceId, ...payload.data },
    }), human);
    return EXIT_CODES.OK;
  }

  throw new AgentClientError(
    'USAGE_ERROR',
    `未知 auth 子命令：${action}；可用 pair、complete、status、list、revoke`,
  );
}

async function authenticatedInstance(parsed) {
  const instance = await selectInstance(String(parsed.flags.get('instance') || ''));
  const session = loadSession(instance.instanceId);
  if (!session) {
    throw new AgentClientError('PAIRING_REQUIRED', '此画布实例尚未连接 Agent，请先运行 zcanvas auth pair');
  }
  return { instance, session };
}

async function authenticatedRequest(instance, session, pathname, options = {}) {
  try {
    return await requestAgentControl(instance, pathname, {
      ...options,
      accessToken: session.accessToken,
    });
  } catch (error) {
    if (['AUTH_EXPIRED', 'PAIRING_REQUIRED'].includes(error?.code)) deleteSession(instance.instanceId, { expectedSessionId: session.sessionId, expectedOrigin: instance.origin });
    throw error;
  }
}

function selectUnambiguousCreatorWorkspace(data = {}) {
  const canvases = Array.isArray(data.canvases) ? data.canvases : [];
  if (canvases.length === 1 && data.truncated !== true) {
    const canvas = canvases[0];
    return {
      projectId: String(canvas.projectId || data.projectId || ''),
      canvasId: String(canvas.id || ''),
    };
  }
  if (!canvases.length) {
    throw new AgentClientError(
      'WORKSPACE_EMPTY',
      '当前项目还没有可创作的画布；请先在贞贞无限画布中新建并保存一个画布',
    );
  }
  throw new AgentClientError(
    'WORKSPACE_AMBIGUOUS',
    `发现 ${canvases.length} 个画布，请用画布名称选择要继续的作品`,
    0,
    {
      canvases: canvases.slice(0, 20).map((canvas) => ({
        id: String(canvas.id || ''),
        name: String(canvas.name || canvas.id || ''),
        revision: Number(canvas.revision || 0),
        updatedAt: Number(canvas.updatedAt || 0),
      })),
    },
  );
}

async function creatorWorkspaceContext(instance, session) {
  const current = getWorkspaceContext(instance.instanceId);
  if (current) return current;
  const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/workspaces');
  const selected = selectUnambiguousCreatorWorkspace(payload.data);
  return setWorkspaceContext(instance.instanceId, selected);
}

async function handleWorkspace(subcommand, parsed, human) {
  const action = subcommand || 'current';
  if (!['list', 'use', 'current'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 workspace 子命令：${action}；可用 list、use、current`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  if (action === 'current') {
    const context = getWorkspaceContext(instance.instanceId);
    if (!context) {
      throw new AgentClientError(
        'WORKSPACE_CONTEXT_REQUIRED',
        '尚未选择当前画布，请运行 zcanvas workspace list 后再运行 zcanvas workspace use --canvas <canvasId>',
      );
    }
    emit(envelope({
      message: '已返回当前 Agent 创作上下文',
      data: { instanceId: instance.instanceId, ...context },
    }), human, [
      `project ${context.projectId}`,
      `canvas ${context.canvasId}`,
      `instance ${instance.instanceId}`,
    ]);
    return EXIT_CODES.OK;
  }
  const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/workspaces');
  const canvases = Array.isArray(payload.data?.canvases) ? payload.data.canvases : [];
  if (action === 'list') {
    emit(envelope({
      message: `已返回 ${canvases.length} 个可用画布`,
      data: { instanceId: instance.instanceId, ...payload.data },
      nextActions: canvases.length
        ? ['使用 zcanvas workspace use --canvas <canvasId> 选择本轮创作上下文。']
        : ['先在贞贞无限画布中创建或保存一个画布。'],
    }), human, canvases.length
      ? canvases.map((canvas) => `${canvas.id} r${canvas.revision} ${canvas.nodeCount} nodes ${canvas.name}`)
      : ['没有可用画布']);
    return EXIT_CODES.OK;
  }
  const canvasId = String(parsed.flags.get('canvas') || '').trim();
  const projectId = String(parsed.flags.get('project') || payload.data?.projectId || '').trim();
  if (!canvasId) throw new AgentClientError('USAGE_ERROR', 'workspace use 必须提供 --canvas <canvasId>');
  const selected = canvases.find((canvas) => canvas.id === canvasId && canvas.projectId === projectId);
  if (!selected) throw new AgentClientError('WORKSPACE_NOT_FOUND', '指定画布不存在或不属于当前项目');
  const context = setWorkspaceContext(instance.instanceId, { projectId, canvasId });
  emit(envelope({
    message: `已将当前创作上下文切换到“${selected.name}”`,
    data: { instanceId: instance.instanceId, context, canvas: selected },
    nextActions: ['运行 zcanvas doctor inspect 查看画布结构。'],
  }), human, [
    `selected ${selected.name}`,
    `project ${projectId}`,
    `canvas ${canvasId}`,
    `revision ${selected.revision}`,
  ]);
  return EXIT_CODES.OK;
}

async function handleDoctor(subcommand, parsed, human) {
  const action = subcommand || 'inspect';
  if (!['inspect', 'validate', 'schema', 'simulate'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 doctor 子命令：${action}；可用 inspect、validate、schema、simulate`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) {
    throw new AgentClientError(
      'WORKSPACE_CONTEXT_REQUIRED',
      '尚未选择当前画布，请先运行 zcanvas workspace use --canvas <canvasId>',
    );
  }
  const { tool, input } = doctorRequestForAction(action, parsed);
  const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/tools', {
    method: 'POST',
    body: {
      tool,
      requestId: crypto.randomUUID(),
      projectId: context.projectId,
      canvasId: context.canvasId,
      input,
    },
  });
  const result = payload.data;
  emit(envelope({
    message: action === 'inspect'
      ? '已返回脱敏后的当前画布结构'
      : action === 'validate'
        ? '已完成当前 revision 的只读工作流诊断'
        : action === 'schema'
          ? '已返回权威节点 Schema'
          : '已完成当前 revision 的只读执行模拟；没有写入画布，也没有调用 Provider',
    data: result,
    warnings: [
      ...(result?.truncated ? ['结果已按安全输出上限截断，请缩小查询范围。'] : []),
      ...(action === 'simulate' && result?.data?.uncertainty?.length
        ? ['循环或随机分支的真实次数只能在运行时确定；模拟结果没有伪造百分比或调用次数。']
        : []),
    ],
  }), human, action === 'inspect'
    ? [
      `canvas ${result.canvasId} r${result.canvasRevision}`,
      `nodes ${result.data?.totals?.nodes || 0}`,
      `edges ${result.data?.totals?.edges || 0}`,
    ]
    : action === 'validate'
      ? [
        `canvas ${result.canvasId} r${result.canvasRevision}`,
        `valid ${result.data?.valid === true}`,
        `issues ${Array.isArray(result.data?.issues) ? result.data.issues.length : 0}`,
      ]
      : action === 'schema'
        ? [`schema ${input.type || input.nodeId}`, `revision ${result.canvasRevision}`]
        : [
          `canvas ${result.canvasId} r${result.canvasRevision}`,
          `valid ${result.data?.valid === true}`,
          `blocked ${result.data?.blocked === true}`,
          `batches ${Array.isArray(result.data?.batches) ? result.data.batches.length : 0}`,
          `executable nodes ${Number(result.data?.executableNodeCount || 0)}`,
          `uncertainty ${Array.isArray(result.data?.uncertainty) ? result.data.uncertainty.length : 0}`,
          'writes 0 · provider calls 0',
        ]);
  return EXIT_CODES.OK;
}

function readSimulationProposalFile(value) {
  if (value == null || String(value).trim() === '') return null;
  const filename = String(value).trim();
  if (!path.isAbsolute(filename)) {
    throw new AgentClientError('SIMULATION_FILE_PATH_INVALID', '执行模拟文件必须使用绝对路径');
  }
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (_) {
    throw new AgentClientError('SIMULATION_FILE_NOT_FOUND', '找不到执行模拟文件');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 64 * 1024) {
    throw new AgentClientError('SIMULATION_FILE_INVALID', '执行模拟文件必须是 1-64 KiB 的普通 JSON 文件，不能是目录或链接');
  }
  try {
    const proposal = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new Error('shape');
    return proposal;
  } catch (_) {
    throw new AgentClientError('SIMULATION_FILE_INVALID', '执行模拟文件不是有效 JSON 对象');
  }
}

function doctorRequestForAction(action, parsed) {
  if (action === 'inspect') return { tool: 'inspectCanvas', input: {} };
  if (action === 'validate') return { tool: 'validateCanvas', input: {} };
  if (action === 'schema') {
    const input = {
      ...(parsed.flags.get('type') ? { type: String(parsed.flags.get('type')) } : {}),
      ...(parsed.flags.get('node') ? { nodeId: String(parsed.flags.get('node')) } : {}),
    };
    if (!input.type && !input.nodeId) {
      throw new AgentClientError('USAGE_ERROR', 'doctor schema 必须提供 --type <nodeType> 或 --node <nodeId>');
    }
    return { tool: 'inspectNodeSchema', input };
  }
  if (action === 'simulate') {
    const proposal = readSimulationProposalFile(parsed.flags.get('file'));
    return {
      tool: 'simulateExecutionPlan',
      input: proposal ? { proposal } : {},
    };
  }
  throw new AgentClientError('USAGE_ERROR', `未知 doctor 子命令：${action}`);
}

function readPatchFile(value) {
  const filePath = path.resolve(String(value || '').trim());
  if (!value) throw new AgentClientError('USAGE_ERROR', 'patch preview 必须提供 --file <patch.json>');
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (_) {
    throw new AgentClientError('PATCH_FILE_NOT_FOUND', '找不到指定的 Patch 文件');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
    throw new AgentClientError('PATCH_FILE_INVALID', 'Patch 必须是小于 64 KiB 的普通 JSON 文件');
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    throw new AgentClientError('PATCH_FILE_INVALID', 'Patch 文件不是有效 JSON');
  }
}

async function handlePatch(subcommand, parsed, human) {
  const action = subcommand || 'history';
  if (!['preview', 'apply', 'history', 'revert'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 patch 子命令：${action}；可用 preview、apply、history、revert`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) {
    throw new AgentClientError('WORKSPACE_CONTEXT_REQUIRED', '尚未选择当前画布，请先运行 workspace use');
  }

  if (action === 'preview') {
    const patch = readPatchFile(parsed.flags.get('file'));
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/patch-approvals', {
      method: 'POST',
      body: { ...context, patch },
    });
    const approval = payload.data;
    storeApproval(instance, approval);
    emit(envelope({
      code: 'PATCH_CONFIRMATION_REQUIRED',
      message: 'Patch 已完成权威预览，请在画布中核对差异并批准',
      data: {
        approvalRequestId: approval.approvalRequestId,
        action: approval.action,
        patchId: approval.patchId,
        projectId: approval.projectId,
        canvasId: approval.canvasId,
        preview: approval.preview,
        expiresAt: approval.expiresAt,
        status: approval.status,
      },
      nextActions: [
        '在贞贞无限画布的确认弹窗中核对变更并批准。',
        '批准后运行 zcanvas patch apply。',
      ],
    }), human, [
      'Patch 预览完成，等待用户批准',
      `${approval.preview.summary}`,
      `patch ${approval.patchId}`,
      `当前 revision r${approval.preview.currentRevision}；批准提交后由画布返回真实的新 revision`,
      `changes ${approval.preview.changes?.length || 0}`,
      '批准后运行：zcanvas patch apply',
    ]);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }

  if (action === 'apply') {
    const approval = loadApproval(instance.instanceId);
    if (!approval) {
      throw new AgentClientError('APPROVAL_NOT_STARTED', '没有待提交的 Patch 确认，请先运行 patch preview 或 patch revert');
    }
    const payload = await authenticatedRequest(
      instance,
      session,
      `/api/agent-control/v1/patch-approvals/${encodeURIComponent(approval.approvalRequestId)}/complete`,
      { method: 'POST', body: { pollSecret: approval.pollSecret } },
    );
    const result = payload.data;
    if (result.status === 'pending') {
      emit(envelope({
        ok: false,
        code: 'PATCH_APPROVAL_PENDING',
        message: '画布用户尚未批准此操作',
        data: {
          approvalRequestId: approval.approvalRequestId,
          action: approval.action,
          patchId: approval.patchId,
          expiresAt: approval.expiresAt,
          status: 'pending',
        },
        nextActions: ['回到画布核对差异并批准，然后重新运行 zcanvas patch apply。'],
      }), human);
      return EXIT_CODES.CONFIRMATION_REQUIRED;
    }
    if (result.status === 'denied') {
      deleteApproval(instance.instanceId, approval.approvalRequestId);
      throw new AgentClientError('PATCH_APPROVAL_DENIED', '画布用户已拒绝此操作');
    }
    deleteApproval(instance.instanceId, approval.approvalRequestId);
    emit(envelope({
      message: result.action === 'patch.revert' ? 'Patch 已创建新的撤销 revision' : 'Patch 已应用',
      data: result,
      nextActions: ['运行 zcanvas doctor inspect 读取最新 revision 并验证结果。'],
    }), human, [
      `${result.status} ${result.patchId}`,
      `revision ${result.revision}`,
      `duplicate ${result.duplicate === true}`,
    ]);
    return EXIT_CODES.OK;
  }

  if (action === 'history') {
    const query = new URLSearchParams({
      projectId: context.projectId,
      canvasId: context.canvasId,
      limit: '50',
    });
    const payload = await authenticatedRequest(
      instance,
      session,
      `/api/agent-control/v1/patches?${query.toString()}`,
    );
    const patches = Array.isArray(payload.data?.patches) ? payload.data.patches : [];
    emit(envelope({
      message: `已返回 ${patches.length} 条当前 Agent 的 Patch 记录`,
      data: payload.data,
    }), human, patches.length
      ? patches.map((item) => `${item.status} ${item.patchId} r${item.appliedRevision} ${item.summary}`)
      : ['没有当前 Agent 可见的 Patch 记录']);
    return EXIT_CODES.OK;
  }

  const patchId = String(parsed.flags.get('patch') || '').trim();
  if (!patchId) throw new AgentClientError('USAGE_ERROR', 'patch revert 必须提供 --patch <patchId>');
  const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/patch-revert-approvals', {
    method: 'POST',
    body: { ...context, patchId },
  });
  const approval = payload.data;
  storeApproval(instance, approval);
  emit(envelope({
    code: 'PATCH_CONFIRMATION_REQUIRED',
    message: '撤销请求已进入画布用户确认队列',
    data: {
      approvalRequestId: approval.approvalRequestId,
      action: approval.action,
      patchId: approval.patchId,
      preview: approval.preview,
      expiresAt: approval.expiresAt,
      status: approval.status,
    },
    nextActions: ['在画布中批准撤销，然后运行 zcanvas patch apply。'],
  }), human);
  return EXIT_CODES.CONFIRMATION_REQUIRED;
}

async function inspectGraph(instance, session, context) {
  return (await authenticatedRequest(instance, session, '/api/agent-control/v1/tools', {
    method: 'POST',
    body: {
      tool: 'inspectCanvas',
      requestId: crypto.randomUUID(),
      ...context,
      input: { nodeLimit: 100, edgeLimit: 200 },
    },
  })).data;
}

async function requestGeneratedPatchApproval(instance, session, context, patch, human) {
  const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/patch-approvals', {
    method: 'POST',
    body: { ...context, patch },
  });
  const approval = payload.data;
  storeApproval(instance, approval);
  emit(envelope({
    ok: false,
    code: 'PATCH_CONFIRMATION_REQUIRED',
    message: '语义画布变更已生成权威预览；尚未修改画布，请在画布中核对并批准',
    data: approval,
    nextActions: ['批准后运行 zcanvas patch apply；拒绝则不会写入。'],
  }), human, [
    patch.summary,
    `changes ${approval.preview?.changes?.length || 0}`,
    'canvas writes 0',
    '批准后运行：zcanvas patch apply',
  ]);
  return EXIT_CODES.CONFIRMATION_REQUIRED;
}

async function handleGraph(subcommand, parsed, human) {
  const action = String(subcommand || '').trim().toLowerCase();
  if (!['add', 'connect', 'disconnect', 'group', 'batch'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 graph 子命令：${action || '未提供'}；可用 add、connect、disconnect、group、batch`);
  }
  if (action === 'batch') return handlePatch('preview', parsed, human);
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) throw new AgentClientError('WORKSPACE_CONTEXT_REQUIRED', '尚未选择当前画布，请先运行 workspace use');
  if (action === 'add') {
    const expectedAction = 'graph.node-add';
    const approval = matchingCreativeApproval(instance.instanceId, expectedAction, parsed);
    if (approval) return completeCreativeApproval(instance, session, approval, human);
    if (parsed.flags.get('complete') === true || parsed.flags.get('approval')) {
      throw new AgentClientError('APPROVAL_NOT_STARTED', '找不到与当前新增节点命令匹配的待确认操作');
    }
    const type = String(parsed.flags.get('type') || '').trim();
    if (!type) throw new AgentClientError('USAGE_ERROR', 'graph add 必须提供 --type <权威节点类型>');
    const rawX = parsed.flags.get('x');
    const rawY = parsed.flags.get('y');
    const x = rawX == null ? undefined : Number(rawX);
    const y = rawY == null ? undefined : Number(rawY);
    if ((x != null && !Number.isFinite(x)) || (y != null && !Number.isFinite(y))) {
      throw new AgentClientError('USAGE_ERROR', 'graph add 的 --x/--y 必须是有效数字');
    }
    const plan = await createCreativePlan(instance, session, context, {
      action: expectedAction,
      input: {
        type,
        ...(x == null ? {} : { x }),
        ...(y == null ? {} : { y }),
        ...(parsed.flags.get('prompt') == null ? {} : { prompt: String(parsed.flags.get('prompt')) }),
        data: readGraphNodeDataFile(parsed.flags.get('file')),
      },
    });
    if (parsed.flags.get('plan-only') === true) {
      emitCreativePlan(plan, human);
      return EXIT_CODES.OK;
    }
    return requestCreativeApproval(instance, session, context, plan, parsed, human);
  }
  const inspected = await inspectGraph(instance, session, context);
  const document = inspected.data || {};
  if (document.page?.hasMoreNodes || document.page?.hasMoreEdges) {
    throw new AgentClientError('GRAPH_SCOPE_TOO_LARGE', '当前画布超过语义图操作的安全读取上限；请改用经过人工核对的 patch batch');
  }
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const edges = Array.isArray(document.edges) ? document.edges : [];
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  let operations;
  let summary;
  if (action === 'connect') {
    const source = String(parsed.flags.get('source') || '').trim();
    const target = String(parsed.flags.get('target') || '').trim();
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) {
      throw new AgentClientError('GRAPH_CONNECTION_INVALID', 'connect 需要两个存在且不同的 --source/--target 节点');
    }
    const sourceHandle = String(parsed.flags.get('source-handle') || '').trim();
    const targetHandle = String(parsed.flags.get('target-handle') || '').trim();
    const signatureExists = edges.some((edge) => edge.source === source
      && edge.target === target
      && String(edge.sourceHandle || '') === sourceHandle
      && String(edge.targetHandle || '') === targetHandle);
    if (signatureExists) throw new AgentClientError('GRAPH_CONNECTION_EXISTS', '相同端口连线已经存在');
    const edgeId = `agent-edge-${crypto.createHash('sha256').update(`${source}\0${sourceHandle}\0${target}\0${targetHandle}`).digest('hex').slice(0, 18)}`;
    operations = [{
      type: 'edge.add',
      payload: {
        edge: {
          id: edgeId,
          source,
          target,
          sourceHandle: sourceHandle || null,
          targetHandle: targetHandle || null,
        },
      },
    }];
    summary = `连接 ${source} → ${target}`;
  } else if (action === 'disconnect') {
    const requestedEdge = String(parsed.flags.get('edge') || '').trim();
    const source = String(parsed.flags.get('source') || '').trim();
    const target = String(parsed.flags.get('target') || '').trim();
    const matches = edges.filter((edge) => requestedEdge
      ? edge.id === requestedEdge
      : edge.source === source && edge.target === target);
    if (matches.length !== 1) {
      throw new AgentClientError('GRAPH_EDGE_AMBIGUOUS', matches.length
        ? '匹配到多条连线，请提供 --edge <edgeId>'
        : '没有找到要断开的连线');
    }
    operations = [{ type: 'edge.delete', payload: { edgeId: matches[0].id } }];
    summary = `断开 ${matches[0].source} → ${matches[0].target}`;
  } else {
    const requested = [...new Set(String(parsed.flags.get('nodes') || '').split(',').map((item) => item.trim()).filter(Boolean))];
    const selected = nodes.filter((node) => requested.includes(node.id) && node.type !== 'groupBox');
    if (!requested.length || selected.length !== requested.length) {
      throw new AgentClientError('GRAPH_GROUP_INVALID', 'group 需要 --nodes <nodeId,nodeId>，且所有节点必须存在并且不是已有组');
    }
    const minimumX = Math.min(...selected.map((node) => Number(node.position?.x) || 0));
    const minimumY = Math.min(...selected.map((node) => Number(node.position?.y) || 0));
    const maximumX = Math.max(...selected.map((node) => (Number(node.position?.x) || 0) + 320));
    const maximumY = Math.max(...selected.map((node) => (Number(node.position?.y) || 0) + 220));
    const groupId = `agent-group-${crypto.createHash('sha256').update(requested.sort().join('\0')).digest('hex').slice(0, 18)}`;
    operations = [{
      type: 'node.add',
      payload: {
        node: {
          id: groupId,
          type: 'groupBox',
          position: { x: minimumX - 30, y: minimumY - 70 },
          data: {
            name: String(parsed.flags.get('name') || 'Agent 节点组').slice(0, 120),
            color: '#2563eb',
            memberIds: requested,
            width: maximumX - minimumX + 60,
            height: maximumY - minimumY + 100,
          },
        },
      },
    }];
    summary = `把 ${requested.length} 个节点组成“${String(parsed.flags.get('name') || 'Agent 节点组').slice(0, 120)}”`;
  }
  const patch = {
    schema: 't8-canvas-patch-v1',
    id: `agent-graph-${crypto.randomUUID()}`,
    baseRevision: Number(document.revision),
    summary,
    requiresConfirmation: true,
    diagnosticsResolved: [],
    operations,
  };
  return requestGeneratedPatchApproval(instance, session, context, patch, human);
}

const LOCAL_MEDIA_COMMANDS = Object.freeze({
  'extract-frames': Object.freeze({
    action: 'video.extract-frames',
    sourceKind: '视频',
  }),
  'remove-solid-background': Object.freeze({
    action: 'image.remove-solid-background',
    sourceKind: '图片',
  }),
  'resample-upscale': Object.freeze({
    action: 'image.resample-upscale',
    sourceKind: '图片',
  }),
});

function localMediaCreativeRequest(subcommand, parsed) {
  const contract = LOCAL_MEDIA_COMMANDS[String(subcommand || '').trim().toLowerCase()];
  if (!contract) {
    throw new AgentClientError(
      'USAGE_ERROR',
      `未知 media 子命令：${subcommand || '未提供'}；可用 extract-frames、remove-solid-background、resample-upscale`,
    );
  }
  const sourceNodeId = String(parsed.flags.get('node') || parsed.flags.get('source') || '').trim();
  if (!sourceNodeId) {
    throw new AgentClientError('USAGE_ERROR', `${subcommand} 必须提供 --node <上游${contract.sourceKind}节点ID>`);
  }
  const input = { sourceNodeId };
  if (contract.action === 'video.extract-frames' && parsed.flags.get('count') != null) {
    const count = Number(parsed.flags.get('count'));
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new AgentClientError('USAGE_ERROR', 'extract-frames 的 --count 必须是 1-20 的整数');
    }
    input.count = count;
  }
  if (contract.action === 'image.resample-upscale' && parsed.flags.get('scale') != null) {
    const scale = Number(parsed.flags.get('scale'));
    if (![1.5, 2, 3, 4].includes(scale)) {
      throw new AgentClientError('USAGE_ERROR', 'resample-upscale 的 --scale 只支持 1.5、2、3、4');
    }
    input.scale = scale;
  }
  return { action: contract.action, input };
}

async function handleMedia(subcommand, parsed, human) {
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) throw new AgentClientError('WORKSPACE_CONTEXT_REQUIRED', '尚未选择当前画布，请先运行 workspace use');
  const request = localMediaCreativeRequest(subcommand, parsed);
  const approval = matchingCreativeApproval(instance.instanceId, request.action, parsed);
  if (approval) return completeCreativeApproval(instance, session, approval, human);
  if (parsed.flags.get('complete') === true || parsed.flags.get('approval')) {
    throw new AgentClientError('APPROVAL_NOT_STARTED', '找不到与当前本地媒体命令匹配的待确认操作');
  }
  const plan = await createCreativePlan(instance, session, context, request);
  if (parsed.flags.get('plan-only') === true || !plan.ready) {
    emitCreativePlan(plan, human);
    return plan.ready ? EXIT_CODES.OK : EXIT_CODES.CONFLICT;
  }
  return requestCreativeApproval(instance, session, context, plan, parsed, human);
}

async function handleAsset(subcommand, parsed, human) {
  const action = subcommand || 'search';
  if (!['search', 'inspect', 'version', 'lineage', 'place', 'place-apply', 'import', 'upload', 'download', 'apply'].includes(action)) {
    throw new AgentClientError(
      'USAGE_ERROR',
      '未知 asset 子命令：' + action + '；可用 search、inspect、version、lineage、place、place-apply、import、upload、download、apply',
    );
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) {
    throw new AgentClientError(
      'WORKSPACE_CONTEXT_REQUIRED',
      '尚未选择当前画布，请先运行 zcanvas workspace use --canvas <canvasId>',
    );
  }

  if (action === 'search') {
    const query = new URLSearchParams({
      projectId: context.projectId,
      canvasId: context.canvasId,
      limit: String(parsed.flags.get('limit') || '25'),
      offset: String(parsed.flags.get('offset') || '0'),
    });
    if (parsed.flags.get('kind')) query.set('kind', String(parsed.flags.get('kind')));
    if (parsed.flags.get('query')) query.set('query', String(parsed.flags.get('query')));
    const payload = await authenticatedRequest(instance, session, `/api/agent-control/v1/assets?${query.toString()}`);
    const items = Array.isArray(payload.data?.items) ? payload.data.items : [];
    emit(envelope({
      message: `找到 ${payload.data?.total ?? items.length} 个素材`,
      data: payload.data,
      nextActions: items.length ? ['使用 zcanvas asset inspect --asset <assetId> 查看版本和来源。'] : [],
    }), human, items.length
      ? items.map((item) => `${item.id} ${item.kind || ''} ${item.name || item.filename || ''}`.trim())
      : ['没有匹配素材']);
    return EXIT_CODES.OK;
  }

  if (action === 'inspect' || action === 'version' || action === 'lineage') {
    const assetId = String(parsed.flags.get('asset') || '').trim();
    if (!assetId) throw new AgentClientError('USAGE_ERROR', `${action} 必须提供 --asset <assetId>`);
    const query = new URLSearchParams({ projectId: context.projectId });
    if (action === 'lineage' || action === 'version') {
      if (parsed.flags.get('cursor')) query.set('cursor', String(parsed.flags.get('cursor')));
      query.set('limit', String(parsed.flags.get('limit') || '50'));
    }
    const suffix = action === 'lineage' || action === 'version' ? '/lineage' : '';
    const payload = await authenticatedRequest(
      instance,
      session,
      `/api/agent-control/v1/assets/${encodeURIComponent(assetId)}${suffix}?${query.toString()}`,
    );
    emit(envelope({
      message: action === 'inspect'
        ? '已返回素材详情'
        : action === 'version'
          ? '已返回素材版本与派生记录'
          : '已返回素材来源与派生关系',
      data: payload.data,
    }), human);
    return EXIT_CODES.OK;
  }

  if (action === 'place') {
    const assetId = String(parsed.flags.get('asset') || '').trim();
    if (!assetId) throw new AgentClientError('USAGE_ERROR', 'asset place 必须提供 --asset <assetId>');
    const rawX = parsed.flags.get('x');
    const rawY = parsed.flags.get('y');
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/asset-place-approvals', {
      method: 'POST',
      body: {
        ...context,
        assetId,
        ...((rawX == null && rawY == null) ? {} : {
          position: {
            ...(rawX == null ? {} : { x: Number(rawX) }),
            ...(rawY == null ? {} : { y: Number(rawY) }),
          },
        }),
        targetNodeId: String(parsed.flags.get('target') || ''),
        sourceHandle: parsed.flags.get('source-handle') == null
          ? undefined
          : String(parsed.flags.get('source-handle') || ''),
        targetHandle: parsed.flags.get('target-handle') == null
          ? undefined
          : String(parsed.flags.get('target-handle') || ''),
        operationId: String(parsed.flags.get('operation') || ''),
      },
    });
    const approval = payload.data;
    storeApproval(instance, approval);
    emit(envelope({
      ok: false,
      code: 'ASSET_PLACE_CONFIRMATION_REQUIRED',
      message: '素材节点、位置、连线和来源已预览，等待画布用户批准',
      data: {
        approvalRequestId: approval.approvalRequestId,
        operationId: approval.operationId,
        action: approval.action,
        preview: approval.preview,
        expiresAt: approval.expiresAt,
      },
      nextActions: ['在画布中核对并批准；然后运行 zcanvas asset place-apply。'],
    }), human, [
      approval.preview?.summary || '素材放置待确认',
      '本次不会读取外部文件，也不会调用 AI Provider',
      '批准后运行：zcanvas asset place-apply',
    ]);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }

  if (action === 'import' || action === 'upload') {
    const filename = String(parsed.flags.get('file') || '').trim();
    if (!filename) throw new AgentClientError('USAGE_ERROR', 'asset import 必须提供 --file <绝对路径>');
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/asset-import-approvals', {
      method: 'POST',
      body: {
        ...context,
        filePath: filename,
        operationId: String(parsed.flags.get('operation') || ''),
      },
    });
    const approval = payload.data;
    storeApproval(instance, approval);
    emit(envelope({
      ok: false,
      code: 'ASSET_IMPORT_CONFIRMATION_REQUIRED',
      message: '素材文件、用途和外发范围已预览，等待画布用户批准',
      data: {
        approvalRequestId: approval.approvalRequestId,
        operationId: approval.operationId,
        action: approval.action,
        preview: approval.preview,
        expiresAt: approval.expiresAt,
      },
      nextActions: ['在画布中核对并批准；然后运行 zcanvas asset apply。'],
    }), human, [
      approval.preview?.summary || '素材导入待确认',
      `${approval.preview?.file?.kind || ''} ${approval.preview?.file?.size || 0} bytes`,
      '本次不发送任何 AI Provider',
      '批准后运行：zcanvas asset apply',
    ]);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }

  if (action === 'download') {
    const assetId = String(parsed.flags.get('asset') || '').trim();
    const targetPath = String(parsed.flags.get('to') || '').trim();
    if (!assetId || !targetPath) {
      throw new AgentClientError('USAGE_ERROR', 'asset download 必须提供 --asset <assetId> 和 --to <绝对路径>');
    }
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/asset-download-approvals', {
      method: 'POST',
      body: {
        ...context,
        assetId,
        targetPath,
        operationId: String(parsed.flags.get('operation') || ''),
      },
    });
    const approval = payload.data;
    storeApproval(instance, approval);
    emit(envelope({
      ok: false,
      code: 'ASSET_DOWNLOAD_CONFIRMATION_REQUIRED',
      message: '素材原件、目标和外发范围已预览，等待画布用户批准',
      data: {
        approvalRequestId: approval.approvalRequestId,
        operationId: approval.operationId,
        action: approval.action,
        preview: approval.preview,
        expiresAt: approval.expiresAt,
      },
      nextActions: ['在画布中核对并批准；然后运行 zcanvas asset apply。'],
    }), human, [
      approval.preview?.summary || '素材导出待确认',
      `${approval.preview?.file?.kind || ''} ${approval.preview?.file?.size || 0} bytes`,
      '不会覆盖已有文件，也不会发送任何 AI Provider',
      '批准后运行：zcanvas asset apply',
    ]);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }

  const requestedApproval = String(parsed.flags.get('approval') || '').trim();
  const approval = loadApproval(instance.instanceId, requestedApproval);
  const allowedActions = action === 'place-apply'
    ? ['asset.place']
    : ['asset.import', 'asset.download'];
  if (!approval || !allowedActions.includes(approval.action)) {
    throw new AgentClientError(
      'APPROVAL_NOT_STARTED',
      action === 'place-apply'
        ? '没有待提交的素材放置确认，请先运行 asset place'
        : '没有待提交的素材传输确认，请先运行 asset import 或 asset download',
    );
  }
  const payload = await authenticatedRequest(
    instance,
    session,
    `/api/agent-control/v1/approvals/${encodeURIComponent(approval.approvalRequestId)}/complete`,
    { method: 'POST', body: { pollSecret: approval.pollSecret } },
  );
  const result = payload.data;
  if (result.status === 'pending') {
    emit(envelope({
      ok: false,
      code: approval.action === 'asset.place'
        ? 'ASSET_PLACE_APPROVAL_PENDING'
        : approval.action === 'asset.download' ? 'ASSET_DOWNLOAD_APPROVAL_PENDING' : 'ASSET_IMPORT_APPROVAL_PENDING',
      message: approval.action === 'asset.place'
        ? '画布用户尚未批准素材放置'
        : approval.action === 'asset.download' ? '画布用户尚未批准素材导出' : '画布用户尚未批准素材导入',
      data: { approvalRequestId: approval.approvalRequestId, status: 'pending' },
      nextActions: [approval.action === 'asset.place'
        ? '回到画布核对节点、位置、连线和来源并批准，然后重新运行 zcanvas asset place-apply。'
        : '回到画布核对素材、目标和范围并批准，然后重新运行 zcanvas asset apply。'],
    }), human);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }
  if (result.status === 'denied') {
    deleteApproval(instance.instanceId, approval.approvalRequestId);
    throw new AgentClientError(
      approval.action === 'asset.place'
        ? 'ASSET_PLACE_APPROVAL_DENIED'
        : approval.action === 'asset.download' ? 'ASSET_DOWNLOAD_APPROVAL_DENIED' : 'ASSET_IMPORT_APPROVAL_DENIED',
      approval.action === 'asset.place'
        ? '画布用户已拒绝素材放置'
        : approval.action === 'asset.download' ? '画布用户已拒绝素材导出' : '画布用户已拒绝素材导入',
    );
  }
  deleteApproval(instance.instanceId, approval.approvalRequestId);
  emit(envelope({
    message: approval.action === 'asset.place'
      ? (result.duplicate ? '素材节点已存在，已恢复原放置结果' : '素材已作为可撤回节点放入画布')
      : approval.action === 'asset.download'
      ? '素材已校验并导出到本机目录'
      : result.deduplicated
        ? '素材已复用项目中的相同内容'
        : '素材已导入当前项目',
    data: result,
    nextActions: [approval.action === 'asset.place'
      ? '可用 canvas read 核对节点和连线；运行前可用 patch revert 精确撤回。'
      : '可用 asset inspect/lineage 核对版本与来源，再在创作计划中引用稳定 assetId。'],
  }), human);
  return EXIT_CODES.OK;
}

function deliveryAssetIds(parsed) {
  return String(parsed.flags.get('asset') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function handleDelivery(subcommand, parsed, human) {
  const action = subcommand || 'collect';
  if (!['collect', 'package', 'download', 'apply', 'verify'].includes(action)) {
    throw new AgentClientError(
      'USAGE_ERROR',
      `未知 delivery 子命令：${action}；可用 collect、package、download、apply、verify`,
    );
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) {
    throw new AgentClientError(
      'WORKSPACE_CONTEXT_REQUIRED',
      '尚未选择当前画布，请先运行 zcanvas workspace use --canvas <canvasId>',
    );
  }

  if (action === 'collect') {
    const query = new URLSearchParams({
      projectId: context.projectId,
      canvasId: context.canvasId,
      scope: parsed.flags.get('scope') === 'project' ? 'project' : 'canvas',
    });
    const assetIds = deliveryAssetIds(parsed);
    if (assetIds.length) query.set('assetId', assetIds.join(','));
    const payload = await authenticatedRequest(
      instance,
      session,
      `/api/agent-control/v1/delivery/collect?${query.toString()}`,
    );
    const data = payload.data || {};
    emit(envelope({
      ok: data.ready === true,
      code: data.ready === true ? 'OK' : 'DELIVERY_INCOMPLETE',
      message: data.ready === true
        ? `已收集并校验 ${data.items?.length || 0} 个素材`
        : `交付素材尚未齐全：${data.exclusions?.length || 0} 个缺失或校验失败`,
      data,
      nextActions: data.ready === true
        ? ['运行 zcanvas delivery package --to <绝对目录> 预览交付包。']
        : ['查看 exclusions 的真实原因，修复或使用 --asset 精确选择后重新收集。'],
    }), human, [
      `scope ${data.scope || 'canvas'}`,
      `verified ${data.items?.length || 0}`,
      `excluded ${data.exclusions?.length || 0}`,
      `license unknown ${data.licenseSummary?.unknown || 0}`,
    ]);
    return data.ready === true ? EXIT_CODES.OK : EXIT_CODES.CAPABILITY_UNAVAILABLE;
  }

  if (action === 'verify') {
    const packagePath = String(parsed.flags.get('from') || parsed.flags.get('to') || '').trim();
    if (!packagePath) {
      throw new AgentClientError('USAGE_ERROR', 'delivery verify 必须提供 --from <绝对交付包目录>');
    }
    const expectedPackageDigest = String(parsed.flags.get('digest') || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedPackageDigest)) {
      throw new AgentClientError(
        'USAGE_ERROR',
        'delivery verify 必须提供创建交付包时单独保存的 --digest <64位SHA-256>；不能只信任包内清单',
      );
    }
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/delivery/verify', {
      method: 'POST',
      body: { packagePath, expectedPackageDigest },
    });
    const data = payload.data || {};
    emit(envelope({
      ok: data.valid === true,
      code: data.valid === true ? 'OK' : 'DELIVERY_VERIFY_FAILED',
      message: data.valid === true
        ? `交付包完整：${data.verifiedItems || 0} 个素材均通过哈希校验`
        : `交付包校验失败：${data.failures?.length || 0} 项异常`,
      data,
      nextActions: data.valid === true
        ? []
        : ['不要发布损坏的交付包；根据 failures 修复后重新打包。'],
    }), human, [
      `${data.valid === true ? 'VALID' : 'INVALID'} ${data.packageName || ''}`.trim(),
      `items ${data.verifiedItems || 0}/${data.itemCount || 0}`,
      `digest ${data.packageDigest || ''}`,
      `license unknown ${data.licenseSummary?.unknown || 0}`,
    ]);
    return data.valid === true ? EXIT_CODES.OK : EXIT_CODES.CAPABILITY_UNAVAILABLE;
  }

  if (action === 'package' || action === 'download') {
    const targetPath = String(parsed.flags.get('to') || '').trim();
    if (!targetPath) {
      throw new AgentClientError('USAGE_ERROR', `delivery ${action} 必须提供 --to <绝对交付包目录>`);
    }
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/delivery-package-approvals', {
      method: 'POST',
      body: {
        ...context,
        scope: parsed.flags.get('scope') === 'project' ? 'project' : 'canvas',
        assetIds: deliveryAssetIds(parsed),
        targetPath,
        operationId: String(parsed.flags.get('operation') || ''),
      },
    });
    const approval = payload.data;
    storeApproval(instance, approval);
    emit(envelope({
      ok: false,
      code: 'DELIVERY_PACKAGE_CONFIRMATION_REQUIRED',
      message: '交付素材集合、哈希、许可状态和目标目录已预览，等待画布用户批准',
      data: {
        approvalRequestId: approval.approvalRequestId,
        operationId: approval.operationId,
        action: approval.action,
        preview: approval.preview,
        expiresAt: approval.expiresAt,
      },
      nextActions: ['在画布中核对并批准；然后运行 zcanvas delivery apply。'],
    }), human, [
      approval.preview?.summary || '交付包待确认',
      `items ${approval.preview?.package?.itemCount || 0}`,
      `bytes ${approval.preview?.package?.totalBytes || 0}`,
      `license unknown ${approval.preview?.package?.assets?.filter((item) => item.licenseStatus === 'unknown').length || 0}`,
      '不会覆盖已有目录，不会调用 Provider，也不会转码',
      '批准后运行：zcanvas delivery apply',
    ]);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }

  const requestedApproval = String(parsed.flags.get('approval') || '').trim();
  const approval = loadApproval(instance.instanceId, requestedApproval);
  if (!approval || approval.action !== 'delivery.package') {
    throw new AgentClientError(
      'APPROVAL_NOT_STARTED',
      '没有待提交的交付包确认，请先运行 delivery package 或 delivery download',
    );
  }
  const payload = await authenticatedRequest(
    instance,
    session,
    `/api/agent-control/v1/approvals/${encodeURIComponent(approval.approvalRequestId)}/complete`,
    { method: 'POST', body: { pollSecret: approval.pollSecret } },
  );
  const result = payload.data;
  if (result.status === 'pending') {
    emit(envelope({
      ok: false,
      code: 'DELIVERY_PACKAGE_APPROVAL_PENDING',
      message: '画布用户尚未批准交付包',
      data: { approvalRequestId: approval.approvalRequestId, status: 'pending' },
      nextActions: ['回到画布核对素材、许可状态和目标目录并批准，然后重新运行 zcanvas delivery apply。'],
    }), human);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }
  if (result.status === 'denied') {
    deleteApproval(instance.instanceId, approval.approvalRequestId);
    throw new AgentClientError('DELIVERY_PACKAGE_APPROVAL_DENIED', '画布用户已拒绝创建交付包');
  }
  deleteApproval(instance.instanceId, approval.approvalRequestId);
  const verifyPath = String(result.targetPath || approval.preview?.package?.targetPath || '<绝对交付包目录>');
  const verifyDigest = String(result.packageDigest || '<packageDigest>');
  emit(envelope({
    message: `交付包已创建：${result.itemCount || 0} 个素材已写入哈希与许可清单`,
    data: result,
    nextActions: [
      `单独保存 digest，再运行 zcanvas delivery verify --from "${verifyPath}" --digest ${verifyDigest} 做独立复核。`,
    ],
  }), human, [
    `package ${result.packageName || ''}`,
    `items ${result.itemCount || 0}`,
    `digest ${result.packageDigest || ''}`,
    `license unknown ${result.licenseSummary?.unknown || 0}`,
  ]);
  return EXIT_CODES.OK;
}

function creatorReferenceNodeIds(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source
    .map((item) => String(item || '').trim())
    .filter(Boolean))]
    .slice(0, 8);
}

function creatorContinuationReferenceNodeIds(existing, requested, hasRequested, hasAppliedProduction) {
  if (hasRequested) return creatorReferenceNodeIds(requested);
  return hasAppliedProduction ? [] : creatorReferenceNodeIds(existing);
}

function creativeInput(parsed, extra = {}) {
  const prompt = readCreativePrompt(parsed);
  const assetIds = String(parsed.flags.get('asset') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const locks = String(parsed.flags.get('lock') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    referencedNodeIds: creatorReferenceNodeIds(parsed.flags.get('node')),
    prompt,
    goal: String(parsed.flags.get('goal') || ''),
    title: String(parsed.flags.get('title') || ''),
    audience: String(parsed.flags.get('audience') || ''),
    format: String(parsed.flags.get('format') || ''),
    duration: parsed.flags.get('duration') == null ? undefined : Number(parsed.flags.get('duration')),
    ratio: String(parsed.flags.get('ratio') || ''),
    style: String(parsed.flags.get('style') || ''),
    quality: String(parsed.flags.get('quality') || 'auto'),
    language: String(parsed.flags.get('language') || ''),
    profile: String(parsed.flags.get('profile') || 'balanced'),
    template: String(parsed.flags.get('template') || 'general'),
    recipe: String(parsed.flags.get('recipe') || ''),
    provider: String(parsed.flags.get('provider') || ''),
    model: String(parsed.flags.get('model') || ''),
    llmProvider: String(parsed.flags.get('llm-provider') || ''),
    llmModel: String(parsed.flags.get('llm-model') || ''),
    imageProvider: String(parsed.flags.get('image-provider') || ''),
    imageModel: String(parsed.flags.get('image-model') || ''),
    videoProvider: String(parsed.flags.get('video-provider') || ''),
    videoModel: String(parsed.flags.get('video-model') || ''),
    audioProvider: String(parsed.flags.get('audio-provider') || ''),
    audioModel: String(parsed.flags.get('audio-model') || ''),
    audioTask: String(parsed.flags.get('audio-task') || ''),
    voiceId: String(parsed.flags.get('voice') || ''),
    speaker: String(parsed.flags.get('speaker') || ''),
    outputFormat: String(parsed.flags.get('output-format') || ''),
    sampleRate: parsed.flags.get('sample-rate') == null ? undefined : Number(parsed.flags.get('sample-rate')),
    speechRate: parsed.flags.get('speech-rate') == null ? undefined : Number(parsed.flags.get('speech-rate')),
    loudnessRate: parsed.flags.get('loudness-rate') == null ? undefined : Number(parsed.flags.get('loudness-rate')),
    pitchRate: parsed.flags.get('pitch-rate') == null ? undefined : Number(parsed.flags.get('pitch-rate')),
    candidates: parsed.flags.get('candidates') == null ? undefined : Number(parsed.flags.get('candidates')),
    assetIds,
    locks,
    ...extra,
  };
}

function creativeOverrides(parsed) {
  const mappings = [
    ['goal', 'goal'], ['title', 'title'], ['audience', 'audience'], ['format', 'format'],
    ['duration', 'duration'], ['ratio', 'ratio'], ['style', 'style'], ['quality', 'quality'],
    ['language', 'language'], ['profile', 'profile'], ['template', 'template'], ['recipe', 'recipe'],
    ['provider', 'provider'], ['model', 'model'], ['llm-provider', 'llmProvider'],
    ['llm-model', 'llmModel'], ['image-provider', 'imageProvider'], ['image-model', 'imageModel'],
    ['video-provider', 'videoProvider'], ['video-model', 'videoModel'],
    ['audio-provider', 'audioProvider'], ['audio-model', 'audioModel'], ['candidates', 'candidates'],
    ['audio-task', 'audioTask'], ['voice', 'voiceId'], ['speaker', 'speaker'],
    ['output-format', 'outputFormat'], ['sample-rate', 'sampleRate'], ['speech-rate', 'speechRate'],
    ['loudness-rate', 'loudnessRate'], ['pitch-rate', 'pitchRate'],
  ];
  const overrides = {};
  for (const [flag, key] of mappings) {
    if (!parsed.flags.has(flag)) continue;
    overrides[key] = ['duration', 'candidates', 'sample-rate', 'speech-rate', 'loudness-rate', 'pitch-rate'].includes(flag)
      ? Number(parsed.flags.get(flag))
      : String(parsed.flags.get(flag));
  }
  if (parsed.flags.has('asset')) {
    overrides.assetIds = String(parsed.flags.get('asset')).split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (parsed.flags.has('lock')) {
    overrides.locks = String(parsed.flags.get('lock')).split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (parsed.flags.has('prompt') || parsed.flags.has('goal') || parsed.flags.has('query') || parsed.flags.has('file')) {
    overrides.prompt = readCreativePrompt(parsed);
  }
  return overrides;
}

function readCreativePrompt(parsed) {
  const positional = parsed.positionals?.[0] === 'ask'
    ? String(parsed.positionals[1] || '')
    : '';
  const inline = String(
    parsed.flags.get('prompt')
    || parsed.flags.get('goal')
    || parsed.flags.get('query')
    || positional
    || '',
  );
  const filename = String(parsed.flags.get('file') || '').trim();
  if (!filename) return inline;
  if (inline) {
    throw new AgentClientError('CREATIVE_INPUT_AMBIGUOUS', '请只使用 --prompt 或 --file 其中一种，避免剧本内容不明确');
  }
  if (!path.isAbsolute(filename)) {
    throw new AgentClientError('CREATIVE_FILE_PATH_INVALID', '剧本文件必须使用绝对路径');
  }
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (_) {
    throw new AgentClientError('CREATIVE_FILE_NOT_FOUND', '找不到剧本文件');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new AgentClientError('CREATIVE_FILE_INVALID', '剧本输入必须是普通文本文件，不能是目录或链接');
  }
  if (stat.size <= 0 || stat.size > 40 * 1024) {
    throw new AgentClientError('CREATIVE_FILE_SIZE_INVALID', '剧本文件必须在 1 字节到 40 KiB 之间；更长剧本请先分场导入，避免超过本机控制协议的安全上限');
  }
  const buffer = fs.readFileSync(filename);
  if (buffer.includes(0)) {
    throw new AgentClientError('CREATIVE_FILE_ENCODING_INVALID', '剧本文件包含二进制内容，请保存为 UTF-8 文本');
  }
  const content = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (!content.trim() || content.includes('\uFFFD')) {
    throw new AgentClientError('CREATIVE_FILE_ENCODING_INVALID', '剧本文件不是有效 UTF-8 文本');
  }
  return content;
}

function readStoryPlanFile(value) {
  const filename = String(value || '').trim();
  if (!filename || !path.isAbsolute(filename)) {
    throw new AgentClientError('STORY_FILE_PATH_INVALID', 'Story 导入必须提供 JSON 文件的绝对路径');
  }
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (_) {
    throw new AgentClientError('STORY_FILE_NOT_FOUND', '找不到 Story 导入文件');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 48 * 1024) {
    throw new AgentClientError('STORY_FILE_INVALID', 'Story 导入文件必须是 1-48 KiB 的普通 JSON 文件，不能是目录或链接');
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed;
  } catch (_) {
    throw new AgentClientError('STORY_FILE_INVALID', 'Story 导入文件不是有效 JSON 对象');
  }
}

function readGraphNodeDataFile(value) {
  const filename = String(value || '').trim();
  if (!filename) return {};
  if (!path.isAbsolute(filename)) {
    throw new AgentClientError('GRAPH_NODE_DATA_PATH_INVALID', '节点 data 必须使用 JSON 文件的绝对路径');
  }
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (_) {
    throw new AgentClientError('GRAPH_NODE_DATA_NOT_FOUND', '找不到节点 data 文件');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 16 * 1024) {
    throw new AgentClientError('GRAPH_NODE_DATA_INVALID', '节点 data 必须是 1-16 KiB 的普通 JSON 文件，不能是目录或链接');
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed;
  } catch (_) {
    throw new AgentClientError('GRAPH_NODE_DATA_INVALID', '节点 data 文件不是有效 JSON 对象');
  }
}

function readCreativeReviewFile(value) {
  const filename = String(value || '').trim();
  if (!filename || !path.isAbsolute(filename)) {
    throw new AgentClientError('CREATIVE_REVIEW_FILE_PATH_INVALID', '候选评审必须提供 JSON 文件的绝对路径');
  }
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (_) {
    throw new AgentClientError('CREATIVE_REVIEW_FILE_NOT_FOUND', '找不到候选评审文件');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 32 * 1024) {
    throw new AgentClientError('CREATIVE_REVIEW_FILE_INVALID', '候选评审必须是 1-32 KiB 的普通 JSON 文件，不能是目录或链接');
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed;
  } catch (_) {
    throw new AgentClientError('CREATIVE_REVIEW_FILE_INVALID', '候选评审文件不是有效 JSON 对象');
  }
}

function matchingCreativeApproval(instanceId, expectedAction, parsed, options = {}) {
  const requestedApproval = String(parsed.flags.get('approval') || '').trim();
  const approval = loadApproval(instanceId, requestedApproval, options);
  if (!approval || approval.action !== 'creative.apply') return null;
  if (expectedAction && approval.creativeAction && approval.creativeAction !== expectedAction) return null;
  return approval;
}

async function completeCreativeApproval(instance, session, approval, human, options = {}) {
  const payload = await authenticatedRequest(
    instance,
    session,
    `/api/agent-control/v1/approvals/${encodeURIComponent(approval.approvalRequestId)}/complete`,
    { method: 'POST', body: { pollSecret: approval.pollSecret } },
  );
  const result = payload.data;
  if (result.status === 'pending') {
    emit(envelope({
      ok: false,
      code: 'CREATIVE_APPROVAL_PENDING',
      message: '画布用户尚未批准此创作工作流变更',
      data: {
        approvalRequestId: approval.approvalRequestId,
        creativeAction: approval.creativeAction,
        status: 'pending',
      },
      nextActions: [
        '回到画布核对创作目标、候选数、连续性策略和变更范围并批准。',
        `批准后重新运行原命令，或添加 --complete --approval ${approval.approvalRequestId}。`,
      ],
    }), human);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }
  if (result.status === 'denied') {
    deleteApproval(instance.instanceId, approval.approvalRequestId);
    throw new AgentClientError('CREATIVE_APPROVAL_DENIED', '画布用户已拒绝此创作工作流变更');
  }
  deleteApproval(instance.instanceId, approval.approvalRequestId);
  if (typeof options.onApplied === 'function') await options.onApplied(result);
  emit(envelope({
    message: '创作工作流已写入画布；没有自动启动模型',
    data: result,
    nextActions: [
      '运行 zcanvas doctor inspect 核对最新 revision。',
      '需要生成时先运行 zcanvas run plan；节点范围、Provider 与模型会再次独立确认。',
    ],
  }), human, [
    `applied ${result.patchId}`,
    `revision ${result.revision}`,
    'provider calls 0',
    'generation not started',
  ]);
  return EXIT_CODES.OK;
}

async function createCreativePlan(instance, session, context, body) {
  return (await authenticatedRequest(instance, session, '/api/agent-control/v1/creative-plans', {
    method: 'POST',
    body: { ...context, ...body },
  })).data;
}

async function syncCreatorSession(instance, session, creatorSession, plan, prompt) {
  const attachmentOnly = creatorSession.request?.inputMode === 'attachments-only';
  const assetIds = Array.isArray(creatorSession.request?.assetIds) ? creatorSession.request.assetIds : [];
  const referencedNodeIds = creatorReferenceNodeIds(creatorSession.request?.referencedNodeIds);
  const payload = await authenticatedRequest(
    instance,
    session,
    '/api/agent-control/v1/creator-sessions',
    {
      method: 'POST',
      body: {
        sessionId: creatorSession.id,
        projectId: creatorSession.projectId,
        canvasId: creatorSession.canvasId,
        title: String(creatorSession.request?.title || (attachmentOnly ? '' : creatorSession.prompt) || '').slice(0, 160),
        prompt: attachmentOnly ? '' : String(prompt || creatorSession.prompt || ''),
        planId: plan?.planId || '',
        planDigest: plan?.planDigest || '',
        assetIds,
        context: {
          phase: creatorSession.kind === 'story' ? 'script' : 'idea',
          referencedNodeIds,
        },
      },
    },
  );
  const synced = payload.data?.session || payload.data;
  if (!synced || synced.id !== creatorSession.id) {
    throw new AgentClientError(
      'CREATOR_SESSION_SYNC_FAILED',
      '创作计划已保存到本机，但未能与画布内 Agent 核对为同一个会话',
    );
  }
  return synced;
}

function persistAuthoritativeCreatorSession(checkpoint, remote) {
  return saveCreatorSession(mergeCreatorSessionAuthority(checkpoint, remote));
}

async function readAuthoritativeCreatorSession(instance, session, checkpoint) {
  let remote;
  try {
    remote = (await authenticatedRequest(
      instance,
      session,
      `/api/agent-control/v1/creator-sessions/${encodeURIComponent(checkpoint.id)}`
        + `?projectId=${encodeURIComponent(checkpoint.projectId)}`
        + `&canvasId=${encodeURIComponent(checkpoint.canvasId)}`,
    )).data;
  } catch (error) {
    if (error?.code === 'CREATOR_SESSION_NOT_FOUND') {
      throw new AgentClientError(
        'CREATOR_SESSION_AUTHORITY_NOT_FOUND',
        '本机只保留了会话索引，但画布中的权威创作会话不存在；已停止继续，避免从旧副本新建重复工作流',
      );
    }
    throw error;
  }
  try {
    return persistAuthoritativeCreatorSession(checkpoint, remote);
  } catch (error) {
    if (error instanceof CreatorSessionError) {
      throw new AgentClientError(error.code, error.message);
    }
    throw error;
  }
}

async function syncCreatorLifecycle(instance, session, creatorSession, type, payload = {}) {
  const response = await authenticatedRequest(
    instance,
    session,
    `/api/agent-control/v1/creator-sessions/${encodeURIComponent(creatorSession.id)}/events`,
    {
      method: 'POST',
      body: {
        projectId: creatorSession.projectId,
        canvasId: creatorSession.canvasId,
        type,
        payload,
      },
    },
  );
  return response.data;
}

function emitCreativePlan(plan, human) {
  emit(envelope({
    ok: true,
    code: plan.ready ? 'CREATIVE_PLAN_READY' : 'CREATIVE_INPUT_REQUIRED',
    message: plan.ready
      ? '创作计划已生成；当前没有修改画布，也没有调用 Provider'
      : '创作计划需要补充少量关键信息；当前没有修改画布，也没有调用 Provider',
    data: plan,
    warnings: plan.questions || [],
    nextActions: plan.ready
      ? [`运行对应 create/iterate/director/video-edit 命令创建确认请求；计划 ${plan.planId} 不会自动执行。`]
      : (plan.questions || []).map((item) => item.question),
  }), human, [
    `${plan.profileLabel || plan.profile} · ${plan.action}`,
    `候选 ${plan.candidateCount}`,
    `画布变更 ${plan.impact?.patchOperationCount || 0} 项`,
    '当前写入 0 · Provider 调用 0',
    ...(plan.questions || []).map((item) => `需要确认：${item.question}`),
  ]);
}

async function requestCreativeApproval(instance, session, context, plan, parsed, human) {
  const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/creative-approvals', {
    method: 'POST',
    body: {
      ...context,
      planId: plan.planId,
      operationId: String(parsed.flags.get('operation') || ''),
    },
  });
  const approval = payload.data;
  storeApproval(instance, approval);
  emit(envelope({
    ok: false,
    code: 'CREATIVE_CONFIRMATION_REQUIRED',
    message: '创作工作流已完成权威预览，等待画布用户批准',
    data: {
      approvalRequestId: approval.approvalRequestId,
      action: approval.action,
      creativeAction: approval.preview?.creator?.action,
      patchId: approval.patchId,
      preview: approval.preview,
      expiresAt: approval.expiresAt,
    },
    nextActions: [
      '在画布中核对创作目标、候选、锁定策略和节点变更后批准。',
      '批准后重新运行原命令；CLI 会提交同一个确认，不会再建一套节点。',
    ],
  }), human, [
    approval.preview?.summary || '创作工作流待确认',
    `profile ${approval.preview?.creator?.profileLabel || '平衡创作'}`,
    `candidates ${approval.preview?.creator?.candidateCount || 1}`,
    `changes ${approval.preview?.changes?.length || 0}`,
    'Provider 调用 0',
  ]);
  return EXIT_CODES.CONFIRMATION_REQUIRED;
}

async function handleModel(subcommand, parsed, human) {
  const action = subcommand || 'list';
  if (!['list', 'search', 'schema'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 model 子命令：${action}；可用 list、search、schema`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) throw new AgentClientError('WORKSPACE_CONTEXT_REQUIRED', '尚未选择当前画布，请先运行 workspace use');
  if (action === 'search' && !parsed.flags.get('query')) {
    throw new AgentClientError('USAGE_ERROR', 'model search 必须提供 --query <关键词>');
  }
  if (action === 'schema' && !parsed.flags.get('model')) {
    throw new AgentClientError('USAGE_ERROR', 'model schema 必须提供 --model <模型名>');
  }
  const query = new URLSearchParams(context);
  if (parsed.flags.get('kind')) query.set('kind', String(parsed.flags.get('kind')));
  if (action === 'search') query.set('query', String(parsed.flags.get('query')));
  if (action === 'schema') query.set('query', String(parsed.flags.get('model')));
  const payload = await authenticatedRequest(instance, session, `/api/agent-control/v1/models?${query.toString()}`);
  let data = payload.data;
  if (action === 'schema') {
    const requested = String(parsed.flags.get('model'));
    const item = (data.items || []).find((candidate) => candidate.model === requested);
    if (!item) throw new AgentClientError('MODEL_NOT_AVAILABLE', '当前桌面、画布和已配置平台都无法证明此模型可用');
    data = {
      schema: 't8-agent-model-parameters-v1',
      item,
      basis: data.basis,
      readinessSummary: data.readinessSummary,
      warning: data.warning,
    };
  }
  const runtimeLabel = (item) => item?.readiness?.executable === true
    ? 'ready'
    : item?.readiness
      ? 'blocked'
      : item?.configured
        ? 'configured'
        : 'known';
  const firstBlocker = (item) => String(item?.readiness?.blockers?.[0]?.message || '').trim();
  emit(envelope({
    message: action === 'schema' ? '已返回已知模型参数与当前运行就绪态' : `已返回 ${data.total ?? data.items?.length ?? 1} 个真实模型记录及运行就绪态`,
    data,
  }), human, action === 'schema'
    ? [
      `${data.item.kind} ${data.item.provider} ${data.item.model}`,
      `runtime ${runtimeLabel(data.item)} installed=${data.item.readiness?.installed ?? 'unknown'} credentialReady=${data.item.readiness?.credentialReady ?? 'unknown'} regionReady=${data.item.readiness?.regionReady ?? 'unknown'}`,
      ...(firstBlocker(data.item) ? [`blocker ${firstBlocker(data.item)}`] : []),
      JSON.stringify(data.item.parameters || {}),
    ]
    : (data.items || []).map((item) => `${runtimeLabel(item)} ${item.kind} ${item.provider} ${item.model}${firstBlocker(item) ? ` · ${firstBlocker(item)}` : ''}`));
  return EXIT_CODES.OK;
}

function projectRecipeBinding(projectId, recipeId) {
  const normalized = String(recipeId || '').trim().toLowerCase();
  if (!normalized || BUILT_IN_RECIPE_IDS.has(normalized)) return null;
  const record = findRecipe(projectId, normalized);
  return {
    schema: 't8-project-recipe-binding-v1',
    name: record.name,
    version: record.version,
    contentDigest: record.contentDigest,
    definition: record.definition,
  };
}

async function handleRecipe(subcommand, parsed, human) {
  const action = subcommand || 'list';
  if (!['list', 'show', 'save', 'export', 'import', 'pin', 'rollback', 'verify'].includes(action)) {
    throw new AgentClientError(
      'USAGE_ERROR',
      `未知 recipe 子命令：${action}；可用 list、show、save、export、import、pin、rollback、verify`,
    );
  }
  const { instance } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) {
    throw new AgentClientError(
      'WORKSPACE_CONTEXT_REQUIRED',
      '尚未选择当前项目，请先运行 zcanvas workspace use --canvas <canvasId>',
    );
  }
  const projectId = context.projectId;
  const name = String(parsed.flags.get('name') || parsed.flags.get('recipe') || '').trim().toLowerCase();
  const revision = parsed.flags.get('revision') == null
    ? undefined
    : Number(parsed.flags.get('revision'));
  let data;
  let message;
  if (action === 'list') {
    data = { schema: 't8-project-recipe-list-v1', projectId, items: listRecipes(projectId) };
    message = `当前项目有 ${data.items.length} 个自定义创作配方`;
  } else if (action === 'verify') {
    data = { projectId, ...verifyProjectRecipes(projectId) };
    message = data.valid ? `项目配方签名校验通过：${data.total} 个版本` : '项目配方签名校验失败';
  } else {
    if (!name && action !== 'import') {
      throw new AgentClientError('USAGE_ERROR', `recipe ${action} 必须提供 --name <项目配方名>`);
    }
    if (action === 'show') {
      data = findRecipe(projectId, name, revision);
      message = `已读取项目配方 ${data.name} v${data.version}`;
    } else if (action === 'save') {
      const filename = String(parsed.flags.get('file') || '').trim();
      if (!filename) throw new AgentClientError('USAGE_ERROR', 'recipe save 必须提供 --file <绝对配方JSON>');
      const source = readRecipeFile(filename);
      const definition = source.schema === RECIPE_EXPORT_SCHEMA ? source.record?.definition : source;
      data = saveRecipe(projectId, name, definition);
      message = `已保存并固定项目配方 ${data.name} v${data.version}`;
    } else if (action === 'import') {
      const filename = String(parsed.flags.get('file') || '').trim();
      if (!filename) throw new AgentClientError('USAGE_ERROR', 'recipe import 必须提供 --file <绝对配方JSON>');
      data = importRecipe(projectId, filename, { name: name || undefined });
      message = `已导入、重新签名并固定项目配方 ${data.name} v${data.version}`;
    } else if (action === 'export') {
      const filename = String(parsed.flags.get('to') || '').trim();
      if (!filename) throw new AgentClientError('USAGE_ERROR', 'recipe export 必须提供 --to <绝对导出JSON>');
      data = exportRecipe(projectId, name, filename, { version: revision });
      message = `已导出项目配方 ${data.name} v${data.version}`;
    } else if (action === 'pin') {
      if (!Number.isInteger(revision) || revision < 1) {
        throw new AgentClientError('USAGE_ERROR', 'recipe pin 必须提供 --revision <正整数版本>');
      }
      data = pinRecipe(projectId, name, revision);
      message = `已固定项目配方 ${data.name} v${data.version}`;
    } else {
      data = rollbackRecipe(projectId, name);
      message = `已把项目配方 ${data.name} 回滚并固定到 v${data.version}`;
    }
  }
  emit(envelope({
    ok: action === 'verify' ? data.valid : true,
    code: action === 'verify' && !data.valid ? 'RECIPE_VERIFY_FAILED' : 'OK',
    message,
    data,
    nextActions: action === 'save' || action === 'import' || action === 'pin' || action === 'rollback'
      ? [`创作时直接说目标并指定 --recipe ${data.name}；系统会自动分析并显示可编辑假设。`]
      : [],
  }), human, [
    message,
    ...(data.items || []).map((item) =>
      `${item.verified ? 'verified' : 'invalid'} ${item.name} pinned v${item.pinnedVersion} latest v${item.latestVersion}`),
  ]);
  return action === 'verify' && !data.valid ? EXIT_CODES.CONFLICT : EXIT_CODES.OK;
}

async function handleCreate(subcommand, parsed, human) {
  const kind = subcommand || 'plan-card';
  if (!['plan-card', 'image', 'edit-image', 'video', 'edit-video', 'audio', 'script', 'story'].includes(kind)) {
    throw new AgentClientError('USAGE_ERROR', `未知 create 子命令：${kind}；可用 plan-card、image、video、audio、script、story`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) throw new AgentClientError('WORKSPACE_CONTEXT_REQUIRED', '尚未选择当前画布，请先运行 workspace use');
  const expectedAction = kind === 'plan-card' ? '' : `create.${kind}`;
  const planOnly = kind === 'plan-card' || parsed.flags.get('plan-only') === true;
  if (!planOnly) {
    const approval = matchingCreativeApproval(instance.instanceId, expectedAction, parsed);
    if (approval) return completeCreativeApproval(instance, session, approval, human);
    if (parsed.flags.get('complete') === true || parsed.flags.get('approval')) {
      throw new AgentClientError('APPROVAL_NOT_STARTED', '找不到与当前创作命令匹配的待确认操作');
    }
  }
  const targetKind = String(parsed.flags.get('type') || 'image');
  const input = {
      kind,
      targetKind,
      ...creativeInput(parsed),
  };
  const recipeDefinition = projectRecipeBinding(context.projectId, input.recipe);
  if (recipeDefinition) input.recipeDefinition = recipeDefinition;
  const plan = await createCreativePlan(instance, session, context, { input });
  if (planOnly || !plan.ready) {
    emitCreativePlan(plan, human);
    return plan.ready ? EXIT_CODES.OK : EXIT_CODES.CONFLICT;
  }
  return requestCreativeApproval(instance, session, context, plan, parsed, human);
}

async function handleEdit(subcommand, parsed, human) {
  const target = String(subcommand || '').trim().toLowerCase();
  if (!['image', 'video'].includes(target)) {
    throw new AgentClientError('USAGE_ERROR', `未知 edit 子命令：${target || '未提供'}；可用 image、video`);
  }
  const assetIds = String(parsed.flags.get('asset') || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!assetIds.length) {
    throw new AgentClientError('CREATIVE_EDIT_REFERENCE_REQUIRED', 'edit 必须提供至少一个当前项目的 --asset <assetId>');
  }
  return handleCreate(`edit-${target}`, parsed, human);
}

function inferCreatorKind(prompt, requested = '') {
  const explicit = String(requested || '').trim().toLowerCase();
  const supported = new Set(['image', 'edit-image', 'video', 'edit-video', 'audio', 'script', 'story']);
  if (supported.has(explicit)) return explicit;
  const value = String(prompt || '').toLowerCase();
  const hasSpokenDuration = /\d+(?:\.\d+)?\s*(?:秒|秒钟|s(?:ec(?:ond)?s?)?|分钟|分|min(?:ute)?s?)/i.test(value);
  if (/(?:tvc|广告片|宣传片|品牌广告|商品广告)/i.test(value)
    || (hasSpokenDuration && /广告/i.test(value))
    || (hasSpokenDuration && /(?:\bmv\b|音乐视频|music video)/i.test(value))
    || (/(?:完整|制作|做一条|做一个|生成).{0,12}\bmv\b/i.test(value) && hasSpokenDuration)) {
    return 'story';
  }
  if (/(?:story|短剧|完整制片|剧本.*(?:分镜|短片|视频|成片|制作)|分镜.*成片|镜头.*资产)/i.test(value)) return 'story';
  if (/(?:对口型|口型同步|音频驱动|数字人口播|让.{0,12}(?:照片|图片|人物).{0,12}说话|lip.?sync|audio.?driven|talking.?head)/i.test(value)) {
    return 'video';
  }
  if (/(?:这段|这个|当前|原来|原始|已有).{0,8}(?:视频|短片)|视频.{0,8}(?:续写|延长|改成|替换|修改|重剪|remix)|(?:续写|延长|修改|重剪).{0,8}视频/i.test(value)) {
    return 'edit-video';
  }
  if (/(?:这张|这个|当前|原来|原始|已有).{0,8}(?:图|图片|照片|海报)|(?:把|将).{0,16}(?:换成|改成|去掉|删除|替换)|(?:局部修改|扩图|重绘|inpaint|outpaint)/i.test(value)) {
    return 'edit-image';
  }
  if (/(?:音频|音乐|配乐|歌曲|翻唱|续写音乐|配音|朗读|用.{0,10}(?:声音|女声|男声).{0,10}(?:说|读)|语音|对白音频|旁白音频|环境声|音效|雨声|风声|转写|听写|字幕|soundtrack|audio|music|voice.?over|\btts\b|\bstt\b|transcrib|ambien|sound effect)/i.test(value)) return 'audio';
  if (/(?:剧本|脚本|文案|旁白|台词|大纲)/i.test(value)) return 'script';
  if (/(?:视频|动画|运镜|成片|tvc|mv|短片)/i.test(value)) return 'video';
  return 'image';
}

function inferCreatorRecipe(prompt, explicit = '') {
  const requested = String(explicit || '').trim().toLowerCase();
  if (requested) return requested;
  const value = String(prompt || '').toLowerCase();
  if (/(?:短剧|micro.?drama|short.?drama)/i.test(value)) return 'short-drama';
  if (/(?:tvc|广告片|商品广告|品牌广告|宣传片)/i.test(value)
    || (/\d+(?:\.\d+)?\s*(?:秒|秒钟|s(?:ec(?:ond)?s?)?|分钟|分|min(?:ute)?s?)/i.test(value)
      && /广告/i.test(value))) return 'tvc';
  if (/(?:mv|音乐视频|music video)/i.test(value)) return 'mv';
  if (/(?:商品图|产品主图|电商图|product shot)/i.test(value)) return 'product';
  if (/(?:知识讲解|教程|科普|education)/i.test(value)) return 'education';
  if (/(?:角色设定|三视图|character sheet)/i.test(value)) return 'character-sheet';
  if (/(?:分镜|storyboard)/i.test(value)) return 'storyboard';
  if (/(?:改编|复刻|参考.*修改|remake)/i.test(value)) return 'remake';
  return 'general';
}

async function handleAsk(parsed, human) {
  const prompt = readCreativePrompt(parsed);
  const baseInput = creativeInput(parsed);
  const attachmentOnly = !prompt.trim() && baseInput.assetIds.length > 0;
  if (!prompt.trim() && !attachmentOnly) {
    throw new AgentClientError(
      'CREATIVE_INPUT_REQUIRED',
      'ask 必须提供一句创作要求、--file，或至少一个已导入的 --asset <assetId>',
    );
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = await creatorWorkspaceContext(instance, session);
  const requestedKind = String(parsed.flags.get('type') || parsed.flags.get('kind') || '').trim().toLowerCase();
  const kind = prompt.trim() ? inferCreatorKind(prompt, requestedKind) : requestedKind;
  const recipe = prompt.trim()
    ? inferCreatorRecipe(prompt, parsed.flags.get('recipe'))
    : String(parsed.flags.get('recipe') || 'general').trim().toLowerCase();
  const input = {
    ...baseInput,
    ...(kind ? { kind } : {}),
    ...(prompt.trim() ? { prompt } : {}),
    recipe,
  };
  const recipeDefinition = projectRecipeBinding(context.projectId, recipe);
  if (recipeDefinition) input.recipeDefinition = recipeDefinition;
  const plan = await createCreativePlan(instance, session, context, { input });
  const resolvedKind = String(plan.kind || kind || 'story');
  const effectivePrompt = String(prompt || plan.brief?.goal || '').trim();
  const creatorSession = saveCreatorSession({
    instanceId: instance.instanceId,
    ...context,
    prompt: effectivePrompt,
    kind: resolvedKind,
    profile: input.profile,
    request: {
      ...input,
      kind: resolvedKind,
      prompt: effectivePrompt,
      ...(attachmentOnly ? { inputMode: 'attachments-only' } : {}),
    },
    planId: plan.planId,
    planDigest: plan.planDigest,
    planExpiresAt: plan.expiresAt,
    status: plan.ready ? 'planned' : 'needs-input',
    linkedNodeId: plan.targets?.primaryNodeId || '',
    storyNodeId: plan.targets?.storyNodeId || '',
  });
  const remoteCreatorSession = await syncCreatorSession(instance, session, creatorSession, plan, effectivePrompt);
  const authoritativeCreatorSession = persistAuthoritativeCreatorSession(creatorSession, remoteCreatorSession);
  emit(envelope({
    ok: plan.ready,
    code: plan.ready ? 'CREATOR_SESSION_READY' : 'CREATIVE_INPUT_REQUIRED',
    message: plan.ready
      ? '已建立可恢复的创作会话和可编辑计划；没有修改画布或调用 Provider'
      : '已保存创作会话，但还需要补充少量关键信息',
    data: { creatorSession: authoritativeCreatorSession, authoritativeSession: remoteCreatorSession, plan },
    warnings: plan.questions || [],
    nextActions: plan.ready
      ? [
          '向创作者展示系统假设、镜头/资产/声音分析和变更范围；创作者不需要输入任何 CLI 命令。',
          '创作者在对话中确认后，由 Agent 使用此 Creator Session 发起同一个画布批准；不要新建第二套计划。',
        ]
      : (plan.questions || []).map((item) => item.question),
  }), human, [
    `session ${creatorSession.id}`,
    `${resolvedKind} · ${plan.profileLabel || plan.profile}`,
    `candidates ${plan.candidateCount}`,
    `changes ${plan.impact?.patchOperationCount || 0}`,
    'canvas writes 0 · provider calls 0',
  ]);
  return plan.ready ? EXIT_CODES.OK : EXIT_CODES.CONFLICT;
}

function hasAppliedCreatorProduction(creatorSession = {}) {
  return ['applied', 'needs-incremental-plan'].includes(String(creatorSession.status || ''))
    && Boolean(creatorSession.linkedNodeId || creatorSession.storyNodeId);
}

function incrementalShotRefs(direction = '') {
  const refs = [];
  const value = String(direction || '');
  for (const match of value.matchAll(/(?:镜头|第)\s*#?\s*(\d{1,3})/g)) {
    const index = Number(match[1]);
    if (index > 0 && index <= 200) refs.push(index);
  }
  return [...new Set(refs)];
}

function compileIncrementalDirection(direction, creatorSession = {}, production = null) {
  const prompt = String(direction || '').trim();
  if (!prompt) return null;
  const normalized = prompt.toLowerCase();
  const kind = String(creatorSession.kind || 'image').toLowerCase();
  const isStory = kind === 'story' || Boolean(creatorSession.storyNodeId);
  const strictScope = /(?:只|仅|不要动|其余|其他.*不变|保持.*不变|别变)/i.test(prompt);
  const shotIndexes = incrementalShotRefs(prompt);
  const changeDimensions = [];
  const preserve = new Set([
    'accepted-results',
    'uploaded-assets',
    'locked-assets',
    'completed-unaffected',
  ]);
  let operation = isStory ? 'story.revise-affected' : `edit.${kind.includes('video') ? 'video' : 'image'}`;
  let scope = strictScope ? 'explicit-affected-only' : 'affected-unlocked';
  let requiresRunIntentLookup = false;
  const preservedIdentity = /(?:人物|角色|脸|发型|年龄|身份).{0,5}(?:不变|别变|保持|锁定)|(?:保持|锁定).{0,5}(?:人物|角色|脸|发型|年龄|身份)/i.test(prompt);
  const preservedWardrobe = /(?:服装|衣服|外套|裙子|裤子|鞋|造型).{0,5}(?:不变|别变|保持|锁定)|(?:保持|锁定).{0,5}(?:服装|衣服|外套|裙子|裤子|鞋|造型)/i.test(prompt);
  const preservedComposition = /(?:构图|机位|景别|运镜|镜头角度).{0,5}(?:不变|别变|保持|锁定)|(?:保持|锁定).{0,5}(?:构图|机位|景别|运镜|镜头角度)/i.test(prompt);
  const preservedBackground = /(?:背景|环境|天气|场景).{0,5}(?:不变|别变|保持|锁定)|(?:保持|锁定).{0,5}(?:背景|环境|天气|场景)/i.test(prompt);
  if (preservedIdentity) preserve.add('identity');
  if (preservedWardrobe) preserve.add('wardrobe');
  if (preservedComposition) preserve.add('composition');
  if (preservedBackground) preserve.add('background');

  if (/(?:只.*重试|重试).*(?:失败|没成功)|(?:继续|恢复).*(?:失败|没完成)/i.test(prompt)) {
    operation = 'run.retry-failed';
    scope = 'failed-only';
    requiresRunIntentLookup = true;
    preserve.add('successful-attempts');
    preserve.add('verified-assets');
  } else if (/(?:只.*(?:补|生成)|继续).*(?:缺失|没生成|未生成)|(?:补齐).*(?:缺失|没生成)/i.test(prompt)) {
    operation = 'run.fill-missing';
    scope = 'missing-only';
    requiresRunIntentLookup = true;
    preserve.add('successful-attempts');
    preserve.add('verified-assets');
  }

  if (!preservedBackground && /(?:背景|环境|天气|白天|夜晚|清晨|黄昏|室内|室外)/i.test(prompt)) {
    changeDimensions.push('background');
    preserve.add('identity');
    preserve.add('wardrobe');
    preserve.add('composition-unless-explicit');
  }
  if (!preservedWardrobe && /(?:服装|衣服|外套|裙子|裤子|鞋|造型)/i.test(prompt)) {
    changeDimensions.push('wardrobe');
    preserve.add('identity');
    preserve.add('background-unless-explicit');
    preserve.add('composition-unless-explicit');
  }
  if (!preservedIdentity && /(?:人物|角色|脸|发型|年龄|身份)/i.test(prompt)) {
    changeDimensions.push('identity');
    preserve.add('background-unless-explicit');
    preserve.add('composition-unless-explicit');
  }
  if (!preservedComposition && /(?:构图|机位|景别|运镜|镜头角度)/i.test(prompt)) {
    changeDimensions.push('composition');
    preserve.add('identity');
    preserve.add('wardrobe');
  }
  if (/(?:节奏|时长|秒|分钟|剪辑|转场)/i.test(prompt)) {
    changeDimensions.push('timing');
    preserve.add('visual-identity');
  }
  if (/(?:字幕|文字|文案|标题|台词|旁白)/i.test(prompt)) {
    changeDimensions.push('text-or-dialogue');
    preserve.add('visual-identity');
  }
  if (/(?:产品|商品|外形|logo|标志|包装)/i.test(prompt)) {
    changeDimensions.push('product-or-brand');
    preserve.add('product-shape-unless-explicit');
    preserve.add('brand-assets-unless-explicit');
  }

  if (!changeDimensions.length && !operation.startsWith('run.')) changeDimensions.push('creator-specified-detail');
  const targetNodeId = String(creatorSession.storyNodeId || creatorSession.linkedNodeId || '');
  const storyId = String(production?.storyId || production?.project?.storyId || '');
  return {
    schema: 't8-creator-incremental-plan-v1',
    direction: prompt,
    target: {
      nodeId: targetNodeId,
      storyId: storyId || null,
      sameProduction: true,
    },
    operation,
    scope,
    strictScope,
    shotIndexes,
    changeDimensions: [...new Set(changeDimensions)],
    preserve: [...preserve],
    requiresRunIntentLookup,
    requiresPreview: true,
    requiresApproval: true,
    writesNow: 0,
    providerCallsNow: 0,
    duplicateSourceWorkflow: false,
    summary: operation === 'run.retry-failed'
      ? '只恢复原生产中的失败范围，复用已成功结果'
      : operation === 'run.fill-missing'
        ? '只补原生产中的缺失范围，复用已完成素材'
        : `在原生产上只修改：${[...new Set(changeDimensions)].join('、')}`,
  };
}

async function handleContinue(parsed, human) {
  const checkpoint = getCreatorSession(String(parsed.flags.get('session') || ''));
  if (!checkpoint) throw new AgentClientError('CREATOR_SESSION_NOT_FOUND', '没有找到可继续的创作会话');
  const instance = await selectInstance(checkpoint.instanceId);
  const session = loadSession(instance.instanceId);
  if (!session) throw new AgentClientError('PAIRING_REQUIRED', '此创作会话对应的画布尚未连接 Agent，请先重新配对');
  const creatorSession = await readAuthoritativeCreatorSession(instance, session, checkpoint);
  const overrides = creativeOverrides(parsed);
  const hasAppliedProduction = hasAppliedCreatorProduction(creatorSession);
  const referencedNodeIds = creatorContinuationReferenceNodeIds(
    creatorSession.request?.referencedNodeIds,
    parsed.flags.get('node'),
    parsed.flags.has('node'),
    hasAppliedProduction,
  );
  const wantsCompletion = parsed.flags.get('complete') === true || parsed.flags.has('approval');
  if (wantsCompletion && !hasAppliedProduction) {
    const expectedAction = `create.${creatorSession.kind}`;
    const approval = matchingCreativeApproval(instance.instanceId, expectedAction, parsed);
    if (approval) {
      return completeCreativeApproval(instance, session, approval, human, {
        async onApplied(result) {
          const applied = saveCreatorSession({
            ...creatorSession,
            status: 'applied',
          });
          const remote = await syncCreatorLifecycle(instance, session, applied, 'plan.applied', result);
          persistAuthoritativeCreatorSession(applied, remote);
        },
      });
    }
    if (parsed.flags.has('approval')) {
      throw new AgentClientError('APPROVAL_NOT_STARTED', '找不到属于此创作会话的待确认操作；不会新建重复工作流');
    }
    if (hasAppliedProduction) {
      throw new AgentClientError(
        'CREATOR_SESSION_ALREADY_APPLIED',
        '这份创作工作流已经写入画布；不会再次创建相同节点。请继续编辑原生产链。',
      );
    }
  }
  const context = {
    projectId: creatorSession.projectId,
    canvasId: creatorSession.canvasId,
  };
  if (hasAppliedProduction) {
    let production = null;
    if (creatorSession.storyNodeId) {
      production = (await authenticatedRequest(instance, session, '/api/agent-control/v1/creative-read', {
        method: 'POST',
        body: {
          ...context,
          action: 'story.inspect',
          input: { storyId: creatorSession.storyNodeId },
        },
      })).data;
    }
    const requestedDirection = String(overrides.prompt || '').trim();
    const compiledIncrementalPlan = compileIncrementalDirection(requestedDirection, creatorSession, production);
    const incrementalPlan = compiledIncrementalPlan && referencedNodeIds.length > 0
      ? {
          ...compiledIncrementalPlan,
          references: { nodeIds: referencedNodeIds },
        }
      : compiledIncrementalPlan;
    if (requestedDirection && incrementalPlan) {
      const existingApproval = wantsCompletion
        ? matchingCreativeApproval(instance.instanceId, 'production.continue', parsed)
        : null;
      if (existingApproval) {
        return completeCreativeApproval(instance, session, existingApproval, human, {
          async onApplied(result) {
            const applied = saveCreatorSession({
              ...creatorSession,
              prompt: `${creatorSession.prompt}\n\n继续要求：${requestedDirection}`,
              status: 'applied',
              lastDirection: requestedDirection,
              incrementalPlan,
            });
            const remote = await syncCreatorLifecycle(instance, session, applied, 'plan.applied', result);
            persistAuthoritativeCreatorSession(applied, remote);
          },
        });
      }
      if (wantsCompletion && parsed.flags.has('approval')) {
        throw new AgentClientError(
          'APPROVAL_NOT_STARTED',
          '找不到属于此增量计划的待确认操作；不会新建重复工作流',
        );
      }
      const plan = await createCreativePlan(instance, session, context, {
        action: 'production.continue',
        input: {
          nodeId: incrementalPlan.target.nodeId,
          incrementalPlan,
          referencedNodeIds,
        },
      });
      const resumed = saveCreatorSession({
        ...creatorSession,
        prompt: `${creatorSession.prompt}\n\n继续要求：${requestedDirection}`,
        request: {
          ...creatorSession.request,
          prompt: `${creatorSession.request?.prompt || creatorSession.prompt}\n\n继续要求：${requestedDirection}`,
          referencedNodeIds,
        },
        status: 'incremental-planned',
        lastDirection: requestedDirection,
        incrementalPlan,
        planId: plan.planId,
        planDigest: plan.planDigest,
        planExpiresAt: plan.expiresAt,
      });
      const remote = await syncCreatorSession(instance, session, resumed, plan, resumed.prompt);
      const authoritativeResumed = persistAuthoritativeCreatorSession(resumed, remote);
      if (wantsCompletion) {
        return requestCreativeApproval(instance, session, context, plan, parsed, human);
      }
      emit(envelope({
        code: 'CREATOR_SESSION_INCREMENTAL_PLAN_READY',
        message: '已在原生产上生成可检查的增量 CanvasPatch；没有新建第二套 Story、写画布或调用 Provider',
        data: { creatorSession: authoritativeResumed, authoritativeSession: remote, production, requestedDirection, incrementalPlan, plan },
        nextActions: [
          '向创作者展示只会变化和必须保持不变的范围；创作者无需输入任何命令。',
          '创作者确认后，由 Agent 对同一增量计划发起画布批准；不会重建源工作流。',
        ],
      }), human);
      return EXIT_CODES.OK;
    }
    const resumed = saveCreatorSession({
      ...creatorSession,
      prompt: requestedDirection
        ? `${creatorSession.prompt}\n\n继续要求：${requestedDirection}`
        : creatorSession.prompt,
      request: requestedDirection
        ? {
            ...creatorSession.request,
            prompt: `${creatorSession.request?.prompt || creatorSession.prompt}\n\n继续要求：${requestedDirection}`,
            referencedNodeIds,
          }
        : { ...creatorSession.request, referencedNodeIds },
      status: requestedDirection ? 'needs-incremental-plan' : 'applied',
      lastDirection: requestedDirection || creatorSession.lastDirection || '',
      incrementalPlan: incrementalPlan || creatorSession.incrementalPlan || null,
    });
    emit(envelope({
      code: requestedDirection ? 'CREATOR_SESSION_DIRECTION_RECORDED' : 'CREATOR_SESSION_ACTIVE',
      message: requestedDirection
        ? '已恢复原生产并记录新的修改方向；不会创建第二套 Story 或重复提交任务'
        : '已恢复原生产；不会创建第二套 Story 或重复提交任务',
      data: { creatorSession: resumed, production, requestedDirection, incrementalPlan },
      nextActions: requestedDirection
        ? [
            `${incrementalPlan?.summary || '针对原生产规划非破坏增量修改'}；先展示影响范围，不创建第二套源工作流。`,
            '创作者确认后，Agent 把此结构化增量计划路由到同一 story/edit/iterate/run 预览与批准合同。',
          ]
        : ['根据当前缺失、失败或未锁定项继续原生产；不要重新创建源工作流。'],
    }), human);
    return EXIT_CODES.OK;
  }
  const request = {
    ...creatorSession.request,
    ...overrides,
    referencedNodeIds,
    ...(overrides.prompt
      ? { prompt: `${creatorSession.request.prompt || creatorSession.prompt}\n\n继续要求：${overrides.prompt}` }
      : {}),
  };
  const plan = await createCreativePlan(instance, session, context, { input: request });
  const refreshed = saveCreatorSession({
    ...creatorSession,
    prompt: request.prompt,
    request,
    planId: plan.planId,
    planDigest: plan.planDigest,
    planExpiresAt: plan.expiresAt,
    status: plan.ready ? 'planned' : 'needs-input',
    linkedNodeId: plan.targets?.primaryNodeId || creatorSession.linkedNodeId || '',
    storyNodeId: plan.targets?.storyNodeId || creatorSession.storyNodeId || '',
  });
  const remote = await syncCreatorSession(instance, session, refreshed, plan, request.prompt);
  const authoritativeRefreshed = persistAuthoritativeCreatorSession(refreshed, remote);
  if (parsed.flags.get('complete') === true) {
    if (!plan.ready) {
      throw new AgentClientError('CREATIVE_PLAN_NEEDS_INPUT', '创作会话仍有关键问题未确认，未发起画布变更', 0, {
        questions: plan.questions,
      });
    }
    return requestCreativeApproval(instance, session, context, plan, parsed, human);
  }
  emit(envelope({
    ok: plan.ready,
    code: plan.ready ? 'CREATOR_SESSION_RESUMED' : 'CREATIVE_INPUT_REQUIRED',
    message: '已从同一画布和同一创作要求恢复计划；当前没有写入或 Provider 调用',
    data: { creatorSession: authoritativeRefreshed, authoritativeSession: remote, plan },
    warnings: plan.questions || [],
    nextActions: plan.ready
      ? ['向创作者展示增量计划；创作者在对话中确认后，由 Agent 继续同一 Creator Session 并发起画布批准。']
      : (plan.questions || []).map((item) => item.question),
  }), human);
  return plan.ready ? EXIT_CODES.OK : EXIT_CODES.CONFLICT;
}

function handleSessions(human) {
  const sessions = listCreatorSessions();
  emit(envelope({
    message: sessions.length ? `已返回 ${sessions.length} 个本机创作会话检查点` : '还没有本机创作会话',
    data: { sessions },
    nextActions: sessions.length
      ? ['使用 zcanvas continue --session <id> 恢复同一画布和创作目标。']
      : ['使用 zcanvas ask --prompt <创作要求> 建立第一个会话。'],
  }), human, sessions.length
    ? sessions.map((item) => `${item.id} ${item.kind} ${item.status} ${item.title}`)
    : ['没有创作会话']);
  return EXIT_CODES.OK;
}

async function handleIterate(subcommand, parsed, human) {
  const action = subcommand || 'compare';
  if (!['compare', 'review', 'lock', 'unlock', 'branch', 'accept', 'rollback'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 iterate 子命令：${action}；可用 compare、review、lock、unlock、branch、accept、rollback`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) throw new AgentClientError('WORKSPACE_CONTEXT_REQUIRED', '尚未选择当前画布，请先运行 workspace use');
  const nodeId = String(parsed.flags.get('node') || '');
  if (action === 'compare') {
    if (!nodeId && !parsed.flags.get('group') && !parsed.flags.get('scope')) {
      throw new AgentClientError('USAGE_ERROR', 'iterate compare 必须提供 --node <候选节点> 或 --group <creativeGroupId>');
    }
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/creative-read', {
      method: 'POST',
      body: {
        ...context,
        action: 'compare',
        input: {
          nodeId,
          groupId: String(parsed.flags.get('group') || parsed.flags.get('scope') || ''),
        },
      },
    });
    emit(envelope({
      message: `已返回 ${payload.data.candidates?.length || 0} 个可比较候选`,
      data: payload.data,
      nextActions: payload.data.requiresVisualReview
        ? ['先让具备视觉能力的 Agent 查看返回的安全媒体引用，并用 iterate review 记录实际构图、身份、产品外形、节奏和文字检查；不要只比较 Prompt 或模型名。']
        : ['根据实际作品评审比较候选；采用后会自动形成相应锁，再只重试失败、缺失或未锁定项。'],
    }), human, (payload.data.candidates || []).map((item) =>
      `${item.accepted ? 'accepted' : 'candidate'} #${item.candidateIndex} ${item.nodeId} ${item.status} ${item.model || ''}`));
    return EXIT_CODES.OK;
  }
  if (!nodeId) throw new AgentClientError('USAGE_ERROR', `iterate ${action} 必须提供 --node <nodeId>`);
  const expectedAction = action;
  const approval = matchingCreativeApproval(instance.instanceId, expectedAction, parsed);
  if (approval) return completeCreativeApproval(instance, session, approval, human);
  if (parsed.flags.get('complete') === true || parsed.flags.get('approval')) {
    throw new AgentClientError('APPROVAL_NOT_STARTED', '找不到与当前迭代命令匹配的待确认操作');
  }
  const plan = await createCreativePlan(instance, session, context, {
    action,
    input: {
      nodeId,
      ...(action === 'review' ? { review: readCreativeReviewFile(parsed.flags.get('file')) } : {}),
      lock: String(parsed.flags.get('lock') || ''),
      label: String(parsed.flags.get('label') || ''),
      version: String(parsed.flags.get('target') || parsed.flags.get('revision') || ''),
    },
  });
  if (parsed.flags.get('plan-only') === true) {
    emitCreativePlan(plan, human);
    return EXIT_CODES.OK;
  }
  return requestCreativeApproval(instance, session, context, plan, parsed, human);
}

async function handleStory(subcommand, parsed, human) {
  const action = subcommand || 'inspect';
  const supported = ['analyze', 'inspect', 'import', 'bind-asset', 'compile', 'plan-previews', 'adopt-preview'];
  if (!supported.includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 story 子命令：${action}；可用 ${supported.join('、')}`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) throw new AgentClientError('WORKSPACE_CONTEXT_REQUIRED', '尚未选择当前画布，请先运行 workspace use');
  const storyId = String(parsed.flags.get('story') || parsed.flags.get('node') || '');
  if (!storyId) throw new AgentClientError('USAGE_ERROR', `story ${action} 必须提供 --story <storyNodeId>`);

  if (action === 'inspect') {
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/creative-read', {
      method: 'POST',
      body: { ...context, action: 'story.inspect', input: { storyId } },
    });
    emit(envelope({
      message: `Story“${payload.data.title || storyId}”有 ${payload.data.shots?.length || 0} 个镜头、${payload.data.assets?.length || 0} 个资产`,
      data: payload.data,
      nextActions: payload.data.nextActions || [],
    }), human);
    return EXIT_CODES.OK;
  }

  const creativeAction = `story.${action}`;
  const approval = matchingCreativeApproval(instance.instanceId, creativeAction, parsed);
  if (approval) return completeCreativeApproval(instance, session, approval, human);
  if (parsed.flags.get('complete') === true || parsed.flags.get('approval')) {
    throw new AgentClientError('APPROVAL_NOT_STARTED', '找不到与当前 Story 命令匹配的待确认操作');
  }
  const input = {
    storyId,
    shot: String(parsed.flags.get('shot') || ''),
    assetId: String(parsed.flags.get('asset') || ''),
    to: String(parsed.flags.get('to') || ''),
    candidateId: String(parsed.flags.get('candidate') || ''),
    ...(action === 'import' ? { payload: readStoryPlanFile(parsed.flags.get('file')) } : {}),
  };
  if (action === 'bind-asset' && (!input.assetId || !input.to)) {
    throw new AgentClientError('USAGE_ERROR', 'story bind-asset 必须提供 --asset <projectAssetId> --to <storyAssetId>');
  }
  if (action === 'adopt-preview' && (!input.shot || !input.candidateId)) {
    throw new AgentClientError('USAGE_ERROR', 'story adopt-preview 必须提供 --shot <shotId> --candidate <acceptedImageNodeId>');
  }
  const plan = await createCreativePlan(instance, session, context, {
    action: creativeAction,
    input,
  });
  if (parsed.flags.get('plan-only') === true) {
    emitCreativePlan(plan, human);
    return EXIT_CODES.OK;
  }
  return requestCreativeApproval(instance, session, context, plan, parsed, human);
}

async function handleDirector(subcommand, parsed, human) {
  const action = subcommand || 'inspect';
  if (!['materialize', 'inspect'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 director 子命令：${action}；可用 materialize、inspect`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) throw new AgentClientError('WORKSPACE_CONTEXT_REQUIRED', '尚未选择当前画布，请先运行 workspace use');
  const nodeId = String(parsed.flags.get('node') || '');
  const storyNodeId = String(parsed.flags.get('story') || '');
  if (!nodeId && !storyNodeId) throw new AgentClientError('USAGE_ERROR', `director ${action} 必须提供 --story <storyNodeId> 或 --node <directorNodeId>`);
  if (action === 'inspect') {
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/creative-read', {
      method: 'POST',
      body: { ...context, action: 'director.inspect', input: { nodeId, storyNodeId } },
    });
    emit(envelope({ message: `已返回 ${payload.data.shots?.length || 0} 个镜头`, data: payload.data }), human);
    return EXIT_CODES.OK;
  }
  const expectedAction = 'director.materialize';
  const approval = matchingCreativeApproval(instance.instanceId, expectedAction, parsed);
  if (approval) return completeCreativeApproval(instance, session, approval, human);
  if (parsed.flags.get('complete') === true || parsed.flags.get('approval')) {
    throw new AgentClientError('APPROVAL_NOT_STARTED', '找不到与当前导演分镜命令匹配的待确认操作');
  }
  const plan = await createCreativePlan(instance, session, context, {
    action: expectedAction,
    input: { storyNodeId: storyNodeId || nodeId, nodeId: String(parsed.flags.get('to') || '') },
  });
  if (parsed.flags.get('plan-only') === true) {
    emitCreativePlan(plan, human);
    return EXIT_CODES.OK;
  }
  return requestCreativeApproval(instance, session, context, plan, parsed, human);
}

async function handleVideoEdit(subcommand, parsed, human) {
  const action = subcommand || 'deliver';
  if (!['compose', 'deliver'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 video-edit 子命令：${action}；可用 compose、deliver`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) throw new AgentClientError('WORKSPACE_CONTEXT_REQUIRED', '尚未选择当前画布，请先运行 workspace use');
  const nodeId = String(parsed.flags.get('node') || '');
  if (!nodeId) throw new AgentClientError('USAGE_ERROR', `video-edit ${action} 必须提供 --node <nodeId>`);
  if (action === 'deliver') {
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/creative-read', {
      method: 'POST',
      body: { ...context, action: 'video-edit.deliver', input: { nodeId } },
    });
    emit(envelope({
      ok: payload.data.ready === true,
      code: payload.data.ready ? 'DELIVERY_READY' : 'DELIVERY_NOT_READY',
      message: payload.data.ready ? '成片交付证据已通过检查' : '成片尚未达到可交付状态',
      data: payload.data,
      nextActions: payload.data.nextActions || [],
    }), human);
    return payload.data.ready ? EXIT_CODES.OK : EXIT_CODES.CONFLICT;
  }
  const expectedAction = 'video-edit.compose';
  const approval = matchingCreativeApproval(instance.instanceId, expectedAction, parsed);
  if (approval) return completeCreativeApproval(instance, session, approval, human);
  if (parsed.flags.get('complete') === true || parsed.flags.get('approval')) {
    throw new AgentClientError('APPROVAL_NOT_STARTED', '找不到与当前剪辑命令匹配的待确认操作');
  }
  const plan = await createCreativePlan(instance, session, context, {
    action: expectedAction,
    input: { nodeId, to: String(parsed.flags.get('to') || '') },
  });
  if (parsed.flags.get('plan-only') === true) {
    emitCreativePlan(plan, human);
    return EXIT_CODES.OK;
  }
  return requestCreativeApproval(instance, session, context, plan, parsed, human);
}

async function handleBrowser(subcommand, parsed, human) {
  const action = subcommand || 'status';
  if (!['status', 'open', 'focus', 'highlight', 'screenshot', 'inspect-visible-error'].includes(action)) {
    throw new AgentClientError(
      'USAGE_ERROR',
      `未知 browser 子命令：${action}；可用 status、open、focus、highlight、screenshot、inspect-visible-error`,
    );
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) {
    throw new AgentClientError(
      'WORKSPACE_CONTEXT_REQUIRED',
      '尚未选择当前画布，请先运行 zcanvas workspace use --canvas <canvasId>',
    );
  }
  const nodeId = String(parsed.flags.get('node') || '').trim();
  if (action === 'highlight' && !nodeId) {
    throw new AgentClientError('USAGE_ERROR', 'browser highlight 必须提供 --node <nodeId>');
  }
  const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/browser-handoffs', {
    method: 'POST',
    body: {
      ...context,
      action,
      userInitiated: action !== 'status',
      ...(nodeId ? { nodeId } : {}),
    },
  });
  emit(envelope({
    code: 'BROWSER_HANDOFF_READY',
    message: action === 'status'
      ? '已返回当前画布的 Chrome 安全边界；没有执行浏览器动作'
      : '已生成当前画布的 Chrome 交接，但尚未打开、高亮、截图或检查页面；需要 Agent 的 Chrome 能力继续执行',
    data: payload.data,
    nextActions: [
      '如果当前 Agent 具备 Chrome 控制能力，只在 allowedOrigins 唯一列出的当前画布 origin 对应标签页执行请求。',
      '如果没有 Chrome 控制能力，把 url 返回给用户手动打开；不要改用 DOM 点击执行画布业务。',
    ],
  }), human, [
    `action ${payload.data.action}`,
    `executed ${payload.data.executed === true}`,
    `url ${payload.data.url}`,
    'scope current-tab-only',
    'cookies/profile/storage/other-tabs: not read',
  ]);
  return EXIT_CODES.OK;
}

async function completeRunApproval(instance, session, approval, human) {
  const payload = await authenticatedRequest(
    instance,
    session,
    `/api/agent-control/v1/approvals/${encodeURIComponent(approval.approvalRequestId)}/complete`,
    { method: 'POST', body: { pollSecret: approval.pollSecret } },
  );
  const result = payload.data;
  if (result.status === 'pending') {
    emit(envelope({
      ok: false,
      code: 'RUN_APPROVAL_PENDING',
      message: '画布用户尚未批准此运行',
      data: { approvalRequestId: approval.approvalRequestId, status: 'pending' },
      nextActions: ['回到画布核对节点范围、Provider 和模型并批准，然后重新执行同一 run 命令。'],
    }), human);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }
  if (result.status === 'denied') {
    deleteApproval(instance.instanceId, approval.approvalRequestId);
    throw new AgentClientError('RUN_APPROVAL_DENIED', '画布用户已拒绝此运行');
  }
  deleteApproval(instance.instanceId, approval.approvalRequestId);
  emit(envelope({
    message: approval.action === 'run.retry'
      ? '失败范围重试请求已进入持久队列'
      : '运行请求已进入持久队列',
    data: result,
    nextActions: [`运行 zcanvas run watch --intent ${result.id} 观察真实进度。`],
  }), human, [
    `intent ${result.id}`,
    `status ${result.status}`,
    `nodes ${(result.nodeIds || []).length}`,
    'exactly-once queue accepted',
  ]);
  return EXIT_CODES.OK;
}

const RUN_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'stopped', 'interrupted']);

function runWatchCursor(result) {
  return [
    Math.max(0, Number(result?.updatedAt) || 0),
    Math.max(0, Number(result?.queueRevision) || 0),
    String(result?.status || ''),
    String(result?.runId || ''),
  ].join(':');
}

function runWatchStage(result) {
  const status = String(result?.status || '').toLowerCase();
  if (status === 'completed' && result?.completionVerified === true) return 'delivery-ready';
  if (status === 'completed') return 'artifact-verification';
  if (['failed', 'cancelled', 'stopped', 'interrupted'].includes(status)) return 'terminal';
  if (['running', 'processing', 'in_progress'].includes(status)) return 'provider-and-download';
  if (['accepted', 'queued', 'pending', 'created'].includes(status)) return 'queue';
  return 'unknown';
}

function runWatchEnvelope(result, action, sequence) {
  const verified = result.status !== 'completed' || result.completionVerified === true;
  const failed = String(result.status || '').toLowerCase() === 'failed';
  const recovery = failed
    ? {
        schema: 't8-creator-recovery-v1',
        whatFailed: '原运行中仍有失败项',
        existingWorkSafe: true,
        existingWorkState: '已成功并验证的素材继续保留，不会随失败项重试而重新生成',
        duplicateSubmissionPrevented: true,
        nextActions: [`从原 intent ${result.id} 只重试失败范围。`],
      }
    : result.status === 'completed' && !verified
      ? {
          schema: 't8-creator-recovery-v1',
          whatFailed: 'Provider 已结束，但作品下载、校验或落库证据还不完整',
          existingWorkSafe: true,
          existingWorkState: '已有画布和已验证素材保持不变；当前结果不会被误报为成功',
          duplicateSubmissionPrevented: true,
          nextActions: ['继续原 intent 的下载或验证阶段，不要重新提交 Provider。'],
        }
      : null;
  return envelope({
    ok: verified,
    code: verified ? 'RUN_WATCH_EVENT' : 'RUN_ARTIFACT_VERIFICATION_PENDING',
    message: result.status === 'completed' && !verified
      ? '队列显示已完成，但输出素材尚未通过 Run/Attempt/Asset 持久化校验'
      : action === 'resume'
        ? '已从持久运行记录恢复观察'
        : '已返回真实运行状态',
    data: {
      ...result,
      watch: {
        sequence,
        cursor: runWatchCursor(result),
        stage: runWatchStage(result),
        terminal: RUN_TERMINAL_STATUSES.has(String(result.status || '')),
      },
      ...(recovery ? { recovery } : {}),
    },
    nextActions: failed
      ? recovery.nextActions
      : result.status === 'completed' && !verified
        ? recovery.nextActions
        : [],
  });
}

async function fetchRunIntent(instance, session, context, intentId) {
  const query = new URLSearchParams(context);
  return (await authenticatedRequest(
    instance,
    session,
    `/api/agent-control/v1/run-intents/${encodeURIComponent(intentId)}?${query.toString()}`,
  )).data;
}

async function watchRunIntent(instance, session, context, intentId, options = {}) {
  const intervalMs = Math.max(250, Math.min(30_000, Number(options.intervalMs) || 1_000));
  const timeoutMs = Math.max(intervalMs, Math.min(24 * 60 * 60 * 1_000, Number(options.timeoutMs) || 30 * 60 * 1_000));
  const follow = options.follow !== false;
  const startedAt = Date.now();
  const fetchIntent = typeof options.fetchIntent === 'function'
    ? options.fetchIntent
    : () => fetchRunIntent(instance, session, context, intentId);
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : (delay) => new Promise((resolve) => setTimeout(resolve, delay));
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  let lastCursor = String(options.cursor || '');
  let sequence = 0;
  const events = [];
  while (true) {
    const result = await fetchIntent();
    const cursor = runWatchCursor(result);
    if (cursor !== lastCursor) {
      sequence += 1;
      const event = runWatchEnvelope(result, options.action || 'watch', sequence);
      events.push(event);
      lastCursor = cursor;
      if (onEvent) await onEvent(event);
    }
    if (!follow || RUN_TERMINAL_STATUSES.has(String(result.status || ''))) return events;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new AgentClientError(
        'RUN_WATCH_TIMEOUT',
        `持续观察已达到 ${timeoutMs}ms；运行仍保留，可用同一 intent 继续 resume`,
        0,
        { intentId, cursor: lastCursor, timeoutMs },
      );
    }
    await sleep(intervalMs);
  }
}

async function handleRun(subcommand, parsed, human) {
  const action = subcommand || 'watch';
  if (!['plan', 'start', 'watch', 'resume', 'cancel', 'retry'].includes(action)) {
    throw new AgentClientError('USAGE_ERROR', `未知 run 子命令：${action}；可用 plan、start、watch、resume、cancel、retry`);
  }
  const { instance, session } = await authenticatedInstance(parsed);
  const context = getWorkspaceContext(instance.instanceId);
  if (!context) {
    throw new AgentClientError(
      'WORKSPACE_CONTEXT_REQUIRED',
      '尚未选择当前画布，请先运行 zcanvas workspace use --canvas <canvasId>',
    );
  }

  if (action === 'plan') {
    const nodeIds = String(parsed.flags.get('node') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const payload = await authenticatedRequest(instance, session, '/api/agent-control/v1/run-plans', {
      method: 'POST',
      body: {
        ...context,
        ...(parsed.flags.get('revision') ? { canvasRevision: Number(parsed.flags.get('revision')) } : {}),
        nodeIds,
        mode: String(parsed.flags.get('scope') || 'missing-failed-unlocked'),
      },
    });
    const plan = payload.data;
    emit(envelope({
      ok: true,
      code: 'RUN_PLAN_READY',
      message: '运行计划已生成；不会自动启动，且仍需在画布中明确批准',
      data: plan,
      warnings: [...(plan.warnings || []), ...(plan.blockers || [])],
      nextActions: [
        `运行 zcanvas run start --plan ${plan.planId}，然后在画布中核对节点范围、Provider 与模型并批准。`,
      ],
    }), human, [
      `plan ${plan.planId}`,
      `nodes ${plan.authorizedNodeIds.length}`,
      `providers ${(plan.declarations || []).length}`,
    ]);
    return EXIT_CODES.OK;
  }

  if (action === 'start' || action === 'retry') {
    const requestedApproval = String(parsed.flags.get('approval') || '').trim();
    const saved = loadApproval(instance.instanceId, requestedApproval);
    if (saved && saved.action === (action === 'retry' ? 'run.retry' : 'run.start')) {
      return completeRunApproval(instance, session, saved, human);
    }
    const endpoint = action === 'retry'
      ? '/api/agent-control/v1/run-retry-approvals'
      : '/api/agent-control/v1/run-start-approvals';
    const body = action === 'retry'
      ? {
          ...context,
          intentId: String(parsed.flags.get('intent') || ''),
          operationId: String(parsed.flags.get('operation') || ''),
        }
      : {
          ...context,
          planId: String(parsed.flags.get('plan') || ''),
          operationId: String(parsed.flags.get('operation') || ''),
        };
    if (action === 'retry' && !body.intentId) throw new AgentClientError('USAGE_ERROR', 'run retry 必须提供 --intent <intentId>');
    if (action === 'start' && !body.planId) throw new AgentClientError('USAGE_ERROR', 'run start 必须提供 --plan <planId>');
    const payload = await authenticatedRequest(instance, session, endpoint, { method: 'POST', body });
    const approval = payload.data;
    storeApproval(instance, approval);
    emit(envelope({
      ok: false,
      code: action === 'retry' ? 'RUN_RETRY_CONFIRMATION_REQUIRED' : 'RUN_START_CONFIRMATION_REQUIRED',
      message: action === 'retry'
        ? '只重试失败范围的计划已预览，等待画布用户批准'
        : '运行范围、Provider 与模型已预览，等待画布用户批准',
      data: {
        approvalRequestId: approval.approvalRequestId,
        operationId: approval.operationId,
        action: approval.action,
        preview: approval.preview,
        expiresAt: approval.expiresAt,
      },
      nextActions: [`在画布中核对并批准，然后重新运行 zcanvas run ${action}${action === 'start' ? ` --plan ${body.planId}` : ` --intent ${body.intentId}`}`],
    }), human);
    return EXIT_CODES.CONFIRMATION_REQUIRED;
  }

  const intentId = String(parsed.flags.get('intent') || '').trim();
  if (action === 'cancel') {
    if (!intentId) throw new AgentClientError('USAGE_ERROR', 'run cancel 必须提供 --intent <intentId>');
    const inspectedQuery = new URLSearchParams(context);
    const inspected = await authenticatedRequest(
      instance,
      session,
      `/api/agent-control/v1/run-intents/${encodeURIComponent(intentId)}?${inspectedQuery.toString()}`,
    );
    const payload = await authenticatedRequest(
      instance,
      session,
      `/api/agent-control/v1/run-intents/${encodeURIComponent(intentId)}/cancel`,
      {
        method: 'POST',
        body: {
          ...context,
          expectedQueueRevision: inspected.data.queueRevision,
        },
      },
    );
    emit(envelope({
      message: '取消请求已持久化，不会再提交新的 Provider 任务',
      data: payload.data,
    }), human);
    return EXIT_CODES.OK;
  }

  let selectedIntentId = intentId;
  if (!selectedIntentId) {
    const query = new URLSearchParams(context);
    const list = (await authenticatedRequest(
      instance,
      session,
      `/api/agent-control/v1/run-intents?${query.toString()}`,
    )).data?.items || [];
    const result = list[0] || null;
    if (!result) throw new AgentClientError('RUN_INTENT_NOT_FOUND', '当前 Agent 在此画布没有运行记录');
    selectedIntentId = result.id;
  }
  const events = await watchRunIntent(instance, session, context, selectedIntentId, {
    action,
    follow: parsed.flags.get('once') !== true,
    intervalMs: parsed.flags.get('interval-ms'),
    timeoutMs: parsed.flags.get('timeout'),
    cursor: parsed.flags.get('cursor'),
    onEvent: async (event) => {
      emit(event, human, [
        `${event.data.status} ${event.data.id}`,
        `cursor ${event.data.watch.cursor}`,
        event.data.completionVerified ? 'artifacts verified' : 'artifacts not yet verified',
      ]);
    },
  });
  const finalEvent = events[events.length - 1];
  return finalEvent?.ok === false ? EXIT_CODES.CONFLICT : EXIT_CODES.OK;
}

async function runCli(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    const recovery = creatorRecoveryForError(error);
    writeJson(envelope({
      ok: false,
      code: error.code || 'USAGE_ERROR',
      message: `${recovery.whatFailed}。${error.message || '创作请求参数无效'}`,
      data: { recovery },
      nextActions: recovery.nextActions,
    }));
    return EXIT_CODES.USAGE_ERROR;
  }

  const human = parsed.flags.get('human') === true;
  const command = parsed.flags.get('version')
    ? 'version'
    : parsed.flags.get('help')
      ? 'help'
      : String(parsed.positionals[0] || 'help').toLowerCase();

  const subcommand = String(parsed.positionals[1] || '').toLowerCase();
  const acceptsOneLinePrompt = command === 'ask' && parsed.positionals.length === 2;
  const acceptsCatalogSubcommand = COMMANDS.some((item) => (
    item.name === command && item.subcommands.length > 0
  ));
  if (parsed.positionals.length > 2
    || (parsed.positionals.length > 1 && !acceptsCatalogSubcommand && !acceptsOneLinePrompt)) {
    emit(envelope({
      ok: false,
      code: 'USAGE_ERROR',
      message: `命令 ${command} 暂不接受子命令或位置参数`,
      nextActions: ['运行 zcanvas help 查看当前已实现能力。'],
    }), human);
    return EXIT_CODES.USAGE_ERROR;
  }

  const manifest = readManifest();

  if (command === 'help') {
    emit(envelope({
      message: '已返回 zcanvas 命令说明',
      data: helpData(),
    }), human, humanHelp());
    return EXIT_CODES.OK;
  }

  if (command === 'version') {
    const data = {
      cliVersion: manifest.cliVersion,
      skillName: manifest.skillName,
      skillVersion: manifest.skillVersion,
      minimumDesktopVersion: manifest.minimumDesktopVersion,
      controlProtocol: CONTROL_PROTOCOL,
      responseSchema: RESPONSE_SCHEMA,
      canvasPatchProtocol: manifest.canvasPatchProtocol,
    };
    emit(envelope({ message: 'zcanvas 版本信息', data }), human, [
      `zcanvas ${data.cliVersion}`,
      `Skill ${data.skillName}@${data.skillVersion}`,
      `Desktop >= ${data.minimumDesktopVersion}`,
      `Protocol ${data.controlProtocol}`,
    ]);
    return EXIT_CODES.OK;
  }

  if (command === 'capabilities') {
    const instances = await discoverInstances();
    const implemented = COMMANDS.filter((item) => item.available).map((item) => item.name);
    const offlineSafe = new Set(['help', 'version', 'capabilities', 'status', 'skill', 'app', 'sessions']);
    const runtime = await capabilityRuntime(instances);
    const operations = operationCapabilities(runtime);
    const runtimeAvailableSet = new Set(
      operations.filter((item) => item.runtimeAvailable).map((item) => item.operation.split('.')[0]),
    );
    emit(envelope({
      message: runtime.workspaceBound
        ? '已返回 CLI 能力；画布、配对与工作区均可用'
        : runtime.pairingAuthenticated
          ? '画布与安全配对可用；请先选择工作区后再执行创作命令'
          : runtime.instanceSelected
            ? '画布实例在线；业务命令需先完成安全配对'
        : '已返回 CLI 已实现能力；当前画布未运行，只有离线安全命令可立即执行',
      data: {
        semantics: 'implementation-and-runtime-availability',
        ...runtime,
        implemented,
        runtimeAvailable: implemented.filter((name) => runtimeAvailableSet.has(name) || offlineSafe.has(name)),
        planned: COMMANDS.filter((item) => !item.available),
        operations,
        creativeCapabilityManifestDigest: manifest.creativeCapabilityManifestDigest,
        creativeCapabilityGraphDigest: manifest.creativeCapabilityGraphDigest,
        creativeCapabilityCoverage: manifest.creativeCapabilityCoverage,
        creativeOperationRiskByLevel: manifest.creativeCapabilityCoverage.counts.operationRiskByLevel,
        creativeCapabilities: manifest.creativeCapabilities,
        evidenceLegend: {
          implemented: '代码和命令合同存在',
          runtimeAvailable: '当前本机上下文具备调用前提',
          operationRisk: '每个动作分别声明 L0-L3；只读 plan/preview/verify 固定为 L0，不能沿用能力级别概括',
          creativeRuntimeReadiness: 'known 只代表目录存在；只有 executable=true 且 blockers 为空才代表当前会话可执行',
          verified: '至少有本地合同测试；不等于真实 Provider、Chrome 或发布环境验收',
        },
        knownExternalGaps: [
          '公开不可变下载 URL、签名和 fresh-machine 安装证据由发布流程提供；当前 CLI 只校验本地版本包整包 SHA-256。',
          'browser 命令只生成安全 handoff；必须由具备 Chrome 控制能力的宿主实际打开、高亮或截图。',
          'Provider 生成结果必须由连接中的 Desktop/Provider 返回并通过 Run/Attempt/Asset 产物验证。',
        ],
      },
    }), human, COMMANDS.map((item) => `${item.available ? 'available' : 'planned  '} ${item.name}`));
    return EXIT_CODES.OK;
  }

  if (command === 'status') {
    const instances = await discoverInstances();
    const requested = String(parsed.flags.get('instance') || '').trim();
    const selected = requested
      ? instances.find((item) => item.instanceId === requested)
      : instances.length === 1
        ? instances[0]
        : null;
    if (!selected) {
      const ambiguous = !requested && instances.length > 1;
      const code = ambiguous ? 'APP_INSTANCE_AMBIGUOUS' : 'APP_NOT_RUNNING';
      const recovery = creatorRecoveryForError({ code });
      emit(envelope({
        ok: false,
        code,
        message: ambiguous
          ? `${recovery.whatFailed}；请从作品名称和最后活动中选择`
          : recovery.whatFailed,
        data: {
          cliReady: true,
          appConnected: false,
          controlProtocol: CONTROL_PROTOCOL,
          instances,
          recovery,
        },
        nextActions: recovery.nextActions,
      }), human);
      return ambiguous ? EXIT_CODES.CONFLICT : EXIT_CODES.APP_NOT_RUNNING;
    }
    emit(envelope({
      message: '贞贞无限画布实例已连接',
      data: {
        cliReady: true,
        appConnected: true,
        controlProtocol: CONTROL_PROTOCOL,
        instance: selected,
      },
    }), human, [
      `connected ${selected.appVersion}`,
      selected.origin,
      selected.instanceId,
    ]);
    return EXIT_CODES.OK;
  }

  if (command === 'app') {
    if (!['', 'list', 'discover'].includes(subcommand)) {
      emit(envelope({
        ok: false,
        code: 'USAGE_ERROR',
        message: `未知 app 子命令：${subcommand}`,
        nextActions: ['使用 zcanvas app list。'],
      }), human);
      return EXIT_CODES.USAGE_ERROR;
    }
    const instances = await discoverInstances();
    emit(envelope({
      message: instances.length
        ? `发现 ${instances.length} 个可连接实例`
        : '没有发现可连接的贞贞无限画布实例',
      data: { instances },
      nextActions: instances.length ? [] : ['启动贞贞无限画布后重试。'],
    }), human, instances.length
      ? instances.map((item) => `${item.appVersion} ${item.origin} ${item.instanceId}`)
      : ['没有发现可连接的贞贞无限画布实例']);
    return EXIT_CODES.OK;
  }

  if (command === 'skill') {
    try {
      return handleSkill(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'sessions') {
    try {
      return handleSessions(human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'recipe') {
    try {
      return await handleRecipe(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'ask') {
    try {
      return await handleAsk(parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'continue') {
    try {
      return await handleContinue(parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'auth') {
    try {
      return await handleAuth(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'workspace') {
    try {
      return await handleWorkspace(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'doctor') {
    try {
      return await handleDoctor(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'patch') {
    try {
      return await handlePatch(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'graph') {
    try {
      return await handleGraph(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'asset') {
    try {
      return await handleAsset(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'delivery') {
    try {
      return await handleDelivery(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'model') {
    try {
      return await handleModel(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'media') {
    try {
      return await handleMedia(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'create') {
    try {
      return await handleCreate(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'edit') {
    try {
      return await handleEdit(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'iterate') {
    try {
      return await handleIterate(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'story') {
    try {
      return await handleStory(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'director') {
    try {
      return await handleDirector(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'video-edit') {
    try {
      return await handleVideoEdit(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'browser') {
    try {
      return await handleBrowser(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  if (command === 'run') {
    try {
      return await handleRun(subcommand, parsed, human);
    } catch (error) {
      return emitHandledError(error, human);
    }
  }

  const known = COMMANDS.find((item) => item.name === command);
  emit(envelope({
    ok: false,
    code: known ? 'CAPABILITY_UNAVAILABLE' : 'USAGE_ERROR',
    message: known
      ? `${command} 能力尚未在当前 CLI 版本中实现，未执行任何操作。`
      : `未知命令：${command}`,
    data: known ? { command, plannedRound: known.plannedRound } : {},
    nextActions: ['运行 zcanvas capabilities 查看当前真正可用的能力。'],
  }), human);
  return known ? EXIT_CODES.CAPABILITY_UNAVAILABLE : EXIT_CODES.USAGE_ERROR;
}

module.exports = {
  COMMANDS,
  capabilityRuntime,
  helpData,
  operationCapabilities,
  compileIncrementalDirection,
  creatorRecoveryForError,
  creatorContinuationReferenceNodeIds,
  creatorReferenceNodeIds,
  doctorRequestForAction,
  inferCreatorKind,
  inferCreatorRecipe,
  hasAppliedCreatorProduction,
  localMediaCreativeRequest,
  matchingCreativeApproval,
  readCreativePrompt,
  readCreativeReviewFile,
  readGraphNodeDataFile,
  readSimulationProposalFile,
  readStoryPlanFile,
  selectUnambiguousCreatorWorkspace,
  persistAuthoritativeCreatorSession,
  readAuthoritativeCreatorSession,
  syncCreatorLifecycle,
  runWatchCursor,
  runWatchEnvelope,
  watchRunIntent,
  runCli,
};
