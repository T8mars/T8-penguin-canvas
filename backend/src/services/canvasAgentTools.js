const {
  AGENT_RUN_ATTEMPT_LIMIT,
  AGENT_RUN_NODE_LIMIT,
  AGENT_SEARCH_LIMIT,
  boundAgentToolResult,
  digestAgentResult,
  publicAssetSearchItem,
  publicCanvasInspection,
  publicRunInspection,
  publicSubflowSearchItem,
  safePublicId,
  safeText: safeAgentText,
} = require('./canvasAgentPublicView');
const { sealServerAuthoritativeRunValidation } = require('./runEvidenceDiagnosis');
const { applyCanvasOperationForSimulation } = require('../collaboration/protocol');
const nodeSchemaManifest = require('../shared/canvasNodeSchema.json');

const CANVAS_AGENT_REMOTE_TOOLS = Object.freeze([
  'inspectCanvas',
  'inspectNodeSchema',
  'inspectRun',
  'searchAssets',
  'searchSubflows',
  'validateCanvas',
  'simulateExecutionPlan',
  'estimateRun',
]);
const CANVAS_AGENT_REMOTE_TOOL_SET = new Set(CANVAS_AGENT_REMOTE_TOOLS);
const AGENT_REQUEST_KEYS = new Set(['tool', 'requestId', 'projectId', 'canvasId', 'input']);
const AGENT_INPUT_KEYS = Object.freeze({
  inspectCanvas: new Set(['nodeOffset', 'edgeOffset', 'nodeLimit', 'edgeLimit']),
  inspectNodeSchema: new Set(['type', 'nodeId', 'offset', 'limit', 'includeHidden']),
  inspectRun: new Set(['runId', 'nodeRunId', 'attemptId']),
  searchAssets: new Set(['query', 'kind', 'limit', 'offset']),
  searchSubflows: new Set(['query', 'limit', 'offset']),
  validateCanvas: new Set([]),
  simulateExecutionPlan: new Set(['proposal']),
  estimateRun: new Set(['proposal']),
});
const NODE_SCHEMA_BY_TYPE = new Map(nodeSchemaManifest.types.map((item) => [item.type, item]));
// Persisted canvas-only structure and development-authoring nodes are
// deliberately excluded from the public/generatable production schemas, but
// still need an exact contract when an existing development canvas is
// inspected or validated. They remain non-generatable below.
const INTERNAL_NODE_SCHEMA_BY_TYPE = new Map([
  ['groupBox', {
    type: 'groupBox',
    label: '节点分组',
    category: 'internal',
    description: '画布内部节点分组容器',
    hidden: true,
    executable: false,
    generatable: false,
    ports: { inputs: [], outputs: ['any'] },
  }],
  ['rh-toolbox-maker', {
    type: 'rh-toolbox-maker',
    label: 'RH工具箱制作器',
    category: 'internal',
    description: '维护者开发态 RH 工具箱 manifest 制作节点',
    hidden: true,
    executable: false,
    generatable: false,
    ports: { inputs: [], outputs: ['text'] },
  }],
  ['fal-toolbox-maker', {
    type: 'fal-toolbox-maker',
    label: 'FAL应用制作工具',
    category: 'internal',
    description: '维护者开发态 FAL manifest 制作节点',
    hidden: true,
    executable: false,
    generatable: false,
    ports: { inputs: [], outputs: ['text'] },
  }],
]);
const INTERNAL_CONNECTION_PORTS = Object.freeze({
  groupBox: Object.freeze({
    resolver: 'static',
    inputs: Object.freeze([]),
    outputs: Object.freeze([Object.freeze({
      id: 'group-out',
      kinds: Object.freeze(['any']),
      required: false,
      minConnections: 0,
      maxConnections: null,
    })]),
  }),
  'rh-toolbox-maker': Object.freeze({
    resolver: 'static',
    inputs: Object.freeze([]),
    outputs: Object.freeze([Object.freeze({
      id: null,
      kinds: Object.freeze(['text']),
      required: false,
      minConnections: 0,
      maxConnections: null,
    })]),
  }),
  'fal-toolbox-maker': Object.freeze({
    resolver: 'static',
    inputs: Object.freeze([]),
    outputs: Object.freeze([Object.freeze({
      id: null,
      kinds: Object.freeze(['text']),
      required: false,
      minConnections: 0,
      maxConnections: null,
    })]),
  }),
});
const NODE_SCHEMA_DIGEST = digestAgentResult(nodeSchemaManifest);
const ASSET_KINDS = new Set(['image', 'video', 'audio', 'model3d', 'text', 'other']);
const AGENT_RUN_VALIDATION_SUBFLOW_LIMIT = 100;
const AGENT_SUBFLOW_DEPENDENCY_MAX_DEPTH = 8;
const AGENT_SUBFLOW_DEFINITION_NODE_LIMIT = 2_000;
const AGENT_RUN_VALIDATION_SUBFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const PORT_KINDS = new Set(['text', 'image', 'video', 'audio', 'model3d', 'metadata', 'config', 'any']);
const MATERIAL_PORT_KINDS = new Set(['text', 'image', 'video', 'audio']);
const CONNECTION_PORT_RESOLVERS = new Set([
  'video',
  'static',
  'upload',
  'material-set',
  'loop',
  'pick-from-set',
  'random-route',
  'subflow',
  'toolbox-param',
]);

function structuralNodeSchema(type) {
  return NODE_SCHEMA_BY_TYPE.get(type) || INTERNAL_NODE_SCHEMA_BY_TYPE.get(type) || null;
}

class CanvasAgentToolError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CanvasAgentToolError';
    this.code = code;
    this.status = status;
  }
}

function notFound() {
  return new CanvasAgentToolError('agent_scope_not_found', 'Agent 工具目标不存在或不属于当前项目', 404);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanvasAgentToolError('agent_request_invalid', `${label} 必须是对象`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new CanvasAgentToolError('agent_request_invalid', `${label} 包含未定义字段`);
    }
  }
}

function identity(value, label) {
  if (typeof value !== 'string') throw new CanvasAgentToolError('agent_request_invalid', `${label} 无效`);
  const normalized = value.normalize('NFKC').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new CanvasAgentToolError('agent_request_invalid', `${label} 无效`);
  }
  return normalized;
}

function boundedText(value, label, maximum = 512) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new CanvasAgentToolError('agent_request_invalid', `${label} 无效`);
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (normalized.length > maximum) throw new CanvasAgentToolError('agent_request_invalid', `${label} 超过限制`);
  if (safeAgentText(normalized, label, maximum) !== normalized) {
    throw new CanvasAgentToolError('agent_request_invalid', `${label} 包含不可公开内容`);
  }
  return normalized;
}

function boundedInteger(value, fallback, maximum, label = '整数', minimum = 0) {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CanvasAgentToolError('agent_request_invalid', `${label} 无效`);
  }
  return value;
}

function boundedBoolean(value, fallback, label) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw new CanvasAgentToolError('agent_request_invalid', `${label} 无效`);
  return value;
}

function validateToolInput(tool, input) {
  if (tool === 'inspectCanvas') {
    boundedInteger(input.nodeOffset, 0, 100_000, 'nodeOffset');
    boundedInteger(input.edgeOffset, 0, 100_000, 'edgeOffset');
    boundedInteger(input.nodeLimit, 50, 100, 'nodeLimit', 1);
    boundedInteger(input.edgeLimit, 100, 200, 'edgeLimit', 1);
  } else if (tool === 'inspectNodeSchema') {
    const type = boundedText(input.type, 'type', 160);
    const nodeId = boundedText(input.nodeId, 'nodeId', 160);
    if (type && nodeId) throw new CanvasAgentToolError('agent_request_invalid', 'type 与 nodeId 不能同时提供');
    boundedInteger(input.offset, 0, 100_000, 'offset');
    boundedInteger(input.limit, 20, 100, 'limit', 1);
    boundedBoolean(input.includeHidden, false, 'includeHidden');
  } else if (tool === 'inspectRun') {
    if (Object.prototype.hasOwnProperty.call(input, 'runId')) identity(input.runId, 'runId');
    if (Object.prototype.hasOwnProperty.call(input, 'nodeRunId')) identity(input.nodeRunId, 'nodeRunId');
    if (Object.prototype.hasOwnProperty.call(input, 'attemptId')) identity(input.attemptId, 'attemptId');
  } else if (tool === 'searchAssets') {
    boundedText(input.query, 'query', 512);
    boundedText(input.kind, 'kind', 80);
    boundedInteger(input.limit, 10, AGENT_SEARCH_LIMIT, 'limit', 1);
    boundedInteger(input.offset, 0, 100_000, 'offset');
  } else if (tool === 'searchSubflows') {
    boundedText(input.query, 'query', 512);
    boundedInteger(input.limit, 10, AGENT_SEARCH_LIMIT, 'limit', 1);
    boundedInteger(input.offset, 0, 100_000, 'offset');
  }
}

