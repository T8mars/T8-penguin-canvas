/**
 * 节点端口语义注册表(连接类型校验核心)
 *
 * 设计目标:
 *   每个节点声明它的"输入需要什么"与"输出提供什么"。
 *   连接时只允许 source.outputs 与 target.inputs 有交集才能连。
 *   特殊类型 'any' 表示透传,与任何类型互通(用于 relay 中继)。
 *   upload 节点是动态的:输出根据 data.uploadType 决定,未上传时保留空类型 Handle 且不可连出。
 *
 * 端口类型(PortType):
 *   - text:     文本/提示词 (data.prompt)
 *   - image:    图像 URL (data.imageUrl)
 *   - video:    视频 URL (data.videoUrl)
 *   - audio:    音频 URL (data.audioUrl)
 *   - model3d:  3D 模型 URL (data.modelUrl/modelUrls)
 *   - metadata: 结构化元数据(肖像/参数包)
 *   - config:   配置参数(rh-config 注入)
 *   - any:      透传(中继)
 */
import type { Node } from '@xyflow/react';
import schemaManifest from '../../backend/src/shared/canvasNodeSchema.json' with { type: 'json' };
import klingV4 from '../../backend/src/shared/klingV4Contract.json';
import { normalizeRandomRouteSettings, randomRouteOutputHandle } from '../utils/randomRoute.ts';

export type PortType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'model3d'
  | 'metadata'
  | 'config'
  | 'any';

export interface NodePorts {
  /** 该节点能接受的输入类型集合 */
  inputs: PortType[];
  /** 该节点能产出的输出类型集合 */
  outputs: PortType[];
}

export type ConnectionPortResolver =
  | 'video'
  | 'static'
  | 'upload'
  | 'material-set'
  | 'loop'
  | 'pick-from-set'
  | 'random-route'
  | 'subflow'
  | 'toolbox-param';

export interface NodeConnectionPort {
  id: string | null;
  kinds: PortType[];
  required: boolean;
  minConnections: number;
  maxConnections: number | null;
  preferred?: boolean;
  hasDefault?: boolean;
}

export interface ResolvedNodeConnectionPorts {
  resolved: true;
  resolver: ConnectionPortResolver;
  inputs: NodeConnectionPort[];
  outputs: NodeConnectionPort[];
}

export interface UnresolvedNodeConnectionPorts {
  resolved: false;
  resolver: ConnectionPortResolver | 'unknown';
  reason: string;
  inputs: [];
  outputs: [];
}

export type NodeConnectionPortResolution = ResolvedNodeConnectionPorts | UnresolvedNodeConnectionPorts;

interface ManifestConnectionPortAuthority {
  resolver: ConnectionPortResolver;
  inputs: unknown[];
  outputs: unknown[];
}

interface CanvasNodePortManifest {
  connectionPorts: Record<string, ManifestConnectionPortAuthority>;
}

const PORT_TYPES = new Set<PortType>(['text', 'image', 'video', 'audio', 'model3d', 'metadata', 'config', 'any']);
const MATERIAL_KINDS = new Set<PortType>(['text', 'image', 'video', 'audio']);
const UPLOAD_KINDS = new Set<PortType>(['image', 'video', 'audio', 'model3d']);
const CONNECTION_PORT_RESOLVERS = new Set<ConnectionPortResolver>([
  'video',
  'static', 'upload', 'material-set', 'loop', 'pick-from-set', 'random-route', 'subflow', 'toolbox-param',
]);
const MANIFEST_CONNECTION_PORTS = (schemaManifest as unknown as CanvasNodePortManifest).connectionPorts;

// 画布内部结构节点不属于公开/可生成的生产业务节点，但其 JSX Handle 仍必须精确校验。
const INTERNAL_CONNECTION_PORTS: Record<string, ManifestConnectionPortAuthority> = {
  groupBox: {
    resolver: 'static', inputs: [], outputs: [{ id: 'group-out', kinds: ['any'], required: false, minConnections: 0, maxConnections: null }],
  },
};

