import schemaManifest from '../../backend/src/shared/canvasNodeSchema.json' with { type: 'json' };
import type { NodeMeta } from '../types/canvas';
import { nodeDescriptionKey, nodeLabelKey } from '../i18n/nodeCatalog.ts';

interface CanvasNodeSchemaManifest {
  schema: 't8-canvas-node-schema-v1';
  version: 1;
  connectionPorts: Record<string, {
    resolver: 'static' | 'upload' | 'material-set' | 'loop' | 'pick-from-set' | 'random-route' | 'subflow' | 'toolbox-param';
    inputs: Array<{ id: string | null; kinds: string[]; required: boolean; minConnections: number; maxConnections: number | null; preferred?: boolean }>;
    outputs: Array<{ id: string | null; kinds: string[]; required: boolean; minConnections: number; maxConnections: number | null; preferred?: boolean }>;
  }>;
  types: Array<NodeMeta & {
    ports: { inputs: string[]; outputs: string[] };
    executable: boolean;
    generatable: boolean;
    generation: {
      allowedDataFields: Record<string, Record<string, unknown>>;
      defaults: Record<string, unknown>;
      connectionPorts?: {
        dynamic: boolean;
        inputs: Array<{ id: string | null; kinds: string[]; required: boolean; minConnections: number; maxConnections: number | null; preferred?: boolean }>;
        outputs: Array<{ id: string | null; kinds: string[]; required: boolean; minConnections: number; maxConnections: number | null; preferred?: boolean }>;
      };
    };
  }>;
}

export const CANVAS_NODE_SCHEMA_MANIFEST = schemaManifest as unknown as CanvasNodeSchemaManifest;

const DEV_NODE_REGISTRY: NodeMeta[] = import.meta.env?.DEV ? [
  { type: 'rh-toolbox-maker', label: 'RH工具箱制作器', labelKey: nodeLabelKey('rh-toolbox-maker'), category: 'rh', description: '维护者专用：在画布内制作 RH工具箱 manifest 模板，开发环境可见，用户包不打入', descriptionKey: nodeDescriptionKey('rh-toolbox-maker'), icon: 'FileJson', color: 'emerald' },
  { type: 'fal-toolbox-maker', label: 'FAL应用制作工具', labelKey: nodeLabelKey('fal-toolbox-maker'), category: 'fal', description: '维护者专用：从 fal.ai API 文档生成 Fal超市 manifest 草稿，开发环境可见，用户包不打入', descriptionKey: nodeDescriptionKey('fal-toolbox-maker'), icon: 'FileJson', color: 'violet' },
] : [];

const manifestRegistry: NodeMeta[] = CANVAS_NODE_SCHEMA_MANIFEST.types.map((item) => ({
  type: item.type,
  label: item.label,
  labelKey: nodeLabelKey(item.type),
  category: item.category,
  description: item.description,
  descriptionKey: nodeDescriptionKey(item.type),
  icon: item.icon,
  color: item.color,
  ...(item.hidden === true ? { hidden: true } : {}),
}));
const devInsertionIndex = manifestRegistry.findIndex((item) => item.type === 'vibex') + 1;

/**
 * 节点元数据注册表。生产类型与端口、可执行性和 Agent 生成白名单
 * 共用 t8-canvas-node-schema-v1；开发专用节点只在 DEV 中追加。
 */
export const NODE_REGISTRY: NodeMeta[] = [
  ...manifestRegistry.slice(0, devInsertionIndex),
  ...DEV_NODE_REGISTRY,
  ...manifestRegistry.slice(devInsertionIndex),
];

// 按分类分组,便于 Sidebar 渲染 (在这里过滤 hidden 节点 —— 它们仍在 NODE_REGISTRY 中保证节点类型注册)
export const NODE_GROUPS: Record<string, { label: string; nodes: NodeMeta[] }> = {
  input: { label: '素材资源', nodes: NODE_REGISTRY.filter((n) => n.category === 'input' && !n.hidden) },
  core: { label: '核心节点', nodes: NODE_REGISTRY.filter((n) => n.category === 'core' && !n.hidden) },
  rh: { label: 'RH', nodes: NODE_REGISTRY.filter((n) => n.category === 'rh' && !n.hidden) },
  fal: { label: 'FAL工具箱', nodes: NODE_REGISTRY.filter((n) => n.category === 'fal' && !n.hidden) },
  grok: { label: 'GROK OAuth', nodes: NODE_REGISTRY.filter((n) => n.category === 'grok' && !n.hidden) },
  codex: { label: 'CODEX CLI', nodes: NODE_REGISTRY.filter((n) => n.category === 'codex' && !n.hidden) },
  inspiration: { label: '灵感之源', nodes: NODE_REGISTRY.filter((n) => n.category === 'inspiration' && !n.hidden) },
  comfyui: { label: 'ComfyUI', nodes: NODE_REGISTRY.filter((n) => n.category === 'comfyui' && !n.hidden) },
  special: { label: '特殊节点', nodes: NODE_REGISTRY.filter((n) => n.category === 'special' && !n.hidden) },
  utility: { label: '工具节点', nodes: NODE_REGISTRY.filter((n) => n.category === 'utility' && !n.hidden) },
  auxiliary: { label: '辅助节点', nodes: NODE_REGISTRY.filter((n) => n.category === 'auxiliary' && !n.hidden) },
  toolbox: { label: '工具箱', nodes: NODE_REGISTRY.filter((n) => n.category === 'toolbox' && !n.hidden) },
  '3d': { label: '3D', nodes: NODE_REGISTRY.filter((n) => n.category === '3d' && !n.hidden) },
};

export function getNodeMeta(type: string): NodeMeta | undefined {
  return NODE_REGISTRY.find((n) => n.type === type);
}