function proposalConnectionPorts(rawPorts, label, options = {}) {
  if (!Array.isArray(rawPorts)) {
    throw new CanvasAgentToolError('agent_node_schema_invalid', `${label} 缺少精确端口 Schema`, 500);
  }
  const seenIds = new Set();
  return rawPorts.map((rawPort) => {
    const port = record(rawPort, label);
    const id = port.id == null ? null : identity(port.id, `${label} id`);
    if (id != null && id !== port.id) {
      throw new CanvasAgentToolError('agent_node_schema_invalid', `${label} 端口 ID 不是规范形式`, 500);
    }
    if (options.requireId === true && id == null) {
      throw new CanvasAgentToolError('agent_node_schema_invalid', `${label} 缺少端口 ID`, 500);
    }
    const idKey = id == null ? '<null>' : id;
    if (seenIds.has(idKey)) {
      throw new CanvasAgentToolError('agent_node_schema_invalid', `${label} 端口 ID 重复`, 500);
    }
    seenIds.add(idKey);
    const rawKinds = Array.isArray(port.kinds) ? port.kinds : [port.kind];
    if ((!rawKinds.length && options.allowEmptyKinds !== true)
      || rawKinds.some((kind) => !PORT_KINDS.has(String(kind)))) {
      throw new CanvasAgentToolError('agent_node_schema_invalid', `${label} 类型无效`, 500);
    }
    const kinds = rawKinds.map(String);
    if (new Set(kinds).size !== kinds.length) {
      throw new CanvasAgentToolError('agent_node_schema_invalid', `${label} 类型重复`, 500);
    }
    if (port.required != null && typeof port.required !== 'boolean') {
      throw new CanvasAgentToolError('agent_node_schema_invalid', `${label} required 无效`, 500);
    }
    const required = port.required === true;
    const minConnections = boundedInteger(
      port.minConnections,
      required ? 1 : 0,
      1000,
      `${label} minConnections`,
    );
    const maxConnections = port.maxConnections == null
      ? null
      : boundedInteger(port.maxConnections, null, 1000, `${label} maxConnections`);
    if (maxConnections != null && maxConnections < minConnections) {
      throw new CanvasAgentToolError('agent_node_schema_invalid', `${label} 连接容量无效`, 500);
    }
    return {
      id,
      kinds,
      required,
      minConnections,
      maxConnections,
      hasDefault: Object.prototype.hasOwnProperty.call(port, 'defaultValue') && port.defaultValue !== undefined,
    };
  });
}

function proposalDocument(database, document, rawProposal) {
  if (rawProposal == null) return document;
  const proposal = record(rawProposal, 'execution proposal');
  onlyKeys(proposal, new Set(['schema', 'baseRevision', 'operations']), 'execution proposal');
  if (proposal.schema !== 't8-canvas-agent-execution-proposal-v1') {
    throw new CanvasAgentToolError('agent_request_invalid', 'execution proposal schema 无效');
  }
  const baseRevision = boundedInteger(
    proposal.baseRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'execution proposal baseRevision',
    1,
  );
  if (baseRevision !== Number(document.revision)) {
    throw new CanvasAgentToolError('agent_snapshot_changed', 'execution proposal 已过期，请重试', 409);
  }
  if (!Array.isArray(proposal.operations) || proposal.operations.length < 1 || proposal.operations.length > 100) {
    throw new CanvasAgentToolError('agent_request_invalid', 'execution proposal operations 无效');
  }
  let working = document;
  try {
    proposal.operations.forEach((rawOperation, index) => {
      const operation = record(rawOperation, `execution proposal operation[${index}]`);
      const type = String(operation.type || '');
      let payload;
      if (type === 'node.add') {
        onlyKeys(operation, new Set(['type', 'node']), `execution proposal operation[${index}]`);
        const node = record(operation.node, 'execution proposal node');
        onlyKeys(node, new Set(['id', 'type', 'position', 'subflowRef']), 'execution proposal node');
        const id = identity(node.id, 'proposal node id');
        const nodeType = identity(node.type, 'proposal node type');
        const schema = NODE_SCHEMA_BY_TYPE.get(nodeType);
        if (!schema || schema.hidden === true || schema.generatable !== true) {
          throw new CanvasAgentToolError('agent_node_type_forbidden', 'execution proposal 节点类型不可生成', 403);
        }
        const position = record(node.position, 'execution proposal position');
        onlyKeys(position, new Set(['x', 'y']), 'execution proposal position');
        if (typeof position.x !== 'number' || typeof position.y !== 'number'
          || !Number.isFinite(position.x) || !Number.isFinite(position.y)
          || Math.abs(position.x) > 1_000_000 || Math.abs(position.y) > 1_000_000) {
          throw new CanvasAgentToolError('agent_request_invalid', 'execution proposal position 无效');
        }
        let data = {};
        if (nodeType === 'subflow') {
          const reference = record(node.subflowRef, 'execution proposal subflowRef');
          onlyKeys(reference, new Set(['definitionId', 'version', 'revision']), 'execution proposal subflowRef');
          const definitionId = identity(reference.definitionId, 'definitionId');
          const version = boundedInteger(reference.version, 0, Number.MAX_SAFE_INTEGER, 'definitionVersion', 1);
          const revision = boundedInteger(reference.revision, version, Number.MAX_SAFE_INTEGER, 'definitionRevision', 1);
          const definition = typeof database.getSubflowDefinition === 'function'
            ? database.getSubflowDefinition(definitionId, version, document.projectId)
            : null;
          if (!definition || definition.id !== definitionId || Number(definition.version) !== version
            || Number(definition.revision || definition.version) !== revision) throw notFound();
          data = { definitionId, definitionVersion: version };
        } else if (node.subflowRef != null) {
          throw new CanvasAgentToolError('agent_request_invalid', '非子工作流节点不能包含 subflowRef');
        }
        payload = { node: { id, type: nodeType, position: { x: position.x, y: position.y }, data } };
      } else if (type === 'edge.add') {
        onlyKeys(operation, new Set(['type', 'edge']), `execution proposal operation[${index}]`);
        const edge = record(operation.edge, 'execution proposal edge');
        onlyKeys(edge, new Set(['id', 'source', 'target', 'sourceHandle', 'targetHandle']), 'execution proposal edge');
        payload = {
          edge: {
            id: identity(edge.id, 'proposal edge id'),
            source: identity(edge.source, 'proposal edge source'),
            target: identity(edge.target, 'proposal edge target'),
            ...(edge.sourceHandle == null ? {} : { sourceHandle: identity(edge.sourceHandle, 'proposal sourceHandle') }),
            ...(edge.targetHandle == null ? {} : { targetHandle: identity(edge.targetHandle, 'proposal targetHandle') }),
          },
        };
      } else if (type === 'node.delete') {
        onlyKeys(operation, new Set(['type', 'nodeId']), `execution proposal operation[${index}]`);
        payload = { nodeId: identity(operation.nodeId, 'proposal nodeId') };
      } else if (type === 'edge.delete') {
        onlyKeys(operation, new Set(['type', 'edgeId']), `execution proposal operation[${index}]`);
        payload = { edgeId: identity(operation.edgeId, 'proposal edgeId') };
      } else if (type === 'node.patch') {
        onlyKeys(operation, new Set(['type', 'nodeId', 'position']), `execution proposal operation[${index}]`);
        const position = record(operation.position, 'execution proposal position');
        onlyKeys(position, new Set(['x', 'y']), 'execution proposal position');
        if (typeof position.x !== 'number' || typeof position.y !== 'number'
          || !Number.isFinite(position.x) || !Number.isFinite(position.y)
          || Math.abs(position.x) > 1_000_000 || Math.abs(position.y) > 1_000_000) {
          throw new CanvasAgentToolError('agent_request_invalid', 'execution proposal position 无效');
        }
        payload = {
          nodeId: identity(operation.nodeId, 'proposal nodeId'),
          patch: { position: { x: position.x, y: position.y } },
        };
      } else {
        throw new CanvasAgentToolError('agent_request_invalid', 'execution proposal operation 类型无效');
      }
      working = applyCanvasOperationForSimulation(working, {
        opId: `agent-simulation-${index + 1}`,
        projectId: document.projectId,
        canvasId: document.canvasId,
        actorId: 'canvas-agent-simulator',
        sessionId: 'canvas-agent-simulator',
        baseRevision,
        clientSeq: index,
        timestamp: index + 1,
        type,
        payload,
      }).document;
    });
  } catch (error) {
    if (error instanceof CanvasAgentToolError) throw error;
    throw new CanvasAgentToolError('agent_execution_plan_invalid', 'execution proposal 无法安全应用到当前画布', 422);
  }
  return {
    ...working,
    agentInspectionBasis: 'post-patch-canvas',
    agentProposalDigest: digestAgentResult(proposal),
    agentBaseRevision: baseRevision,
  };
}