const DEV_CONNECTION_PORTS: Record<string, ManifestConnectionPortAuthority> = import.meta.env?.DEV ? {
  'rh-toolbox-maker': {
    resolver: 'static', inputs: [], outputs: [{ id: null, kinds: ['text'], required: false, minConnections: 0, maxConnections: null }],
  },
  'fal-toolbox-maker': {
    resolver: 'static', inputs: [], outputs: [{ id: null, kinds: ['text'], required: false, minConnections: 0, maxConnections: null }],
  },
} : {};

/**
 * 判断一个节点类型是否拥有权威连接契约。
 *
 * 这里同时覆盖生产节点、持久化内部结构节点和开发态节点。工作流医生等
 * 结构检查必须复用它，不能只看侧边栏 NODE_REGISTRY；否则合法的 groupBox
 * 聚合出口会在单节点/组选区体检中被误报为“未知节点类型”。
 */
export function isKnownCanvasNodeType(type: unknown): type is string {
  if (typeof type !== 'string' || !type) return false;
  return Object.prototype.hasOwnProperty.call(MANIFEST_CONNECTION_PORTS, type)
    || Object.prototype.hasOwnProperty.call(INTERNAL_CONNECTION_PORTS, type)
    || Object.prototype.hasOwnProperty.call(DEV_CONNECTION_PORTS, type);
}

const TOOLBOX_PARAM_KIND_BY_TYPE: Record<string, 'cinematic' | 'video-motion' | 'multi-angle-visual'> = {
  cinematic: 'cinematic',
  'video-motion': 'video-motion',
  'multi-angle-visual': 'multi-angle-visual',
};

function unresolvedConnectionPorts(
  reason: string,
  resolver: ConnectionPortResolver | 'unknown' = 'unknown',
): UnresolvedNodeConnectionPorts {
  return { resolved: false, resolver, reason, inputs: [], outputs: [] };
}

function normalizePortId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || value.trim() !== value) return undefined;
  return value;
}

function normalizeManifestConnectionPort(value: unknown): NodeConnectionPort | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = normalizePortId(raw.id);
  if (id === undefined) return null;
  if (!Array.isArray(raw.kinds) || raw.kinds.length === 0 || raw.kinds.length > PORT_TYPES.size) return null;
  const kinds = raw.kinds.filter((kind): kind is PortType => typeof kind === 'string' && PORT_TYPES.has(kind as PortType));
  if (kinds.length !== raw.kinds.length || new Set(kinds).size !== kinds.length) return null;
  const minConnections = Number(raw.minConnections);
  const maxConnections = raw.maxConnections == null ? null : Number(raw.maxConnections);
  if (!Number.isSafeInteger(minConnections) || minConnections < 0 || minConnections > 1_000) return null;
  if (maxConnections != null && (!Number.isSafeInteger(maxConnections) || maxConnections < minConnections || maxConnections > 1_000)) return null;
  if (typeof raw.required !== 'boolean') return null;
  if (raw.preferred !== undefined && typeof raw.preferred !== 'boolean') return null;
  return {
    id,
    kinds: [...kinds],
    required: raw.required,
    minConnections,
    maxConnections,
    ...(raw.preferred === undefined ? {} : { preferred: raw.preferred }),
  };
}

function normalizeAuthorityPorts(value: unknown): NodeConnectionPort[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const ports = value.map(normalizeManifestConnectionPort);
  if (ports.some((port) => !port)) return null;
  const resolved = ports as NodeConnectionPort[];
  const ids = resolved.map((port) => port.id);
  if (new Set(ids).size !== ids.length) return null;
  return resolved;
}