function assetSubject(context) {
  return {
    memberId: String(context.actorId || 'local-owner'),
    role: String(context.role || 'owner'),
    permission: 'view',
  };
}

function agentAuthority(context) {
  const role = String(context.role || 'owner');
  const capabilities = new Set(Array.isArray(context.capabilities) ? context.capabilities.map(String) : []);
  const canApplyCanvasPatch = (role === 'owner' || role === 'editor') && capabilities.has('editGraph');
  return {
    advisoryOnly: !canApplyCanvasPatch,
    canPreviewCanvasPatch: true,
    canApplyCanvasPatch,
    canManageHostCredentials: false,
    credentialVisibility: 'configured-state-only',
  };
}

function safeStaticSchemaPort(port) {
  const kinds = Array.isArray(port?.kinds) ? port.kinds : [];
  if (kinds.some((kind) => !PORT_KINDS.has(String(kind)))) {
    throw new CanvasAgentToolError('agent_node_schema_invalid', '节点精确端口类型无效', 500);
  }
  return {
    id: port.id == null ? null : safePublicId(port.id, 'port.id'),
    name: null,
    kinds: kinds.map(String),
    required: port.required === true,
    minConnections: boundedInteger(port.minConnections, 0, 1000, 'port.minConnections'),
    maxConnections: port.maxConnections == null ? null : boundedInteger(port.maxConnections, 0, 1000, 'port.maxConnections'),
    preferred: port.preferred === true,
    hasDefault: port.hasDefault === true,
  };
}

function inspectNodeSchema(database, document, input) {
  const requestedType = boundedText(input.type, 'type', 160);
  const requestedNodeId = boundedText(input.nodeId, 'nodeId', 160);
  let dynamicNode = null;
  let type = requestedType;
  if (requestedNodeId) {
    const matches = (document.nodes || []).filter((node) => String(node?.id || '') === requestedNodeId);
    if (matches.length !== 1) throw notFound();
    dynamicNode = matches[0];
    type = String(dynamicNode.type || '');
  }
  if (type) {
    const item = dynamicNode ? structuralNodeSchema(type) : NODE_SCHEMA_BY_TYPE.get(type);
    if (!item) throw new CanvasAgentToolError('agent_node_type_unknown', '节点类型不在权威 Schema 中', 404);
    const descriptor = connectionPortDescriptor(type);
    const ports = dynamicNode
      ? exactConnectionPortsForNode(dynamicNode, {
        resolveSubflow: (definitionId, version) => typeof database.getSubflowDefinition === 'function'
          ? database.getSubflowDefinition(definitionId, version, document.projectId)
          : null,
      })
      : descriptorConnectionPorts(type, descriptor);
    if (!ports) {
      throw new CanvasAgentToolError('agent_node_schema_unresolved', '节点实例的权威端口契约无法解析', 422);
    }
    return {
      schema: nodeSchemaManifest.schema,
      version: nodeSchemaManifest.version,
      digest: NODE_SCHEMA_DIGEST,
      item: {
        type: item.type,
        label: item.label,
        category: item.category,
        description: item.description,
        hidden: item.hidden === true,
        executable: item.executable === true,
        generatable: item.generatable === true,
        ports: {
          inputs: ports.inputs.slice(0, 100).map(safeStaticSchemaPort),
          outputs: ports.outputs.slice(0, 100).map(safeStaticSchemaPort),
          dynamic: descriptor.resolver !== 'static',
        },
        generation: item.generatable === true ? item.generation : { allowedDataFields: {}, defaults: {} },
      },
    };
  }
  const includeHidden = boundedBoolean(input.includeHidden, false, 'includeHidden');
  const offset = boundedInteger(input.offset, 0, 100_000, 'offset');
  const limit = boundedInteger(input.limit, 20, 100, 'limit', 1);
  const available = nodeSchemaManifest.types.filter((item) => includeHidden || item.hidden !== true);
  return {
    schema: nodeSchemaManifest.schema,
    version: nodeSchemaManifest.version,
    digest: NODE_SCHEMA_DIGEST,
    items: available.slice(offset, offset + limit).map((item) => ({
      type: item.type,
      label: item.label,
      category: item.category,
      hidden: item.hidden === true,
      executable: item.executable === true,
      generatable: item.generatable === true,
      inputKinds: item.ports.inputs,
      outputKinds: item.ports.outputs,
    })),
    page: { offset, limit, total: available.length, hasMore: offset + limit < available.length },
  };
}

function safePublicDiagnosticFacts(rawFacts) {
  if (rawFacts == null) return undefined;
  if (!rawFacts || typeof rawFacts !== 'object' || Array.isArray(rawFacts)) {
    throw new CanvasAgentToolError('agent_validation_invalid', '诊断 facts 无效', 500);
  }
  const facts = {};
  const entries = Object.entries(rawFacts);
  if (entries.length > 20) throw new CanvasAgentToolError('agent_validation_invalid', '诊断 facts 超过限制', 500);
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(key)) {
      throw new CanvasAgentToolError('agent_validation_invalid', '诊断 facts 字段无效', 500);
    }
    if (typeof value === 'string') facts[key] = safeAgentText(value, `diagnostic.facts.${key}`, 240);
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new CanvasAgentToolError('agent_validation_invalid', '诊断 facts 数值无效', 500);
      facts[key] = value;
    } else if (typeof value === 'boolean' || value == null) facts[key] = value;
    else if (Array.isArray(value) && value.length <= 20) {
      facts[key] = value.map((item, index) => {
        if (typeof item === 'string') return safeAgentText(item, `diagnostic.facts.${key}[${index}]`, 240);
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        throw new CanvasAgentToolError('agent_validation_invalid', '诊断 facts 数组无效', 500);
      });
    } else {
      throw new CanvasAgentToolError('agent_validation_invalid', '诊断 facts 值无效', 500);
    }
  }
  return facts;
}

function publicDiagnostic(ruleId, severity, targetType, targetId, detail, rawFacts) {
  const diagnostic = {
    ruleId,
    severity,
    targetType,
    targetId: safePublicId(targetId, 'diagnostic.targetId'),
    detail: safeAgentText(detail, 'diagnostic.detail', 500),
  };
  const facts = safePublicDiagnosticFacts(rawFacts);
  if (facts) diagnostic.facts = facts;
  return diagnostic;
}

function subflowDependencyRefKey(id, version) {
  return `${id}\u0000${version}`;
}

function subflowDependencyRefLabel(id, version) {
  return `${id}@${version}`;
}

function parseAuthoritativeSubflowDependencyRef(node, projectId) {
  const data = node?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, detail: '子工作流依赖缺少固定定义或版本' };
  }
  const id = data.definitionId;
  const version = Number(data.definitionVersion);
  const referenceProjectId = data.definitionProjectId == null || data.definitionProjectId === ''
    ? projectId
    : String(data.definitionProjectId);
  if (typeof id !== 'string'
    || !AGENT_RUN_VALIDATION_SUBFLOW_ID_PATTERN.test(id)
    || !Number.isSafeInteger(version)
    || version < 1) {
    return { valid: false, detail: '子工作流依赖缺少有效的固定 definitionId/version' };
  }
  if (referenceProjectId !== projectId) {
    return { valid: false, detail: '子工作流依赖跨项目固定引用被拒绝' };
  }
  return {
    valid: true,
    ref: {
      id,
      version,
      key: subflowDependencyRefKey(id, version),
      label: subflowDependencyRefLabel(id, version),
    },
  };
}

function loadSubflowDefinitionBatch(database, refs, projectId) {
  if (typeof database.getSubflowDefinitionsByRefs === 'function') {
    return database.getSubflowDefinitionsByRefs(refs.map(({ id, version }) => ({ id, version })), projectId);
  }
  if (typeof database.getSubflowDefinition === 'function') {
    return refs
      .map(({ id, version }) => database.getSubflowDefinition(id, version, projectId))
      .filter(Boolean);
  }
  return null;
}

function findSubflowDependencyCycle(adjacency, preferredStarts) {
  const state = new Map();
  const path = [];
  const pathIndex = new Map();
  const starts = [...new Set([
    ...preferredStarts,
    ...[...adjacency.keys()].sort(),
  ])];
  for (const start of starts) {
    if (state.get(start) === 2 || !adjacency.has(start)) continue;
    const frames = [{ key: start, next: 0 }];
    state.set(start, 1);
    pathIndex.set(start, path.length);
    path.push(start);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const targets = adjacency.get(frame.key) || [];
      if (frame.next >= targets.length) {
        frames.pop();
        state.set(frame.key, 2);
        pathIndex.delete(frame.key);
        path.pop();
        continue;
      }
      const target = targets[frame.next];
      frame.next += 1;
      if (state.get(target) === 1) {
        const index = pathIndex.get(target);
        return [...path.slice(index == null ? 0 : index), target];
      }
      if (state.get(target) === 2 || !adjacency.has(target)) continue;
      state.set(target, 1);
      pathIndex.set(target, path.length);
      path.push(target);
      frames.push({ key: target, next: 0 });
    }
  }
  return null;
}

function dependencyRootRefsReachingCycle(rootRefs, adjacency, cycle) {
  const cycleKeys = new Set(cycle);
  const reaching = [];
  for (const rootKey of [...rootRefs.keys()].sort()) {
    const queue = [rootKey];
    const visited = new Set();
    let reaches = false;
    while (queue.length > 0 && !reaches) {
      const key = queue.shift();
      if (visited.has(key)) continue;
      visited.add(key);
      if (cycleKeys.has(key)) {
        reaches = true;
        break;
      }
      for (const child of adjacency.get(key) || []) queue.push(child);
    }
    if (reaches) reaching.push(rootRefs.get(rootKey).label);
  }
  return reaching;
}

function loadAuthoritativeSubflowDependencyGraph(database, document, options = {}) {
  const projectId = String(document?.projectId || '');
  const maxDepth = Number.isSafeInteger(options.maxDepth)
    ? Math.max(1, Math.min(AGENT_SUBFLOW_DEPENDENCY_MAX_DEPTH, Number(options.maxDepth)))
    : AGENT_SUBFLOW_DEPENDENCY_MAX_DEPTH;
  const maxDefinitions = Number.isSafeInteger(options.maxDefinitions)
    ? Math.max(1, Math.min(AGENT_RUN_VALIDATION_SUBFLOW_LIMIT, Number(options.maxDefinitions)))
    : AGENT_RUN_VALIDATION_SUBFLOW_LIMIT;
  const diagnostics = [];
  const rootRefs = new Map();
  const rootNodeIds = [];
  for (const node of Array.isArray(document?.nodes) ? document.nodes : []) {
    if (String(node?.type || '') !== 'subflow') continue;
    rootNodeIds.push(String(node?.id || document?.canvasId || 'canvas'));
    const parsed = parseAuthoritativeSubflowDependencyRef(node, projectId);
    if (!parsed.valid) continue;
    rootRefs.set(parsed.ref.key, parsed.ref);
  }
  const definitionsByRef = new Map();
  const missingRefs = new Set();
  const adjacency = new Map();
  if (rootRefs.size === 0) {
    return {
      complete: true,
      diagnostics,
      definitionsByRef,
      resolveSubflow: () => null,
    };
  }

  let complete = true;
  const scheduledDepth = new Map([...rootRefs.keys()].map((key) => [key, 1]));
  let frontier = [...rootRefs.values()].sort((left, right) => left.key.localeCompare(right.key));
  while (frontier.length > 0) {
    const batch = frontier.filter((ref) => !definitionsByRef.has(ref.key) && !missingRefs.has(ref.key));
    frontier = [];
    if (batch.length === 0) continue;
    if (definitionsByRef.size + missingRefs.size + batch.length > maxDefinitions) {
      complete = false;
      diagnostics.push(publicDiagnostic(
        'subflow.version-invalid',
        'error',
        'subflow',
        rootNodeIds[0] || document.canvasId,
        `子工作流依赖定义超过 ${maxDefinitions} 项，权威验证已失败关闭`,
        {
          variant: 'subflow-dependency-limit',
          rootRefs: [...rootRefs.values()].map((ref) => ref.label).sort(),
          maximum: maxDefinitions,
        },
      ));
      break;
    }
    let loaded;
    try {
      loaded = loadSubflowDefinitionBatch(database, batch, projectId);
    } catch {
      loaded = null;
    }
    if (!Array.isArray(loaded) || loaded.length > batch.length) {
      complete = false;
      diagnostics.push(publicDiagnostic(
        'subflow.version-invalid',
        'error',
        'subflow',
        rootNodeIds[0] || document.canvasId,
        '子工作流依赖仓储暂不可用，权威验证已失败关闭',
        {
          variant: 'subflow-dependency-unavailable',
          rootRefs: [...rootRefs.values()].map((ref) => ref.label).sort(),
        },
      ));
      break;
    }
    const requested = new Map(batch.map((ref) => [ref.key, ref]));
    const returned = new Map();
    let malformed = false;
    for (const definition of loaded) {
      const id = definition?.id;
      const version = Number(definition?.version);
      const key = subflowDependencyRefKey(id, version);
      if (typeof id !== 'string'
        || !AGENT_RUN_VALIDATION_SUBFLOW_ID_PATTERN.test(id)
        || !Number.isSafeInteger(version)
        || version < 1
        || String(definition?.projectId || '') !== projectId
        || !requested.has(key)
        || returned.has(key)
        || !Array.isArray(definition?.nodes)
        || definition.nodes.length > AGENT_SUBFLOW_DEFINITION_NODE_LIMIT) {
        malformed = true;
        break;
      }
      returned.set(key, definition);
    }
    if (malformed) {
      complete = false;
      diagnostics.push(publicDiagnostic(
        'subflow.version-invalid',
        'error',
        'subflow',
        rootNodeIds[0] || document.canvasId,
        '子工作流依赖定义不满足权威固定版本契约',
        {
          variant: 'subflow-dependency-pin-mismatch',
          rootRefs: [...rootRefs.values()].map((ref) => ref.label).sort(),
        },
      ));
      break;
    }
    for (const ref of batch) {
      const definition = returned.get(ref.key);
      if (!definition) {
        missingRefs.add(ref.key);
        const depth = scheduledDepth.get(ref.key) || 1;
        if (depth > 1) {
          diagnostics.push(publicDiagnostic(
            'subflow.version-invalid',
            'error',
            'subflow',
            rootNodeIds[0] || document.canvasId,
            `嵌套子工作流固定版本 ${ref.label} 不存在或不属于当前项目`,
            {
              variant: 'subflow-dependency-unavailable',
              dependencyRef: ref.label,
              rootRefs: [...rootRefs.values()].map((root) => root.label).sort(),
            },
          ));
        }
        continue;
      }
      definitionsByRef.set(ref.key, definition);
      const children = [];
      const depth = scheduledDepth.get(ref.key) || 1;
      for (const childNode of definition.nodes) {
        if (String(childNode?.type || '') !== 'subflow') continue;
        const parsed = parseAuthoritativeSubflowDependencyRef(childNode, projectId);
        if (!parsed.valid) {
          diagnostics.push(publicDiagnostic(
            'subflow.version-invalid',
            'error',
            'subflow',
            rootNodeIds[0] || document.canvasId,
            `${ref.label} 内的嵌套子工作流没有有效的固定版本`,
            {
              variant: 'subflow-dependency-pin-mismatch',
              definitionRef: ref.label,
              rootRefs: [...rootRefs.values()].map((root) => root.label).sort(),
            },
          ));
          continue;
        }
        children.push(parsed.ref.key);
        if (depth >= maxDepth && !definitionsByRef.has(parsed.ref.key)) {
          complete = false;
          diagnostics.push(publicDiagnostic(
            'subflow.version-invalid',
            'error',
            'subflow',
            rootNodeIds[0] || document.canvasId,
            `子工作流依赖展开超过 ${maxDepth} 层，权威验证已失败关闭`,
            {
              variant: 'subflow-dependency-depth-limit',
              definitionRef: parsed.ref.label,
              rootRefs: [...rootRefs.values()].map((root) => root.label).sort(),
              maximum: maxDepth,
            },
          ));
          continue;
        }
        const nextDepth = depth + 1;
        const knownDepth = scheduledDepth.get(parsed.ref.key);
        if (knownDepth == null || nextDepth < knownDepth) scheduledDepth.set(parsed.ref.key, nextDepth);
        if (!definitionsByRef.has(parsed.ref.key) && !missingRefs.has(parsed.ref.key)) frontier.push(parsed.ref);
      }
      adjacency.set(ref.key, [...new Set(children)].sort());
    }
    frontier = [...new Map(frontier.map((ref) => [ref.key, ref])).values()]
      .sort((left, right) => left.key.localeCompare(right.key));
    if (!complete) break;
  }

  if (complete) {
    const cycle = findSubflowDependencyCycle(adjacency, [...rootRefs.keys()]);
    if (cycle) {
      const labels = cycle.map((key) => {
        const definition = definitionsByRef.get(key);
        if (definition) return subflowDependencyRefLabel(definition.id, Number(definition.version));
        const separator = key.lastIndexOf('\u0000');
        return subflowDependencyRefLabel(key.slice(0, separator), Number(key.slice(separator + 1)));
      });
      diagnostics.push(publicDiagnostic(
        'topology.cycle',
        'error',
        'subflow',
        rootNodeIds[0] || document.canvasId,
        `固定版本子工作流依赖形成循环：${labels.join(' → ')}`,
        {
          variant: 'subflow-dependency',
          rootRefs: dependencyRootRefsReachingCycle(rootRefs, adjacency, cycle),
          cycleRefs: labels,
          definitionCount: definitionsByRef.size,
          maxDepth,
        },
      ));
    }
  }
  return {
    complete,
    diagnostics,
    definitionsByRef,
    resolveSubflow: (id, version) => definitionsByRef.get(subflowDependencyRefKey(String(id), Number(version))) || null,
  };
}