function staticAuthority(type: string): ResolvedNodeConnectionPorts | UnresolvedNodeConnectionPorts {
  const raw = MANIFEST_CONNECTION_PORTS?.[type] || INTERNAL_CONNECTION_PORTS[type] || DEV_CONNECTION_PORTS[type];
  if (!raw || !CONNECTION_PORT_RESOLVERS.has(raw.resolver)) return unresolvedConnectionPorts('node connection authority is missing');
  const inputs = normalizeAuthorityPorts(raw.inputs);
  const outputs = normalizeAuthorityPorts(raw.outputs);
  if (!inputs || !outputs) return unresolvedConnectionPorts('node connection authority is invalid', raw.resolver);
  return { resolved: true, resolver: raw.resolver, inputs, outputs };
}

function portWithKinds(port: NodeConnectionPort, kinds: PortType[]): NodeConnectionPort {
  return { ...port, kinds: [...kinds] };
}

function normalizedDataKind(value: unknown, kinds: Set<PortType>): PortType | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !kinds.has(value as PortType)) return undefined;
  return value as PortType;
}

function hasUsableMaterialSetItem(value: unknown, kind: PortType): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  let itemKind: PortType;
  if (item.kind === undefined || item.kind === null || item.kind === '') {
    itemKind = kind;
  } else if (typeof item.kind === 'string' && MATERIAL_KINDS.has(item.kind as PortType)) {
    itemKind = item.kind as PortType;
  } else {
    return false;
  }
  if (itemKind !== kind) return false;
  const rawValue = kind === 'text' ? (item.text ?? item.url) : item.url;
  return typeof rawValue === 'string' && rawValue.trim().length > 0;
}

function resolveSubflowConnectionPorts(node: Node): NodeConnectionPortResolution {
  const data = ((node.data || {}) as Record<string, unknown>);
  const definition = data.definition;
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return unresolvedConnectionPorts('subflow definition is missing', 'subflow');
  }
  const embedded = definition as Record<string, unknown>;
  const fixedId = normalizePortId(data.definitionId);
  const fixedVersion = data.definitionVersion;
  const embeddedVersion = embedded.version;
  if (typeof fixedId !== 'string'
    || embedded.id !== fixedId
    || typeof fixedVersion !== 'number'
    || !Number.isSafeInteger(fixedVersion)
    || fixedVersion < 1
    || typeof embeddedVersion !== 'number'
    || !Number.isSafeInteger(embeddedVersion)
    || embeddedVersion !== fixedVersion) {
    return unresolvedConnectionPorts('subflow fixed definition identity does not match embedded definition', 'subflow');
  }
  if (data.definitionRevision != null && embedded.revision != null) {
    const fixedRevision = data.definitionRevision;
    const embeddedRevision = embedded.revision;
    if (typeof fixedRevision !== 'number'
      || !Number.isSafeInteger(fixedRevision)
      || fixedRevision < 1
      || typeof embeddedRevision !== 'number'
      || !Number.isSafeInteger(embeddedRevision)
      || embeddedRevision !== fixedRevision) {
      return unresolvedConnectionPorts('subflow fixed revision does not match embedded definition', 'subflow');
    }
  }
  const rawInputs = embedded.inputs;
  const rawOutputs = embedded.outputs;
  if (!Array.isArray(rawInputs) || !Array.isArray(rawOutputs) || rawInputs.length + rawOutputs.length > 200) {
    return unresolvedConnectionPorts('subflow ports are invalid', 'subflow');
  }
  const seen = new Set<string>();
  const normalize = (rawPort: unknown): NodeConnectionPort | null => {
    if (!rawPort || typeof rawPort !== 'object' || Array.isArray(rawPort)) return null;
    const port = rawPort as Record<string, unknown>;
    const id = normalizePortId(port.id);
    if (typeof id !== 'string' || seen.has(id) || !PORT_TYPES.has(port.kind as PortType)) return null;
    if (port.required != null && typeof port.required !== 'boolean') return null;
    const required = port.required === true;
    const minConnections = port.minConnections == null ? (required ? 1 : 0) : port.minConnections;
    const maxConnections = port.maxConnections == null ? null : port.maxConnections;
    if (typeof minConnections !== 'number'
      || !Number.isSafeInteger(minConnections)
      || minConnections < 0
      || minConnections > 1_000) return null;
    if (maxConnections != null && (typeof maxConnections !== 'number'
      || !Number.isSafeInteger(maxConnections)
      || maxConnections < minConnections
      || maxConnections > 1_000)) return null;
    seen.add(id);
    return {
      id,
      kinds: [port.kind as PortType],
      required,
      minConnections,
      maxConnections,
      hasDefault: Object.prototype.hasOwnProperty.call(port, 'defaultValue') && port.defaultValue !== undefined,
    };
  };
  const inputs = rawInputs.map(normalize);
  const outputs = rawOutputs.map(normalize);
  if (inputs.some((port) => !port) || outputs.some((port) => !port)) {
    return unresolvedConnectionPorts('subflow port contract is invalid', 'subflow');
  }
  return {
    resolved: true,
    resolver: 'subflow',
    inputs: inputs as NodeConnectionPort[],
    outputs: outputs as NodeConnectionPort[],
  };
}