function connectionPortDescriptor(type) {
  const descriptor = nodeSchemaManifest.connectionPorts?.[type] || INTERNAL_CONNECTION_PORTS[type];
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
    || !CONNECTION_PORT_RESOLVERS.has(String(descriptor.resolver || ''))
    || !Array.isArray(descriptor.inputs) || !Array.isArray(descriptor.outputs)) {
    throw new CanvasAgentToolError('agent_node_schema_invalid', `${type} 缺少权威连接端口契约`, 500);
  }
  return descriptor;
}

function descriptorConnectionPorts(type, descriptor = connectionPortDescriptor(type)) {
  return {
    inputs: proposalConnectionPorts(descriptor.inputs, `${type} input port`),
    outputs: proposalConnectionPorts(descriptor.outputs, `${type} output port`),
  };
}

function narrowedDescriptorPort(rawPort, kinds) {
  return { ...rawPort, kinds: [...kinds] };
}

function materialSetHasUsableItem(data, kind) {
  if (!Array.isArray(data?.materialSetItems)) return false;
  return data.materialSetItems.some((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const hasExplicitKind = raw.kind !== undefined && raw.kind !== null && raw.kind !== '';
    if (hasExplicitKind && !MATERIAL_PORT_KINDS.has(String(raw.kind))) return false;
    const rawKind = hasExplicitKind ? String(raw.kind) : kind;
    if (rawKind !== kind) return false;
    const value = kind === 'text' ? raw.text ?? raw.url : raw.url;
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizedRandomRouteOutputCount(data) {
  const raw = firstPresent(data?.randomRouteTotalOutputs, data?.totalOutputs, data?.total_outputs);
  const number = raw == null ? 10 : (typeof raw === 'number' ? raw : Number(raw));
  const finite = Number.isFinite(number) ? number : 10;
  return Math.max(1, Math.min(100, Math.round(finite)));
}

function exactConnectionPortsForNode(node, options = {}) {
  const type = String(node?.type || '');
  if (!structuralNodeSchema(type)) return null;
  const descriptor = connectionPortDescriptor(type);
  const resolver = String(descriptor.resolver);
  const data = node?.data && typeof node.data === 'object' && !Array.isArray(node.data) ? node.data : {};
  if (resolver === 'static') return descriptorConnectionPorts(type, descriptor);
  if (resolver === 'video') {
    const model = String(data.klingV4Pending?.model || data.model || '');
    const auxiliary = require('../shared/klingV4Contract.json').auxiliaryModels.includes(model) && (!data.providerSource || data.providerSource === 'zhenzhen');
    const kinds = auxiliary ? model.endsWith('voice') ? ['text', 'audio', 'metadata'] : ['text', 'metadata'] : ['video'];
    return { inputs: proposalConnectionPorts(descriptor.inputs, `${type} input port`),
      outputs: proposalConnectionPorts(descriptor.outputs.map(port => narrowedDescriptorPort(port, kinds)), `${type} output port`) };
  }
  if (resolver === 'upload') {
    const kind = String(data.uploadType || '');
    const kinds = ['image', 'video', 'audio', 'model3d'].includes(kind) ? [kind] : [];
    return {
      inputs: proposalConnectionPorts(descriptor.inputs, `${type} input port`),
      outputs: proposalConnectionPorts(
        descriptor.outputs.map((port) => narrowedDescriptorPort(port, kinds)),
        `${type} output port`,
        { allowEmptyKinds: true },
      ),
    };
  }
  if (resolver === 'material-set') {
    const kind = MATERIAL_PORT_KINDS.has(String(data.materialSetKind || '')) ? String(data.materialSetKind) : '';
    const inputKinds = kind ? [kind] : [...MATERIAL_PORT_KINDS];
    const outputKinds = kind && materialSetHasUsableItem(data, kind) ? [kind] : [];
    return {
      inputs: proposalConnectionPorts(
        descriptor.inputs.map((port) => narrowedDescriptorPort(port, inputKinds)),
        `${type} input port`,
      ),
      outputs: proposalConnectionPorts(
        descriptor.outputs.map((port) => narrowedDescriptorPort(port, outputKinds)),
        `${type} output port`,
        { allowEmptyKinds: true },
      ),
    };
  }
  if (resolver === 'loop' || resolver === 'pick-from-set') {
    const rawKind = resolver === 'loop' ? data.kind : data.pickKind;
    const kind = MATERIAL_PORT_KINDS.has(String(rawKind || '')) ? String(rawKind) : 'image';
    return {
      inputs: proposalConnectionPorts(
        descriptor.inputs.map((port) => narrowedDescriptorPort(port, [kind])),
        `${type} input port`,
      ),
      outputs: proposalConnectionPorts(
        descriptor.outputs.map((port) => narrowedDescriptorPort(port, [kind])),
        `${type} output port`,
      ),
    };
  }
  if (resolver === 'random-route') {
    const totalOutputs = normalizedRandomRouteOutputCount(data);
    return {
      inputs: proposalConnectionPorts(descriptor.inputs, `${type} input port`),
      outputs: proposalConnectionPorts(Array.from({ length: totalOutputs }, (_, index) => ({
        id: `output_${index + 1}`,
        kinds: ['any'],
        required: false,
        minConnections: 0,
        maxConnections: null,
      })), `${type} output port`),
    };
  }
  if (resolver === 'subflow') {
    const definitionId = data.definitionId;
    const version = Number(data.definitionVersion || 0);
    if (typeof definitionId !== 'string' || !definitionId || !Number.isSafeInteger(version) || version < 1
      || typeof options.resolveSubflow !== 'function') return null;
    const definition = options.resolveSubflow(definitionId, version);
    if (!definition || definition.id !== definitionId || Number(definition.version) !== version) return null;
    try {
      const inputs = proposalConnectionPorts(definition.inputs, 'subflow input port', { requireId: true });
      const outputs = proposalConnectionPorts(definition.outputs, 'subflow output port', { requireId: true });
      const allIds = [...inputs, ...outputs].map((port) => port.id);
      if (new Set(allIds).size !== allIds.length) return null;
      return { inputs, outputs };
    } catch (error) {
      if (error instanceof CanvasAgentToolError) return null;
      throw error;
    }
  }
  if (resolver === 'toolbox-param') {
    const actualKind = typeof data.kind === 'string' && data.kind ? data.kind : 'cinematic';
    if (actualKind !== type) return null;
    return descriptorConnectionPorts(type, descriptor);
  }
  throw new CanvasAgentToolError('agent_node_schema_invalid', `${type} 连接端口 resolver 无效`, 500);
}

function connectionCountKey(nodeId, direction, portId) {
  return JSON.stringify([String(nodeId), direction, portId == null ? null : String(portId)]);
}

function structuralValidation(document, options = {}) {
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const edges = Array.isArray(document.edges) ? document.edges : [];
  const diagnostics = Array.isArray(options.subflowDependencyDiagnostics)
    ? [...options.subflowDependencyDiagnostics]
    : [];
  const nodeCounts = new Map();
  for (const node of nodes) nodeCounts.set(String(node?.id || ''), (nodeCounts.get(String(node?.id || '')) || 0) + 1);
  for (const [nodeId, count] of nodeCounts) {
    if (!nodeId || count > 1) diagnostics.push(publicDiagnostic('identity.duplicate-node-id', 'error', 'node', nodeId || 'missing', '节点 ID 缺失或重复'));
  }
  const knownIds = new Set([...nodeCounts.entries()].filter(([, count]) => count === 1).map(([id]) => id));
  const nodeById = new Map(nodes.filter((node) => knownIds.has(String(node?.id || ''))).map((node) => [String(node.id), node]));
  const exactPortsByNodeId = new Map();
  const unresolvedPortNodeIds = new Set();
  for (const node of nodes) {
    const type = String(node?.type || '');
    const nodeSchema = structuralNodeSchema(type);
    if (!nodeSchema) diagnostics.push(publicDiagnostic('registry.unknown-node-type', 'error', 'node', node?.id, '节点类型不在权威 Schema 中'));
    if (!Number.isFinite(node?.position?.x) || !Number.isFinite(node?.position?.y)) diagnostics.push(publicDiagnostic('layout.invalid-position', 'error', 'node', node?.id, '节点坐标不是有限数值'));
    if (type === 'subflow') {
      const definitionId = node?.data?.definitionId;
      const version = Number(node?.data?.definitionVersion || 0);
      if (!definitionId || !Number.isInteger(version) || version < 1) diagnostics.push(publicDiagnostic('subflow.definition-missing', 'error', 'node', node?.id, '子工作流缺少固定定义或版本'));
      else if (typeof options.resolveSubflow === 'function' && !options.resolveSubflow(String(definitionId), version)) {
        diagnostics.push(publicDiagnostic('subflow.version-invalid', 'error', 'node', node?.id, '子工作流固定版本不存在或不属于当前项目'));
      }
    }
    if (knownIds.has(String(node?.id || '')) && nodeSchema) {
      const ports = exactConnectionPortsForNode(node, options);
      if (ports) exactPortsByNodeId.set(String(node.id), ports);
      else {
        unresolvedPortNodeIds.add(String(node.id));
        diagnostics.push(publicDiagnostic('ports.contract-unresolved', 'error', 'node', node?.id, '节点实例的权威端口契约无法解析'));
      }
    }
  }
  const edgeSignatures = new Set();
  const adjacency = new Map([...knownIds].map((id) => [id, []]));
  const indegree = new Map([...knownIds].map((id) => [id, 0]));
  const attachedPortCounts = new Map();
  const validPortCounts = new Map();
  for (const edge of edges) {
    const edgeId = String(edge?.id || '');
    const source = String(edge?.source || '');
    const target = String(edge?.target || '');
    if (!knownIds.has(source) || !knownIds.has(target)) {
      diagnostics.push(publicDiagnostic('topology.dangling-edge', 'error', 'edge', edgeId, '连线端点不存在或不唯一'));
      continue;
    }
    if (source === target) diagnostics.push(publicDiagnostic('topology.self-edge', 'error', 'edge', edgeId, '节点不能连接到自身'));
    const signature = JSON.stringify([source, edge?.sourceHandle ?? null, target, edge?.targetHandle ?? null]);
    if (edgeSignatures.has(signature)) diagnostics.push(publicDiagnostic('topology.duplicate-edge', 'warning', 'edge', edgeId, '存在重复连线'));
    else edgeSignatures.add(signature);
    const sourceHandle = edge?.sourceHandle == null ? null : String(edge.sourceHandle);
    const targetHandle = edge?.targetHandle == null ? null : String(edge.targetHandle);
    const sourceContract = exactPortsByNodeId.get(source);
    const targetContract = exactPortsByNodeId.get(target);
    const sourcePort = sourceContract?.outputs.find((port) => port.id === sourceHandle) || null;
    const targetPort = targetContract?.inputs.find((port) => port.id === targetHandle) || null;
    let handlesValid = Boolean(sourceContract && targetContract)
      && !unresolvedPortNodeIds.has(source)
      && !unresolvedPortNodeIds.has(target);
    if (sourceContract && !sourcePort) {
      diagnostics.push(publicDiagnostic('ports.handle-unknown', 'error', 'edge', edgeId, '连线输出端口不存在于权威节点 Schema'));
      handlesValid = false;
    }
    if (targetContract && !targetPort) {
      diagnostics.push(publicDiagnostic('ports.handle-unknown', 'error', 'edge', edgeId, '连线输入端口不存在于权威节点 Schema'));
      handlesValid = false;
    }
    if (sourcePort) {
      const key = connectionCountKey(source, 'outputs', sourcePort.id);
      attachedPortCounts.set(key, (attachedPortCounts.get(key) || 0) + 1);
    }
    if (targetPort) {
      const key = connectionCountKey(target, 'inputs', targetPort.id);
      attachedPortCounts.set(key, (attachedPortCounts.get(key) || 0) + 1);
    }
    const sourceKinds = sourcePort?.kinds || [];
    const targetKinds = targetPort?.kinds || [];
    const compatible = sourceKinds.length > 0 && targetKinds.length > 0
      && (sourceKinds.includes('any') || targetKinds.includes('any')
        || sourceKinds.some((kind) => targetKinds.includes(kind)));
    if (handlesValid && !compatible) {
      diagnostics.push(publicDiagnostic('ports.type-incompatible', 'error', 'edge', edgeId, '连线端口类型不兼容'));
    } else if (handlesValid && compatible) {
      if (sourcePort) {
        const key = connectionCountKey(source, 'outputs', sourcePort.id);
        validPortCounts.set(key, (validPortCounts.get(key) || 0) + 1);
      }
      if (targetPort) {
        const key = connectionCountKey(target, 'inputs', targetPort.id);
        validPortCounts.set(key, (validPortCounts.get(key) || 0) + 1);
      }
    }
    if (source !== target) {
      adjacency.get(source).push(target);
      indegree.set(target, (indegree.get(target) || 0) + 1);
    }
  }
  for (const [nodeId, contracts] of exactPortsByNodeId) {
    for (const [direction, ports] of [['inputs', contracts.inputs], ['outputs', contracts.outputs]]) {
      for (const port of ports) {
        const key = connectionCountKey(nodeId, direction, port.id);
        const attached = attachedPortCounts.get(key) || 0;
        const valid = validPortCounts.get(key) || 0;
        if (port.maxConnections != null && attached > port.maxConnections) {
          diagnostics.push(publicDiagnostic('ports.capacity-exceeded', 'error', 'node', nodeId, '端口连接数超过权威 Schema 上限'));
        }
        if (direction === 'inputs') {
          const effective = valid > 0 ? valid : (port.hasDefault ? 1 : 0);
          if (effective < port.minConnections) {
            diagnostics.push(publicDiagnostic('ports.required-input-missing', 'error', 'node', nodeId, '必填输入端口没有足够的有效连接或默认值'));
          }
        }
      }
    }
  }
  const queue = [...knownIds].filter((id) => (indegree.get(id) || 0) === 0).sort();
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const target of adjacency.get(id) || []) {
      const next = (indegree.get(target) || 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        queue.push(target);
        queue.sort();
      }
    }
  }
  if (visited < knownIds.size) diagnostics.push(publicDiagnostic('topology.cycle', 'error', 'canvas', document.canvasId, '工作流包含循环依赖，模拟执行已阻止'));
  const errorCount = diagnostics.filter((item) => item.severity === 'error').length;
  const warningCount = diagnostics.filter((item) => item.severity === 'warning').length;
  const bounded = diagnostics.slice(0, 200);
  return {
    basis: document.agentInspectionBasis || 'current-canvas',
    ...(document.agentProposalDigest ? { proposalDigest: document.agentProposalDigest } : {}),
    ...(Number.isSafeInteger(document.agentBaseRevision) ? { baseRevision: document.agentBaseRevision } : {}),
    valid: errorCount === 0,
    diagnostics: bounded,
    totals: {
      nodes: nodes.length,
      edges: edges.length,
      errors: errorCount,
      warnings: warningCount,
    },
    truncated: diagnostics.length > bounded.length,
  };
}

function authoritativeRunValidationResolver(database, document) {
  return loadAuthoritativeSubflowDependencyGraph(database, document);
}

function serverAuthoritativeRunValidation(database, document, run) {
  if (!run
    || String(run.projectId || '') !== String(document.projectId || '')
    || String(run.canvasId || '') !== String(document.canvasId || '')
    || Number(run.canvasRevision) !== Number(document.revision)) return null;
  const resolver = authoritativeRunValidationResolver(database, document);
  if (!resolver.complete) return null;
  const validation = structuralValidation(document, {
    resolveSubflow: resolver.resolveSubflow,
    subflowDependencyDiagnostics: resolver.diagnostics,
  });
  const envelope = {
    schema: 't8-canvas-agent-tool-result-v1',
    tool: 'validateCanvas',
    requestId: 'server-inspect-run-validation',
    projectId: String(document.projectId),
    canvasId: String(document.canvasId),
    canvasRevision: Number(document.revision),
    actorId: 'server-authoritative-validator',
    role: 'server',
    authority: {
      advisoryOnly: true,
      canPreviewCanvasPatch: false,
      canApplyCanvasPatch: false,
      canManageHostCredentials: false,
      credentialVisibility: 'configured-state-only',
    },
    nodeSchemaDigest: NODE_SCHEMA_DIGEST,
    readOnly: true,
    truncated: validation.truncated === true,
    data: validation,
  };
  envelope.digest = digestAgentResult(envelope);
  const bounded = boundAgentToolResult(envelope);
  if (bounded.truncated === true || bounded.data?.omitted === true) return null;
  return sealServerAuthoritativeRunValidation(run, bounded);
}

function simulateExecution(document, options = {}) {
  const validation = structuralValidation(document, options);
  if (!validation.valid) return {
    basis: document.agentInspectionBasis || 'current-canvas',
    ...(document.agentProposalDigest ? { proposalDigest: document.agentProposalDigest } : {}),
    ...(Number.isSafeInteger(document.agentBaseRevision) ? { baseRevision: document.agentBaseRevision } : {}),
    valid: false,
    blocked: true,
    reasonCode: 'canvas_validation_failed',
    validation,
    batches: [],
    executableNodeCount: 0,
    uncertainty: [],
  };
  const nodes = document.nodes || [];
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
  const outgoing = new Map(nodes.map((node) => [String(node.id), []]));
  const indegree = new Map(nodes.map((node) => [String(node.id), 0]));
  for (const edge of document.edges || []) {
    if (!nodeById.has(String(edge.source)) || !nodeById.has(String(edge.target))) continue;
    outgoing.get(String(edge.source)).push(String(edge.target));
    indegree.set(String(edge.target), (indegree.get(String(edge.target)) || 0) + 1);
  }
  let ready = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const batches = [];
  while (ready.length) {
    const batch = ready;
    batches.push(batch.map((id) => ({
      nodeId: safePublicId(id, 'simulation.nodeId'),
      type: safePublicId(nodeById.get(id)?.type, 'simulation.nodeType'),
      executable: structuralNodeSchema(String(nodeById.get(id)?.type || ''))?.executable === true,
    })));
    const nextReady = [];
    for (const id of batch) {
      for (const target of outgoing.get(id) || []) {
        const next = (indegree.get(target) || 0) - 1;
        indegree.set(target, next);
        if (next === 0) nextReady.push(target);
      }
    }
    ready = [...new Set(nextReady)].sort();
  }
  const executableNodeCount = nodes.filter((node) => structuralNodeSchema(String(node.type || ''))?.executable === true).length;
  const uncertainty = nodes.flatMap((node) => ['loop', 'random-route'].includes(String(node.type))
    ? [{ nodeId: safePublicId(node.id, 'simulation.nodeId'), reasonCode: node.type === 'loop' ? 'loop_cardinality_runtime' : 'random_route_runtime' }]
    : []);
  return {
    basis: document.agentInspectionBasis || 'current-canvas',
    ...(document.agentProposalDigest ? { proposalDigest: document.agentProposalDigest } : {}),
    ...(Number.isSafeInteger(document.agentBaseRevision) ? { baseRevision: document.agentBaseRevision } : {}),
    valid: true,
    blocked: false,
    reasonCode: null,
    validation,
    batches,
    executableNodeCount,
    uncertainty,
  };
}

function estimateExecution(database, document) {
  const simulation = simulateExecution(document, {
    resolveSubflow: (definitionId, version) => typeof database.getSubflowDefinition === 'function'
      ? database.getSubflowDefinition(definitionId, version, document.projectId)
      : null,
  });
  const policy = typeof database.getExecutionPolicy === 'function' ? database.getExecutionPolicy(document.projectId) : null;
  const usage = typeof database.getExecutionUsage === 'function' ? database.getExecutionUsage(document.projectId) : null;
  const uncertain = simulation.uncertainty.length > 0;
  return {
    basis: document.agentInspectionBasis || 'current-canvas',
    ...(document.agentProposalDigest ? { proposalDigest: document.agentProposalDigest } : {}),
    ...(Number.isSafeInteger(document.agentBaseRevision) ? { baseRevision: document.agentBaseRevision } : {}),
    valid: simulation.valid,
    blocked: simulation.blocked,
    executableNodeCount: simulation.executableNodeCount,
    providerCalls: {
      known: false,
      minimum: 0,
      maximum: null,
      reasonCode: simulation.valid
        ? (uncertain ? 'runtime_branch_or_loop_and_provider_metadata_unavailable' : 'provider_call_metadata_unavailable')
        : 'canvas_validation_failed',
    },
    cost: {
      known: false,
      currency: null,
      minimum: null,
      maximum: null,
      reasonCode: 'pricing_registry_unavailable',
    },
    policy: policy ? {
      concurrencyLimit: policy.concurrencyLimit,
      activeCount: usage?.activeCount ?? null,
      perRunCostLimitConfigured: Number(policy.perRunCostLimit) > 0,
      dailyCostLimitConfigured: Number(policy.dailyCostLimit) > 0,
      modelAllowlistConfigured: !(policy.allowedModels || []).includes('*'),
      revision: policy.updatedAt ?? null,
    } : null,
  };
}

function inspectRun(database, document, input) {
  if (typeof database.getRunEvidence === 'function') {
    const evidence = database.getRunEvidence({
      projectId: document.projectId,
      canvasId: document.canvasId,
      ...(input.runId ? { runId: identity(input.runId, 'runId') } : {}),
      ...(input.nodeRunId ? { nodeRunId: identity(input.nodeRunId, 'nodeRunId') } : {}),
      ...(input.attemptId ? { attemptId: identity(input.attemptId, 'attemptId') } : {}),
      nodeLimit: AGENT_RUN_NODE_LIMIT,
      attemptLimit: AGENT_RUN_ATTEMPT_LIMIT,
    });
    if (!evidence) throw notFound();
    return publicRunInspection(evidence, undefined, undefined, {
      authoritativeValidationEvidence: serverAuthoritativeRunValidation(database, document, evidence.run),
    });
  }
  let run = null;
  if (input.runId) run = database.getRun(identity(input.runId, 'runId'));
  else run = database.listRuns({
    projectId: document.projectId,
    canvasId: document.canvasId,
    limit: 1,
  })[0] || null;
  if (!run || run.projectId !== document.projectId || run.canvasId !== document.canvasId) throw notFound();
  let nodeRuns = database.listNodeRuns(run.id);
  if (input.nodeRunId) nodeRuns = nodeRuns.filter((nodeRun) => String(nodeRun.id) === String(input.nodeRunId));
  const runAttempts = typeof database.listRunAttempts === 'function'
    ? database.listRunAttempts(run.id)
    : [];
  const attemptsByNodeId = new Map(nodeRuns.map((nodeRun) => [
    String(nodeRun.id),
    runAttempts.filter((attempt) => String(attempt.nodeRunId) === String(nodeRun.id)
      && (!input.attemptId || String(attempt.id) === String(input.attemptId))),
  ]));
  const selectedAttemptFound = !input.attemptId || [...attemptsByNodeId.values()].some((attempts) => attempts.length > 0);
  const selectedNodeFound = !input.nodeRunId || nodeRuns.length > 0;
  const evidence = {
    run,
    selection: {
      runId: run.id,
      nodeRunId: input.nodeRunId || null,
      attemptId: input.attemptId || null,
    },
    totals: {
      nodeRuns: nodeRuns.length,
      attempts: [...attemptsByNodeId.values()].reduce((sum, attempts) => sum + attempts.length, 0),
    },
    returned: {
      nodeRuns: nodeRuns.length,
      attempts: [...attemptsByNodeId.values()].reduce((sum, attempts) => sum + attempts.length, 0),
    },
    hasMore: { nodeRuns: false, attempts: false },
    evidenceComplete: selectedNodeFound && selectedAttemptFound,
    evidenceReasons: selectedNodeFound && selectedAttemptFound ? [] : ['selected_evidence_missing_or_retained'],
    nodeRuns,
    attemptsByNodeId,
  };
  return publicRunInspection(evidence, undefined, undefined, {
    authoritativeValidationEvidence: serverAuthoritativeRunValidation(database, document, run),
  });
}

function searchAssets(database, document, input, context) {
  const query = boundedText(input.query, 'query', 512);
  const kind = boundedText(input.kind, 'kind', 80);
  if (kind && !ASSET_KINDS.has(kind)) throw new CanvasAgentToolError('agent_request_invalid', 'kind 不在素材类型白名单中');
  const limit = boundedInteger(input.limit, 10, AGENT_SEARCH_LIMIT, 'limit', 1);
  const offset = boundedInteger(input.offset, 0, 100_000, 'offset');
  const filters = {
    projectId: document.projectId,
    query,
    ...(kind ? { kind } : {}),
    limit,
    offset,
  };
  const subject = assetSubject(context);
  const items = database.listAccessibleAssets(filters, subject).map(publicAssetSearchItem);
  const total = typeof database.countAccessibleAssets === 'function'
    ? database.countAccessibleAssets({ ...filters, limit: undefined, offset: undefined }, subject)
    : items.length;
  return {
    query: safeAgentText(query, 'query', 512),
    kind: kind ? safeAgentText(kind, 'kind', 80) : null,
    items,
    page: { offset, limit, total, hasMore: offset + items.length < total },
  };
}

function searchSubflows(database, document, input) {
  const query = boundedText(input.query, 'query', 512);
  const limit = boundedInteger(input.limit, 10, AGENT_SEARCH_LIMIT, 'limit', 1);
  const offset = boundedInteger(input.offset, 0, 100_000, 'offset');
  const all = database.listSubflowDefinitions({ projectId: document.projectId, query });
  const safe = all.map(publicSubflowSearchItem).filter(Boolean);
  return {
    query: safeAgentText(query, 'query', 512),
    items: safe.slice(offset, offset + limit),
    page: { offset, limit, total: safe.length, hasMore: offset + limit < safe.length },
  };
}

function executeCanvasAgentTool(database, rawRequest, context = {}) {
  if (!database || typeof database.getCanvas !== 'function') {
    throw new CanvasAgentToolError('agent_service_unavailable', 'Agent 只读仓储不可用', 503);
  }
  const request = record(rawRequest, 'Agent 工具请求');
  onlyKeys(request, AGENT_REQUEST_KEYS, 'Agent 工具请求');
  const tool = String(request.tool || '');
  if (!CANVAS_AGENT_REMOTE_TOOL_SET.has(tool)) {
    throw new CanvasAgentToolError('agent_tool_forbidden', 'Agent 工具不在只读白名单中', 403);
  }
  const input = request.input == null ? {} : record(request.input, 'Agent 工具 input');
  onlyKeys(input, AGENT_INPUT_KEYS[tool], 'Agent 工具 input');
  validateToolInput(tool, input);
  const requestId = identity(request.requestId, 'requestId');
  const requestedProjectId = identity(request.projectId, 'projectId');
  const requestedCanvasId = identity(request.canvasId, 'canvasId');
  if (context.projectId && requestedProjectId !== String(context.projectId)) throw notFound();
  if (context.canvasId && requestedCanvasId !== String(context.canvasId)) throw notFound();
  const projectId = context.projectId ? String(context.projectId) : requestedProjectId;
  const canvasId = context.canvasId ? String(context.canvasId) : requestedCanvasId;
  const document = database.getCanvas(canvasId);
  if (!document || document.projectId !== projectId) throw notFound();
  const beforeRevision = Number(document.revision);

  let data;
  if (tool === 'inspectCanvas') data = publicCanvasInspection(document, input);
  else if (tool === 'inspectNodeSchema') data = inspectNodeSchema(database, document, input);
  else if (tool === 'inspectRun') data = inspectRun(database, document, input);
  else if (tool === 'searchAssets') data = searchAssets(database, document, input, context);
  else if (tool === 'searchSubflows') data = searchSubflows(database, document, input);
  else if (tool === 'validateCanvas') {
    const dependencyGraph = loadAuthoritativeSubflowDependencyGraph(database, document);
    data = structuralValidation(document, {
      resolveSubflow: dependencyGraph.resolveSubflow,
      subflowDependencyDiagnostics: dependencyGraph.diagnostics,
    });
  }
  else if (tool === 'simulateExecutionPlan') {
    const executionDocument = proposalDocument(database, document, input.proposal);
    const dependencyGraph = loadAuthoritativeSubflowDependencyGraph(database, executionDocument);
    data = simulateExecution(executionDocument, {
      resolveSubflow: dependencyGraph.resolveSubflow,
      subflowDependencyDiagnostics: dependencyGraph.diagnostics,
    });
  }
  else data = estimateExecution(database, proposalDocument(database, document, input.proposal));

  const current = database.getCanvas(canvasId);
  if (!current || current.projectId !== projectId) throw notFound();
  if (Number(current.revision) !== beforeRevision) {
    throw new CanvasAgentToolError('agent_snapshot_changed', '画布在只读工具执行期间已变化，请重试', 409);
  }
  const result = {
    schema: 't8-canvas-agent-tool-result-v1',
    tool,
    requestId,
    projectId,
    canvasId,
    canvasRevision: beforeRevision,
    actorId: String(context.actorId || 'local-owner'),
    role: String(context.role || 'owner'),
    authority: agentAuthority(context),
    nodeSchemaDigest: NODE_SCHEMA_DIGEST,
    readOnly: true,
    truncated: Boolean(data?.truncated),
    data,
  };
  result.digest = digestAgentResult(result);
  return boundAgentToolResult(result);
}

module.exports = {
  CANVAS_AGENT_REMOTE_TOOLS,
  NODE_SCHEMA_DIGEST,
  CanvasAgentToolError,
  executeCanvasAgentTool,
  exactConnectionPortsForNode,
  structuralValidation,
  simulateExecution,
};