/**
 * 将节点类型、实际 Handle ID 与实例 data 解析为唯一端口契约。
 * 任何未知 authority / discriminator / 子工作流契约都 fail closed，调用方不得回退 aggregate ports。
 */
export function resolveNodeConnectionPorts(node: Node | null | undefined): NodeConnectionPortResolution {
  if (!node || typeof node.type !== 'string' || !node.type) return unresolvedConnectionPorts('node type is missing');
  const authority = staticAuthority(node.type);
  if (!authority.resolved) return authority;
  const data = ((node.data || {}) as Record<string, unknown>);
  if (authority.resolver === 'static') return authority;
  if (authority.resolver === 'video') {
    const model = String(data.klingV4Pending && typeof data.klingV4Pending === 'object' ? (data.klingV4Pending as Record<string, unknown>).model : data.model || '');
    const auxiliary = klingV4.auxiliaryModels.includes(model) && (!data.providerSource || data.providerSource === 'zhenzhen');
    const kinds: PortType[] = auxiliary ? model.endsWith('voice') ? ['text', 'audio', 'metadata'] : ['text', 'metadata'] : ['video'];
    return { ...authority, outputs: authority.outputs.map(port => portWithKinds(port, kinds)) };
  }
  if (authority.resolver === 'subflow') return resolveSubflowConnectionPorts(node);

  if (authority.resolver === 'upload') {
    const kind = normalizedDataKind(data.uploadType, UPLOAD_KINDS);
    const output = authority.outputs[0];
    if (!output || output.id !== null) return unresolvedConnectionPorts('upload authority is invalid', 'upload');
    return { ...authority, outputs: [portWithKinds(output, kind ? [kind] : [])] };
  }

  if (authority.resolver === 'material-set') {
    const kind = normalizedDataKind(data.materialSetKind, MATERIAL_KINDS);
    const input = authority.inputs[0];
    const output = authority.outputs[0];
    if (!input || !output || input.id !== null || output.id !== null) {
      return unresolvedConnectionPorts('material-set authority is invalid', 'material-set');
    }
    const selectedKind = kind || null;
    const hasItems = Boolean(selectedKind)
      && Array.isArray(data.materialSetItems)
      && data.materialSetItems.some((item) => hasUsableMaterialSetItem(item, selectedKind!));
    return {
      ...authority,
      inputs: [portWithKinds(input, selectedKind ? [selectedKind] : [...input.kinds])],
      outputs: [portWithKinds(output, selectedKind && hasItems ? [selectedKind] : [])],
    };
  }

  if (authority.resolver === 'loop' || authority.resolver === 'pick-from-set') {
    const field = authority.resolver === 'loop' ? 'kind' : 'pickKind';
    const rawKind = normalizedDataKind(data[field], MATERIAL_KINDS);
    const kind = rawKind || 'image';
    const input = authority.inputs[0];
    const output = authority.outputs[0];
    if (!input || !output || input.id !== null || output.id !== null) {
      return unresolvedConnectionPorts(`${authority.resolver} authority is invalid`, authority.resolver);
    }
    const inputKinds = authority.resolver === 'loop' && data.mode === 'parallel-custom'
      ? [...MATERIAL_KINDS]
      : [kind];
    return { ...authority, inputs: [portWithKinds(input, inputKinds)], outputs: [portWithKinds(output, [kind])] };
  }

  if (authority.resolver === 'random-route') {
    const input = authority.inputs[0];
    if (!input || input.id !== 'input_data' || input.kinds.length !== 1 || input.kinds[0] !== 'any') {
      return unresolvedConnectionPorts('random-route authority is invalid', 'random-route');
    }
    const { totalOutputs } = normalizeRandomRouteSettings(data);
    const outputs = Array.from({ length: totalOutputs }, (_, index): NodeConnectionPort => ({
      id: randomRouteOutputHandle(index + 1),
      kinds: ['any'],
      required: false,
      minConnections: 0,
      maxConnections: null,
    }));
    return { ...authority, outputs };
  }

  if (authority.resolver === 'toolbox-param') {
    const expected = TOOLBOX_PARAM_KIND_BY_TYPE[node.type];
    const missingKind = data.kind === undefined || data.kind === null || data.kind === '';
    const actual = missingKind ? 'cinematic' : data.kind;
    if (!expected || actual !== expected) return unresolvedConnectionPorts('toolbox type and data.kind do not match', 'toolbox-param');
    return authority;
  }

  return unresolvedConnectionPorts('connection resolver is unsupported', authority.resolver);
}

const DEV_NODE_PORTS: Record<string, NodePorts> = import.meta.env?.DEV ? {
  // RH 工具箱制作器: 维护者开发态节点，只输出生成好的 manifest JSON 文本。
  'rh-toolbox-maker': { inputs: [], outputs: ['text'] },
  // FAL 应用制作工具: 维护者开发态节点，只输出生成好的 Fal 超市 manifest JSON 文本。
  'fal-toolbox-maker': { inputs: [], outputs: ['text'] },
} : {};

/**
 * 节点端口注册表
 * 与 features.json 节点清单严格对齐
 */
const MANIFEST_NODE_PORTS = Object.fromEntries(
  schemaManifest.types.map((item) => [
    item.type,
    {
      inputs: [...item.ports.inputs] as PortType[],
      outputs: [...item.ports.outputs] as PortType[],
    },
  ]),
) as Record<string, NodePorts>;

/**
 * 生产节点端口取自共享 t8-canvas-node-schema-v1；DEV 节点只在开发态追加。
 */
export const NODE_PORTS: Record<string, NodePorts> = {
  ...MANIFEST_NODE_PORTS,
  ...DEV_NODE_PORTS,
};

function uniqueKinds(ports: NodeConnectionPort[]): PortType[] {
  return [...new Set(ports.flatMap((port) => port.kinds))];
}

/**
 * 取节点的输入端口类型(返回该节点能接收的 PortType 列表)。
 */
export function getNodeInputs(node: Node | null | undefined): PortType[] {
  const resolution = resolveNodeConnectionPorts(node);
  return resolution.resolved ? uniqueKinds(resolution.inputs) : [];
}

/**
 * 取节点的输出端口类型(对 upload 做动态解析)。
 */
export function getNodeOutputs(node: Node | null | undefined): PortType[] {
  const resolution = resolveNodeConnectionPorts(node);
  return resolution.resolved ? uniqueKinds(resolution.outputs) : [];
}

/**
 * 端口类型集合是否兼容(any 透传 + 交集判定)
 */
export function arePortsCompatible(
  sourceOutputs: PortType[],
  targetInputs: PortType[]
): boolean {
  if (sourceOutputs.length === 0 || targetInputs.length === 0) return false;
  // any 透传:任一侧带 any 即兼容
  if (sourceOutputs.includes('any') || targetInputs.includes('any')) return true;
  // 取交集
  return sourceOutputs.some((t) => targetInputs.includes(t));
}

/**
 * 主校验函数:给 ReactFlow 的 isValidConnection 直接复用。
 *
 * @param source 源节点
 * @param target 目标节点
 * @returns true=允许连接 / false=拒绝
 */
export function isConnectionValid(
  source: Node | null | undefined,
  target: Node | null | undefined,
  connection?: { sourceHandle?: string | null; targetHandle?: string | null },
  existingEdges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }> = [],
): boolean {
  if (!source || !target) return false;
  if (source.id === target.id) return false; // 不允许自连
  // v1.2.9.6: 禁止「循环器 → 输出素材」连接 —— 循环器自身不产出最终结果,
  //          这种连接会变成无内容的空白 OutputNode, 影响体验; 真正的展示应走
  //          「循环器 → EXEC 节点 → OutputNode」累积链路。
  if ((source as any).type === 'loop' && (target as any).type === 'output') return false;
  const sOut = getNodePortKinds(source, 'output', connection?.sourceHandle);
  const tIn = getNodePortKinds(target, 'input', connection?.targetHandle);
  if (!connectionCapacityAvailable(source, 'output', connection?.sourceHandle, existingEdges)) return false;
  if (!connectionCapacityAvailable(target, 'input', connection?.targetHandle, existingEdges)) return false;
  return arePortsCompatible(sOut, tIn);
}

export function getNodePortKinds(node: Node | null | undefined, direction: 'input' | 'output', handle?: string | null): PortType[] {
  return getNodeConnectionPort(node, direction, handle)?.kinds || [];
}

export function getNodeConnectionPort(
  node: Node | null | undefined,
  direction: 'input' | 'output',
  handle?: string | null,
): NodeConnectionPort | null {
  const resolution = resolveNodeConnectionPorts(node);
  if (!resolution.resolved) return null;
  const id = handle == null ? null : String(handle);
  const ports = direction === 'input' ? resolution.inputs : resolution.outputs;
  return ports.find((port) => port.id === id) || null;
}

function connectionCapacityAvailable(
  node: Node,
  direction: 'input' | 'output',
  handle: string | null | undefined,
  edges: Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>,
) {
  const resolution = resolveNodeConnectionPorts(node);
  if (!resolution.resolved) return false;
  const port = getNodeConnectionPort(node, direction, handle);
  if (!port) return false;
  if (port.maxConnections == null) return true;
  const count = edges.filter((edge) => direction === 'input'
    ? edge.target === node.id && (edge.targetHandle ?? null) === port.id
    : edge.source === node.id && (edge.sourceHandle ?? null) === port.id).length;
  return count < port.maxConnections;
}

export function getConnectionPortType(
  source: Node | null | undefined,
  target: Node | null | undefined,
  connection?: { sourceHandle?: string | null; targetHandle?: string | null },
): PortType | null {
  const outputs = getNodePortKinds(source, 'output', connection?.sourceHandle);
  const inputs = getNodePortKinds(target, 'input', connection?.targetHandle);
  return outputs.find((kind) => inputs.includes(kind) || kind === 'any' || inputs.includes('any')) || null;
}

/**
 * 端口类型 → 颜色映射(用于 Handle 颜色与 UI 提示)
 */
export const PORT_COLOR: Record<PortType, string> = {
  text: '#7dd3fc',     // sky-300
  image: '#fcd34d',    // amber-300
  video: '#fda4af',    // rose-300
  audio: '#c4b5fd',    // violet-300
  model3d: '#93c5fd',  // blue-300
  metadata: '#67e8f9', // cyan-300
  config: '#a5b4fc',   // indigo-300
  any: '#cbd5e1',      // slate-300
};

/**
 * 端口类型中文标签
 */
export const PORT_LABEL: Record<PortType, string> = {
  text: '文本',
  image: '图像',
  video: '视频',
  audio: '音频',
  model3d: '3D模型',
  metadata: '元数据',
  config: '配置',
  any: '任意',
};
