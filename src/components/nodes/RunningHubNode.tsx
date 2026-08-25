import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, useNodeConnections, useNodesData, type NodeProps } from '@xyflow/react';
import { AlertCircle, Loader2, Workflow, Wallet, Sparkles, Square, Search, RefreshCw } from 'lucide-react';
import { submitRh, queryRh, cancelRh, fetchRhAppInfo, uploadRhAsset, type RhSite } from '../../services/generation';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { hasReusableGenerationResult, shouldReuseGenerationResult } from '../../utils/reuseGenerationResult';
import type { RunNodeLifecycleReporter } from '../../types/project';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';
import MaterialPreviewSection from './MaterialPreviewSection';
import ReuseResultToggle from './ReuseResultToggle';
import MentionPromptInput from './MentionPromptInput';
import LoopingVideo from '../LoopingVideo';
import SmartImage from '../SmartImage';
import LazyAudio from '../LazyAudio';
import PromptTextarea from '../PromptTextarea';
import { resolveMediaMentions, type MediaMention } from './mediaMentions';
import { useThemeStore } from '../../stores/theme';
import { logBus } from '../../stores/logs';
import { createCanvasNodeExecutionKey, useRunBusStore } from '../../stores/runBus';
import { useCanvasStore } from '../../stores/canvas';
import {
  countExcludedMaterials,
  excludeMaterialId,
  filterExcludedMaterials,
  normalizeExcludedMaterialIds,
} from '../../utils/materialExclusion';
import {
  areRhParamValuesEqual,
  applyRhTextBindings,
  findMaterialById,
  findRhTextMaterialForField,
  normalizeRhNodeId,
  rhParamKey,
  type RhParamValue,
} from '../../utils/rhTextBinding';
import {
  resolveRunningHubDisplaySite,
  resolvedRhSiteFromAppInfo,
} from '../../utils/runningHubResolvedSite';
import { isProviderUploadMediaReference } from '../../utils/providerMediaReference';
import { useCanvasNodeRenderMode } from '../CanvasNodeRenderMode';

/**
 * RunningHubNode - 主工作流节点
 * 输入: webappId(必填) + 点搜索拉取 nodeInfoList 在节点内展开为表单
 * 可选: 上游 RhConfig / image / video / audio / upload 节点补充参数
 * 流程: submit → 5s 轮询 outputs → 转存到 /output → 显示
 */

// ========== fieldType → valueType 映射 ==========
// RH apiCallDemo 返回的 fieldType: IMAGE / VIDEO / AUDIO / STRING / TEXT / NUMBER / FLOAT / INTEGER / BOOLEAN / LIST / SELECT
function inferValueType(fieldType: string | undefined): 'text' | 'number' | 'image' | 'video' | 'audio' {
  const t = String(fieldType || '').toUpperCase();
  if (t === 'IMAGE') return 'image';
  if (t === 'VIDEO') return 'video';
  if (t === 'AUDIO') return 'audio';
  if (t === 'NUMBER' || t === 'FLOAT' || t === 'INTEGER' || t === 'INT') return 'number';
  return 'text';
}

// ========== 提取字段选项列表（LIST / SELECT / DROPDOWN 等下拉类型字段）==========
// RH apiCallDemo 响应中选项可能出现在多个字段名下，有些应用还会把选项数组直接放在 fieldValue 里。
// 返回纯文本/数字数组；null 表示不是下拉选项字段。
//
// 额外补充：RH webapp apiCallDemo 经常只返回 fieldType=TEXT 不带 options 数组，
// 但某些常见参数名（aspectRatio/resolution/instanceType...）在实践中就是枚举。
// 这里维护一个 fieldName 词典作为薱底，仅在 candidates 都未命中时才使用。
const KNOWN_FIELD_OPTIONS: Record<string, Array<string | number>> = {
  aspectRatio: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '3:2', '2:3', '21:9', '9:21', '1:4', '4:1', '1:8', '8:1'],
  aspect_ratio: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '3:2', '2:3', '21:9', '9:21'],
  ratio: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '3:2', '2:3'],
  resolution: ['1k', '2k', '4k', '8k'],
  size: ['512', '768', '1024', '1280', '1536', '2048'],
  mode: ['text2img', 'img2img'],
  quality: ['low', 'medium', 'high', 'best'],
  instanceType: ['default', 'plus', 'pro'],
  instance_type: ['default', 'plus', 'pro'],
  precision: ['fp16', 'fp32', 'bf16'],
  scheduler: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform'],
  sampler: ['euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral', 'lms', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc'],
};

function extractFieldOptions(it: any): Array<string | number> | null {
  // 按优先级依次尝试多种字段名
  const candidates = [
    it?.fieldData,
    it?.options,
    it?.list,
    it?.values,
    it?.enum,
    it?.choices,
    it?.items,
    it?.selectOptions,
    it?.dropdown,
  ];
  for (const c of candidates) {
    if (!Array.isArray(c) || c.length === 0) continue;
    // 1) 纯文本/数字数组
    if (c.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return c as Array<string | number>;
    }
    // 2) [{label, value}] 或 [{name, value}] 形式
    if (c.every((x) => x && typeof x === 'object' && ('value' in x || 'label' in x || 'name' in x))) {
      return c.map((x: any) => (x.value ?? x.label ?? x.name)).filter((v: any) => v != null);
    }
  }
  // 3) 兑底：fieldType=LIST/SELECT 且 fieldValue 本身就是选项数组
  const t = String(it?.fieldType || '').toUpperCase();
  if ((t === 'LIST' || t === 'SELECT' || t === 'DROPDOWN' || t === 'COMBO' || t === 'ENUM') && Array.isArray(it?.fieldValue)) {
    const arr = it.fieldValue;
    if (arr.length > 0 && arr.every((x: any) => typeof x === 'string' || typeof x === 'number')) {
      return arr as Array<string | number>;
    }
  }
  // 4) 词典薱底：按 fieldName 命中常见 RH 枚举字段（不区分大小写）
  const fname = String(it?.fieldName || '').trim();
  if (fname) {
    const direct = KNOWN_FIELD_OPTIONS[fname];
    if (direct) return direct;
    const lower = fname.toLowerCase();
    for (const k in KNOWN_FIELD_OPTIONS) {
      if (k.toLowerCase() === lower) return KNOWN_FIELD_OPTIONS[k];
    }
  }
  return null;
}

// 取字段默认值：如果 fieldValue 是数组（选项集同时充当默认值），取第 0 个作为默认选中。
function extractDefaultValue(it: any): string {
  let v = it?.fieldValue;
  if (Array.isArray(v)) v = v[0];
  if (v == null) return '';
  return typeof v === 'object' ? '' : String(v);
}

// 上游媒体聚合现在由项目统一的 useUpstreamMaterials hook 处理（详见 ./useUpstreamMaterials.ts），
// 本文件不再手写 extractUpstreamUrl，避免与项目其他节点的 url 提取逻辑产生不一致。

const paramKey = rhParamKey;

const RunningHubNode = ({ id, data, selected, type }: NodeProps) => {
  const { t } = useTranslation('nodes');
  const canvasRenderMode = useCanvasNodeRenderMode();
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const [fetchingInfo, setFetchingInfo] = useState(false);

  // RH 钱包应用与普通 RunningHub 仍共用组件和站点 Key；钱包标志只区分 UI。
  const useWallet = type === 'runninghub-wallet';
  const titleText = useWallet ? t('runningHub.walletTitle') : t('runningHub.title');
  const TitleIcon = useWallet ? Wallet : Workflow;
  // 主调色：默认套 cyan 主调；wallet 套 violet（与节点表主色一致）
  const accent = useWallet
    ? { ring: 'border-violet-400', shadow: 'shadow-violet-500/20', dot: 'rgba(139,92,246,.2)', dotInk: '#c4b5fd', dotEdge: 'rgba(139,92,246,.45)', handle: '!bg-violet-400', subBg: 'border-violet-500/20 bg-violet-500/5', sub: 'text-violet-200/80', tag: 'text-violet-300/60 bg-violet-500/10', primary: 'bg-violet-500/20 hover:bg-violet-500/30 text-violet-200', spin: 'text-violet-200/80' }
    : { ring: 'border-cyan-400', shadow: 'shadow-cyan-500/20', dot: 'rgba(6,182,212,.2)', dotInk: '#67e8f9', dotEdge: 'rgba(6,182,212,.45)', handle: '!bg-cyan-400', subBg: 'border-cyan-500/20 bg-cyan-500/5', sub: 'text-cyan-200/80', tag: 'text-cyan-300/60 bg-cyan-500/10', primary: 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200', spin: 'text-cyan-200/80' };

  const d = data as any;
  const webappId: string = d?.webappId || '';
  const appInfo: any = d?.appInfo;
  const storedRhSite: RhSite = d?.rhSite === 'intl' ? 'intl' : 'cn';
  const resolvedAppInfoSite = resolvedRhSiteFromAppInfo(appInfo, webappId);
  const rhSite: RhSite = resolveRunningHubDisplaySite(storedRhSite, webappId, appInfo);
  const activeRhSiteRef = useRef<RhSite>(rhSite);
  const instanceType: string = d?.instanceType || '';
  const status: 'idle' | 'submitting' | 'polling' | 'success' | 'error' = d?.status || 'idle';
  const taskId: string | undefined = d?.taskId;
  const activeTaskIdRef = useRef<string>(taskId ? String(taskId) : '');
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    activeRhSiteRef.current = rhSite;
  }, [rhSite]);

  const applyResolvedRhSite = (site?: RhSite) => {
    if (!site) return;
    const previousSite = activeRhSiteRef.current;
    activeRhSiteRef.current = site;
    if (site !== storedRhSite) update({ rhSite: site });
    if (site !== previousSite || site !== storedRhSite) {
      logBus.info(`RH 站点已自动切换为${site === 'intl' ? '海外站' : '国内站'}`, src);
    }
  };
  const cancelInFlightRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const pollRejectRef = useRef<((error?: Error) => void) | null>(null);
  const originCanvasIdRef = useRef(useCanvasStore.getState().activeId);
  const executionNodeId = createCanvasNodeExecutionKey(originCanvasIdRef.current, id);
  const runCancelSeq = useRunBusStore((s) => s.cancelSeq);
  const runCancelTargets = useRunBusStore((s) => s.cancelTargets);
  const lastRunCancelSeqRef = useRef(runCancelSeq);
  const urls: string[] = d?.urls || [];
  // paramValues: 在节点内为每个 nodeInfoList 条目保存的当前编辑值
  // 结构: { 'nodeId::fieldName': { value: string; sourceFromUpstream?: boolean; sourceMaterialId?: string; sourceRhNodeId?: string } }
  const paramValues: Record<string, RhParamValue> = d?.paramValues || {};
  const paramMentions: Record<string, MediaMention[]> =
    d?.paramMentions && typeof d.paramMentions === 'object' ? d.paramMentions : {};

  useEffect(() => {
    if (resolvedAppInfoSite && resolvedAppInfoSite !== storedRhSite) {
      activeRhSiteRef.current = resolvedAppInfoSite;
      update({ rhSite: resolvedAppInfoSite });
    }
  }, [resolvedAppInfoSite, storedRhSite, update]);

  const stopPoll = (reason?: Error) => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (reason && pollRejectRef.current) {
      const reject = pollRejectRef.current;
      pollRejectRef.current = null;
      reject(reason);
    }
  };
  useEffect(() => () => stopPoll(new Error('已取消')), []);
  useEffect(() => {
    if (taskId) activeTaskIdRef.current = String(taskId);
  }, [taskId]);

  // ========== 上游节点（响应式订阅）==========
  // 之前用 useReactFlow().getEdges/getNodes 是非响应式的，上游 data 变化（例如上传图像节点上传完产出 imageUrl）
  // 不会触发重渲染，导致下面 useEffect 同步上游 url → paramValues 永不触发，节点内媒体预览缺失。
  // 改用 useNodeConnections + useNodesData，xyflow 内部对依赖做了稳定化，上游连/断/data 任一变化都会立即同步。
  const conns = useNodeConnections({ id, handleType: 'target' });
  const upstreamIds = useMemo(
    () => Array.from(new Set(conns.map((c: any) => c.source).filter(Boolean))) as string[],
    [conns],
  );
  const upstreamNodesData = useNodesData(upstreamIds);
  const upstreamNodes = useMemo(
    () => (Array.isArray(upstreamNodesData) ? upstreamNodesData : [upstreamNodesData]).filter(Boolean) as any[],
    [upstreamNodesData],
  );

  // ========== 上游媒体聚合（与 Image/Video/Audio 节点一致的预览体验）==========
  // 使用项目统一的 useUpstreamMaterials hook，按 kind 聚合上游 image/video/audio，
  // 交给 MaterialPreviewSection 统一呈现（含 dnd-kit 拖拽排序、多图并列、双主题适配）。
  // materialOrder 写入本节点 data，负责序列化限定。
  const upstream = useUpstreamMaterials(id);
  const excludedMaterialIds = useMemo(
    () => normalizeExcludedMaterialIds(d?.excludedMaterialIds),
    [d?.excludedMaterialIds],
  );
  const visibleUpstreamImages = useMemo(
    () => filterExcludedMaterials(upstream.images, excludedMaterialIds),
    [upstream.images, excludedMaterialIds],
  );
  const visibleUpstreamVideos = useMemo(
    () => filterExcludedMaterials(upstream.videos, excludedMaterialIds),
    [upstream.videos, excludedMaterialIds],
  );
  const visibleUpstreamAudios = useMemo(
    () => filterExcludedMaterials(upstream.audios, excludedMaterialIds),
    [upstream.audios, excludedMaterialIds],
  );
  const visibleUpstreamTexts = useMemo(
    () => filterExcludedMaterials(upstream.texts, excludedMaterialIds),
    [upstream.texts, excludedMaterialIds],
  );
  const excludedUpstreamCount = useMemo(
    () => countExcludedMaterials(excludedMaterialIds, [...upstream.texts, ...upstream.images, ...upstream.videos, ...upstream.audios]),
    [excludedMaterialIds, upstream.texts, upstream.images, upstream.videos, upstream.audios],
  );
  const materialOrder: string[] = Array.isArray(d?.materialOrder) ? d.materialOrder : [];
  const orderedTexts = useOrderedMaterials(visibleUpstreamTexts, materialOrder);
  const orderedImages = useOrderedMaterials(visibleUpstreamImages, materialOrder);
  const orderedVideos = useOrderedMaterials(visibleUpstreamVideos, materialOrder);
  const orderedAudios = useOrderedMaterials(visibleUpstreamAudios, materialOrder);
  const mentionMaterials = useMemo<Material[]>(
    () => [...orderedTexts, ...orderedImages, ...orderedVideos, ...orderedAudios],
    [orderedTexts, orderedImages, orderedVideos, orderedAudios],
  );
  // 日志来源标识：供 TerminalPanel 面板展示 [src] 前缀。
  // 与 VideoNode/SeedanceNode 保持一致，不同节点类型使用不同前缀 rh / rh-wallet。
  const src = `${type === 'rhWallet' ? 'rh-wallet' : 'rh'}:${id}`;
  const setMaterialOrder = (newOrder: string[]) => update({ materialOrder: newOrder });
  const handleExcludeUpstreamMaterial = (m: Material) => {
    if (m.origin !== 'upstream') return;
    update({
      excludedMaterialIds: excludeMaterialId(excludedMaterialIds, m.id),
      materialOrder: materialOrder.filter((itemId) => itemId !== m.id),
    });
  };
  const handleRestoreExcludedMaterials = () => update({ excludedMaterialIds: [] });
  const { style, theme } = useThemeStore();
  const isPixel = style === 'pixel';
  const isDark = theme === 'dark';

  // 如今需要按“字段在同 kind 下的出现顺序”取第 idx 个排序后的上游素材 url，
  // 实现多个 image/video/audio 字段逆向分配上游多个素材。并受 MaterialPreviewSection 的拖拽排序控制。
  const findUpstreamUrl = (kind: 'image' | 'video' | 'audio', idx = 0): string => {
    const arr = kind === 'image' ? orderedImages : kind === 'video' ? orderedVideos : orderedAudios;
    return arr[idx]?.url || '';
  };

  // 计算每个 media 字段在同 kind 下的索引（用于字段内“同步”按钮定位素材）
  const fieldKindIndex = useMemo(() => {
    const m: Record<string, number> = {};
    const counters: Record<string, number> = { image: 0, video: 0, audio: 0 };
    const list: any[] = appInfo?.nodeInfoList || [];
    for (const it of list) {
      const vt = inferValueType(it?.fieldType);
      if (vt === 'image' || vt === 'video' || vt === 'audio') {
        m[paramKey(it.nodeId, it.fieldName)] = counters[vt]++;
      }
    }
    return m;
  }, [appInfo]);

  // ========== 保存某一条 paramValue ==========
  const setParam = (k: string, patch: Partial<RhParamValue>) => {
    const cur = paramValues[k] || { value: '' };
    const next = { ...paramValues, [k]: { ...cur, ...patch } };
    update({ paramValues: next });
  };

  const getParamMentions = (k: string): MediaMention[] =>
    Array.isArray(paramMentions[k]) ? paramMentions[k] : [];

  const setTextParam = (k: string, value: string, mentions: MediaMention[]) => {
    const cur = paramValues[k] || { value: '' };
    update({
      paramValues: { ...paramValues, [k]: { ...cur, value, sourceFromUpstream: false, sourceMaterialId: '', sourceRhNodeId: '' } },
      paramMentions: { ...paramMentions, [k]: mentions },
    });
  };

  // 对于媒体类字段，随上游节点 url 变化同步回填：
  //   - sourceFromUpstream === true   → 已启用，连续跟进
  //   - sourceFromUpstream === undefined → 用户从未交互过（包括拉取后只填了默认 fieldValue），
  //                                       一旦上游出现对应 url → 自动启用 + 填值（避免用户漏勾导致提交默认值）
  //   - sourceFromUpstream === false  → 用户主动取消过，不动
  // 分配策略：同 kind 下的多个字段按 list 顺序逐个取 orderedImages/Videos/Audios[i]，与 MaterialPreviewSection 的拖拽排序联动。
  useEffect(() => {
    const list: any[] = appInfo?.nodeInfoList;
    if (!Array.isArray(list) || list.length === 0) return;
    let changed = false;
    const next = { ...paramValues };
    const counters: Record<string, number> = { image: 0, video: 0, audio: 0 };
    for (const it of list) {
      const vt = inferValueType(it?.fieldType);
      if (vt !== 'image' && vt !== 'video' && vt !== 'audio') continue;
      const k = paramKey(it.nodeId, it.fieldName);
      const cur = next[k];
      const idx = counters[vt]++;
      const upUrl = findUpstreamUrl(vt, idx);
      if (!upUrl) continue;
      if (cur?.sourceFromUpstream === false) continue; // 用户主动关闭
      if (cur?.sourceFromUpstream === true) {
        if (upUrl !== cur.value) {
          next[k] = { ...cur, value: upUrl };
          changed = true;
        }
      } else {
        // undefined → 首次看到上游，自动启用
        next[k] = { value: upUrl, sourceFromUpstream: true };
        changed = true;
      }
    }
    const withTextBindings = applyRhTextBindings(list, orderedTexts, next);
    if (changed || !areRhParamValuesEqual(paramValues, withTextBindings)) {
      update({ paramValues: withTextBindings });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedTexts, orderedImages, orderedVideos, orderedAudios, appInfo]);

  // ========== 以当前 upstreamNodes + appInfo + paramValues 为输入，同步重算最新 paramValues ==========
  // 用途：handleRun 产业路径上跳过 React state 异步更新陷阱。用户刚连上传视频节点后立刻点
  // 运行， useEffect 同步上游 url 到 paramValues 还未生效；this fn 返回一份实时快照，避免用过期 state。
  const computeFreshValuesNow = (
    list: any[] | undefined,
  ): Record<string, RhParamValue> => {
    const next: Record<string, RhParamValue> = { ...paramValues };
    if (!Array.isArray(list)) return next;
    const counters: Record<string, number> = { image: 0, video: 0, audio: 0 };
    for (const it of list) {
      const vt = inferValueType(it?.fieldType);
      if (vt !== 'image' && vt !== 'video' && vt !== 'audio') continue;
      const k = paramKey(it.nodeId, it.fieldName);
      const cur = next[k];
      const idx = counters[vt]++;
      if (cur?.sourceFromUpstream === false) continue; // 用户主动关闭
      const upUrl = findUpstreamUrl(vt, idx);
      if (!upUrl) continue;
      // sourceFromUpstream === true 或 undefined（初次看到上游）都采用上游实时 url
      next[k] = { value: upUrl, sourceFromUpstream: true };
    }
    return applyRhTextBindings(list, orderedTexts, next);
  };

  // ========== 收集上游 RhConfig nodeInfoList（保留向后兼容）==========
  const collectUpstreamConfigList = () => {
    const list: any[] = [];
    for (const n of upstreamNodes) {
      const arr = (n?.data as any)?.nodeInfoList;
      if (Array.isArray(arr)) list.push(...arr);
    }
    return list;
  };

  // ========== 从节点内表单 + 上游 RhConfig 合并出原始 nodeInfoList（同一个 (nodeId,fieldName) 表单优先）==========
  // 同样接受可选的 override 参数让 handleRun 同步路径能用 freshly fetched 结果
  //
  // 媒体多素材说明：
  //   - RH 协议中 fieldValue 必须是单个 fileName（不能是多行/逗号拼接，否则 LoadImage 节点会
  //     会报 "Custom validation failed for node"）
  //   - 同 (nodeId, fieldName) 重复条目会被后覆盖前丢首
  //   - 因此：不进行任何多 url 拼接也不追加重复记录。如果 webapp 模板只暴露 1 个 image 字段但用户
  //     连了 N 张图，仅使用顶部预览「首张」（fieldKindIndex 对应的 orderedImages[0]）作为该字段值，
  //     剩余素材仅在节点内预览，不会提交到 RH。多图需要 webapp 内部提供多个 image 字段。
  const buildRawNodeInfoList = (
    overrideList?: any[],
    overrideValues?: Record<string, RhParamValue>,
  ): any[] => {
    const seen = new Set<string>();
    const out: any[] = [];
    // 1. 节点内表单
    const list: any[] = overrideList ?? appInfo?.nodeInfoList ?? [];
    const values = overrideValues ?? paramValues;
    for (const it of list) {
      const k = paramKey(it.nodeId, it.fieldName);
      const vt = inferValueType(it?.fieldType);
      const v = values[k]?.value;
      // 未填 且 原始 fieldValue 为空且非必填 → 跳过
      // 如果 fieldValue 是数组（选项集），走 extractDefaultValue 取首项，避免被隐式转成 "a,b,c"。
      const finalVal = v != null && v !== '' ? v : extractDefaultValue(it);
      const submitVal =
        vt === 'text'
          ? resolveMediaMentions(String(finalVal), getParamMentions(k), mentionMaterials)
          : finalVal;
      seen.add(k);
      out.push({
        nodeId: it.nodeId,
        fieldName: it.fieldName,
        fieldValue: submitVal,
        valueType: vt,
      });
    }
    // 2. 上游 RhConfig 补充（同 key 已被节点内覆盖则跳过）
    const upstreamList = collectUpstreamConfigList();
    for (const it of upstreamList) {
      const k = paramKey(it?.nodeId, it?.fieldName);
      if (seen.has(k)) continue;
      out.push(it);
    }
    return out;
  };

  /**
   * 提交前处理：将 valueType=image|video|audio 且 fieldValue 是 url 的条目
   * 调 /upload-asset 转成 RH 内部 fileName。text/number 原样保留。
   * 输出: 干净的 nodeInfoList（仅含 nodeId/fieldName/fieldValue）。
   */
  const resolveNodeInfoList = async (raw: any[]): Promise<any[]> => {
    const out: any[] = [];
    for (const it of raw) {
      const nodeId = it?.nodeId;
      const fieldName = it?.fieldName;
      let fieldValue = it?.fieldValue;
      const vt = it?.valueType;
      if (!nodeId || !fieldName) continue;
      if (vt === 'image' || vt === 'video' || vt === 'audio') {
        let v = String(fieldValue || '').trim();
        // 多行兼容：如果 fieldValue 含换行（旧残留或人工输入），只取首行，避免 RH LoadImage
        // 节点报 "Custom validation failed for node"。多图仅节点内预览不提交到 RH。
        if (v.includes('\n')) {
          const first = v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
          console.log('[RH/resolve] strip multiline', fieldName, '→ keep first only');
          logBus.warn(`多行 fieldValue 检测到1-${fieldName}，仅保留首行`, src);
          v = first;
        }
        // 最后一道兼底：如果当前值看起来不是 url（可能是 RH 内部默认 hash 或用户手填 fileName），
        // 但上游连了对应类型的媒体节点，且用户没有主动取消 sourceFromUpstream，
        // 则强制用上游 url，避免 state 异步/race condition 导致仍提交默认 hash。
        const isUrlLike0 = isProviderUploadMediaReference(v);
        if (!isUrlLike0) {
          const k = paramKey(nodeId, fieldName);
          const cur = paramValues[k];
          if (cur?.sourceFromUpstream !== false) {
            const upUrl = findUpstreamUrl(vt as any);
            if (upUrl) {
              console.log('[RH/resolve] override field', fieldName, 'from', v || '(empty)', '→ upstream', upUrl);
              logBus.debug(`字段 ${fieldName} 从上游覆写 → ${upUrl}`, src);
              v = upUrl;
            }
          }
        }
        if (!v) continue; // 未提供资源 → 跳过该条目
        // 判定为本地/远程 url 的样式 → 走 /upload-asset 转 fileName
        const isUrlLike = isProviderUploadMediaReference(v);
        if (isUrlLike) {
          const r = await uploadRhAsset(v, activeRhSiteRef.current);
          applyResolvedRhSite(r.site);
          fieldValue = r.fileName;
        } else {
          fieldValue = v;
        }
      } else if (vt === 'number') {
        const num = Number(fieldValue);
        fieldValue = Number.isFinite(num) ? num : fieldValue;
      }
      out.push({ nodeId, fieldName, fieldValue });
    }
    return out;
  };

  // v1.2.9.12: 返回 Promise，调用方 await 直到任务真正成功/失败/超时才 resolve/reject。
  //   原设计中 startPolling 启动 setInterval 后立即返回 → handleRun 提交后也立即返回 →
  //   useRunTrigger 认为 runFn 完成 markDone(true)。但实际任务 urls/imageUrl/videoUrl 还未赋值 →
  //   LoopNode awaitNode 立即继续 → extractFromNode 读不到产物 → result=null → failCount++。
  //   修复: 轮询完成才 resolve，handleRun await 它，markDone 时机=任务真正结束。
  //   同样适用于 RH 钱包应用节点 (runninghubWallet)，同一个组件复用。
  const startPolling = (tid: string, reporter?: RunNodeLifecycleReporter): Promise<void> => {
    stopPoll(new Error('已取消'));
    return new Promise<void>((resolve, reject) => {
      let elapsed = 0;
      let settled = false;
      const POLL_INT = 5000;
      const MAX = 480;
      let pollInFlight = false;
      const finish = (ok: boolean, error?: Error) => {
        if (settled) return;
        settled = true;
        if (pollTimer.current) {
          window.clearInterval(pollTimer.current);
          pollTimer.current = null;
        }
        pollRejectRef.current = null;
        if (activeTaskIdRef.current === tid) activeTaskIdRef.current = '';
        if (ok) resolve();
        else reject(error || new Error('RH 轮询失败'));
      };
      pollRejectRef.current = (error?: Error) => finish(false, error || new Error('已取消'));
      pollTimer.current = window.setInterval(async () => {
        if (pollInFlight) return;
        elapsed += 1;
        if (elapsed > MAX) {
          update({ status: 'error', error: '轮询超时' });
          setError('轮询超时');
          finish(false, new Error('轮询超时'));
          return;
        }
        pollInFlight = true;
        try {
          const r = await queryRh(tid, activeRhSiteRef.current);
          applyResolvedRhSite(r.site);
          await reporter?.polling({
            provider: 'runninghub',
            model: webappId,
            site: r.site || activeRhSiteRef.current,
            taskId: tid,
            requestId: r.requestId,
            transportHttpStatus: r.transportHttpStatus,
            upstreamHttpStatus: r.upstreamHttpStatus,
            usage: r.usage,
            httpStatusSource: 'local-backend',
            pollCount: elapsed,
            pollLimit: MAX,
            status: r.status,
            code: r.code,
            outputCount: (Array.isArray(r.urls) ? r.urls.length : 0) + (Array.isArray(r.texts) ? r.texts.length : 0),
          });
          console.log('[RH/poll] taskId=', tid, 'status=', r.status, 'code=', r.code, 'urls=', r.urls?.length || 0);
          // 轮询进度写入面板：每 30s 一条 debug，避免刷屏
          if (elapsed % 6 === 0) {
            logBus.debug(`[${elapsed * 5}s] status=${r.status} code=${r.code} urls=${r.urls?.length || 0}`, src);
          }
          if (String(r.status || '').toUpperCase() === 'MATERIALIZING') {
            update({ status: 'polling', progress: '100% · 正在下载', rhCode: r.code });
            if (elapsed === 1 || elapsed % 10 === 0) {
              logBus.warn(
                r.error || 'RunningHub 任务已经完成，正在适配 TUN/代理网络并安全下载输出；不会重复提交任务',
                src,
              );
            }
          } else if (r.status === 'SUCCESS') {
            // 按后缀分流到 imageUrl/videoUrl/audioUrl，避免视频 url 被填到 imageUrl 导致
            // OutputNode 当图片渲染而空白。
            const list: string[] = Array.isArray(r.urls) ? r.urls : [];
            const textOutputs = (Array.isArray(r.texts) ? r.texts : [])
              .map((value) => String(value || '').trim())
              .filter(Boolean);
            const textValue = textOutputs.join('\n\n');
            const isImg = (u: string) => /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(u);
            const isVid = (u: string) => /\.(mp4|webm|mov|m4v|mkv)$/i.test(u);
            const isAud = (u: string) => /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(u);
            const firstImg = list.find(isImg);
            const firstVid = list.find(isVid);
            const firstAud = list.find(isAud);
            const patch: any = {
              status: 'success',
              urls: list,
              provider: 'runninghub',
              model: webappId,
              taskId: tid,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              textUrls: Array.isArray(r.textUrls) ? r.textUrls : [],
            };
            if (textValue) {
              patch.outputText = textValue;
              patch.text = textValue;
              patch.texts = textOutputs;
              patch.textSegments = textOutputs;
            }
            if (firstImg) patch.imageUrl = firstImg;
            if (firstVid) patch.videoUrl = firstVid;
            if (firstAud) patch.audioUrl = firstAud;
            // 都不匹配时退回原逻辑（首个当 imageUrl）以保证向后兼容
            if (!firstImg && !firstVid && !firstAud && list[0]) patch.imageUrl = list[0];
            console.log('[RH/done] taskId=', tid, 'media=', list.length, 'texts=', textOutputs.length);
            logBus.success(`任务完成 · ${list.length + textOutputs.length} 个输出`, src);
            update(patch);
            await reporter?.providerResponse({
              provider: 'runninghub',
              model: webappId,
              upstreamTaskId: tid,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              status: 'succeeded',
              httpStatusSource: 'local-backend',
            });
            finish(true);
          } else if (r.status === 'FAILED') {
            // failReason 可能是 ComfyUI 报错对象(含 traceback/exception_type 等)，
            // 需序列化为字符串避免 React JSX 直接渲染 object 崩溃
            let reason: string;
            if (r.failReason == null) {
              reason = `RH 失败 code=${r.code}`;
            } else if (typeof r.failReason === 'string') {
              reason = r.failReason;
            } else {
              try {
                const o: any = r.failReason;
                reason = o?.exception_message || o?.message || JSON.stringify(o);
              } catch {
                reason = `RH 失败 code=${r.code}`;
              }
            }
            await reporter?.providerResponse({
              provider: 'runninghub',
              model: webappId,
              upstreamTaskId: tid,
              requestId: r.requestId,
              transportHttpStatus: r.transportHttpStatus,
              upstreamHttpStatus: r.upstreamHttpStatus,
              usage: r.usage,
              pollCount: elapsed,
              status: 'failed',
              error: { message: reason },
              httpStatusSource: 'local-backend',
            });
            update({ status: 'error', error: reason });
            setError(reason);
            logBus.error(`生成失败: ${reason}`, src);
            finish(false, new Error(reason));
          } else {
            update({ status: 'polling', rhCode: r.code });
          }
        } catch (e: any) {
          console.warn('RH 轮询出错', e?.message);
          logBus.warn(`轮询出错: ${e?.message || e}`, src);
        } finally {
          pollInFlight = false;
        }
      }, POLL_INT);
    });
  };

  // 返回本次拉取与计算后的可用 list + paramValues，供 handleRun 同步路径直接使用
  // （避免 React state 异步更新后 closure 还指向旧值）
  const handleFetchInfo = async (): Promise<{
    list: any[];
    paramValues: Record<string, RhParamValue>;
  } | null> => {
    setError(null);
    if (!webappId) {
      setError('请先填写 webappId');
      return null;
    }
    setFetchingInfo(true);
    try {
      const info = await fetchRhAppInfo(webappId, activeRhSiteRef.current);
      applyResolvedRhSite(info?.rhSite);
      const list: any[] = info?.nodeInfoList || [];
      // 调试日志：打印原始 nodeInfoList 结构，方便后续按实际字段名/fieldType 扩充 LIST 词典
      try {
        console.log('[RH/fetchInfo] webappId=', webappId, 'nodeInfoList=', JSON.parse(JSON.stringify(list)));
      } catch {}
      logBus.info(`拉取应用信息 · webappId=${webappId} · ${list.length} 个字段`, src);
      const next: Record<string, RhParamValue> = { ...paramValues };
      for (const it of list) {
        const k = paramKey(it.nodeId, it.fieldName);
        const vt = inferValueType(it?.fieldType);
        if (k in next) continue;
        if (vt === 'image' || vt === 'video' || vt === 'audio') {
          // 媒体类字段默认勾选「从上游自动获取」。
          //   - 上游已接入对应媒体 → 填上游 url
          //   - 上游未接入 → 值为空，等上游连接后同步 useEffect 会自动填入
          const upUrl = findUpstreamUrl(vt);
          next[k] = { value: upUrl || '', sourceFromUpstream: true };
          continue;
        }
        // 非媒体字段：如果 fieldValue 是数组（选项集充当默认值），取第 0 个项作为默认选中。
        next[k] = { value: extractDefaultValue(it) };
      }
      const withTextBindings = applyRhTextBindings(list, orderedTexts, next);
      update({ appInfo: info, paramValues: withTextBindings });
      return { list, paramValues: withTextBindings };
    } catch (e: any) {
      setError(e?.message || '查询失败');
      logBus.error(`拉取应用信息失败: ${e?.message || e}`, src);
      return null;
    } finally {
      setFetchingInfo(false);
    }
  };

  // 自动拉取：第一次 webappId 有值且上游有可用素材（文本/媒体）且还未拉取过任何 appInfo 时，
  // 静默拉一次，避免用户漏点搜索按钮导致提交空 nodeInfoList 后 RH 用了应用默认参数。
  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (autoFetchedRef.current) return;
    if (!webappId) return;
    if (appInfo) return;
    if (fetchingInfo) return;
    const hasUpstreamPayload = orderedTexts.length > 0 || !!(findUpstreamUrl('image') || findUpstreamUrl('video') || findUpstreamUrl('audio'));
    if (!hasUpstreamPayload) return;
    autoFetchedRef.current = true;
    void handleFetchInfo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webappId, upstreamNodes, appInfo]);

  const handleRun = async (reporter?: RunNodeLifecycleReporter) => {
    stopRequestedRef.current = false;
    setError(null);
    if (!webappId) {
      setError('请先填写 webappId');
      return;
    }
    await reporter?.providerRequest({ provider: 'runninghub', model: webappId });
    // 兑底：如果还没拉过 appInfo 且上游接了媒体节点，先同步拉一次，
    // 避免提交空 nodeInfoList 后 RH 黙默用了应用默认参数。
    let freshList: any[] | null = null;
    let freshValues: Record<string, RhParamValue> | null = null;
    if (!appInfo?.nodeInfoList?.length) {
      const hasUpstreamPayload = orderedTexts.length > 0 || !!(findUpstreamUrl('image') || findUpstreamUrl('video') || findUpstreamUrl('audio'));
      if (hasUpstreamPayload) {
        const r = await handleFetchInfo();
        if (r) {
          freshList = r.list;
          freshValues = r.paramValues;
        }
      }
    }
    // 关键：无论 appInfo 是否已存在，进入 handleRun 都以当前 upstreamNodes 为准重算
    // 一次 paramValues，避免 React state 异步更新陷阱（刚连上游立刻运行，state 还没生效）。
    const effectiveList = freshList ?? appInfo?.nodeInfoList ?? [];
    const effectiveValues = freshValues ?? computeFreshValuesNow(effectiveList);
    // 同步一份到 state，避免 UI 显示与提交不一致
    if (Object.keys(effectiveValues).length > 0) {
      update({ paramValues: effectiveValues });
    }
    update({ status: 'submitting', error: null, urls: [], taskId: null });
    try {
      const rawList = buildRawNodeInfoList(effectiveList, effectiveValues);
      // 提交前：把媒体类 url 转成 RH 内部 fileName
      const nodeInfoList = await resolveNodeInfoList(rawList);
      console.log('[RH/submit] webappId=', webappId, 'nodeInfoList=', JSON.parse(JSON.stringify(nodeInfoList)));
      logBus.info(`提交任务 · webappId=${webappId} · ${nodeInfoList.length} 个字段${useWallet ? ' · 钱包模式' : ''}`, src);
      const r = await submitRh({
        webappId,
        nodeInfoList,
        instanceType: instanceType || undefined,
        site: activeRhSiteRef.current,
      }, { submissionKey: reporter?.providerSubmissionKey });
      applyResolvedRhSite(r.site);
      await reporter?.providerSubmitted({
        provider: 'runninghub',
        model: webappId,
        upstreamTaskId: r.taskId,
        requestId: r.requestId,
        transportHttpStatus: r.transportHttpStatus,
        upstreamHttpStatus: r.upstreamHttpStatus,
        usage: r.usage,
        httpStatusSource: 'local-backend',
      });
      activeTaskIdRef.current = r.taskId;
      console.log('[RH/submit] taskId=', r.taskId);
      if (stopRequestedRef.current) {
        logBus.warn(`停止请求已收到，提交返回后立即取消 RH 后台任务 taskId=${r.taskId}`, src);
        try {
          setCancelling(true);
          await cancelRh(r.taskId, r.site || activeRhSiteRef.current);
          logBus.success(`已请求取消 RH 后台任务 taskId=${r.taskId}`, src);
          stopPoll(new Error('已取消'));
          stopRequestedRef.current = false;
          activeTaskIdRef.current = '';
          update({ status: 'idle', taskId: '', error: null });
          return;
        } catch (cancelError: any) {
          logBus.error(`取消 RH 后台任务失败: ${cancelError?.message || cancelError}`, src);
          stopRequestedRef.current = false;
          update({ status: 'polling', taskId: r.taskId, error: `取消 RH 后台任务失败：${cancelError?.message || cancelError}` });
        } finally {
          setCancelling(false);
        }
      }
      logBus.success(`异步任务已提交 taskId=${r.taskId} 进入轮询…`, src);
      update({ status: 'polling', taskId: r.taskId });
      // v1.2.9.12: await 让 useRunTrigger 等到任务真正完成才 markDone，循环器才能拿到 urls
      await startPolling(r.taskId, reporter);
    } catch (e: any) {
      if (stopRequestedRef.current || e?.message === '已取消') {
        await reporter?.providerResponse({
          provider: 'runninghub',
          model: webappId,
          upstreamTaskId: activeTaskIdRef.current || undefined,
          status: 'stopped',
          error: { message: e?.message || '已取消' },
        });
        logBus.warn('任务已停止', src);
        update({ status: 'idle', taskId: '' });
        return;
      }
      await reporter?.providerResponse({
        provider: 'runninghub',
        model: webappId,
        upstreamTaskId: activeTaskIdRef.current || undefined,
        requestId: e?.requestId,
        transportHttpStatus: e?.transportHttpStatus,
        upstreamHttpStatus: e?.upstreamHttpStatus,
        status: 'failed',
        error: { message: e?.message || '提交失败', code: e?.code },
        httpStatusSource: 'local-backend',
      });
      console.error('[RH/submit] error:', e);
      logBus.error(`提交失败: ${e?.message || e}`, src);
      setError(e?.message || '提交失败');
      update({ status: 'error', error: e?.message });
    }
  };

  // 接入运行总线,供批量运行调起(不重复调起轮询中的任务)
  useRunTrigger(id, async (reporter) => {
    if (status === 'submitting' || status === 'polling') return;
    await handleRun(reporter);
  }, undefined, {
    lifecycleAware: true,
    shouldReuseResult: (nodeData) => shouldReuseGenerationResult('runninghub', nodeData),
  });

  const handleStop = async () => {
    stopRequestedRef.current = true;
    const tid = String(activeTaskIdRef.current || taskId || '').trim();
    if (!tid) {
      logBus.warn('用户主动停止：等待 RH 返回 taskId 后再取消后台任务', src);
      update({ error: '正在等待 RH taskId，拿到后会立即取消后台任务' });
      return;
    }
    if (cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    setCancelling(true);
    logBus.warn(`用户主动停止，正在请求取消 RH 后台任务 taskId=${tid}`, src);
    update({ taskId: tid, error: '正在请求取消 RH 后台任务...' });
    try {
      await cancelRh(tid, activeRhSiteRef.current);
      logBus.success(`已请求取消 RH 后台任务 taskId=${tid}`, src);
      stopPoll(new Error('已取消'));
      stopRequestedRef.current = false;
      activeTaskIdRef.current = '';
      update({ status: 'idle', taskId: '', error: null });
    } catch (error: any) {
      logBus.error(`取消 RH 后台任务失败: ${error?.message || error}`, src);
      update({
        status: status === 'submitting' ? 'submitting' : 'polling',
        taskId: tid,
        error: `取消 RH 后台任务失败：${error?.message || error}`,
      });
    } finally {
      cancelInFlightRef.current = false;
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (runCancelSeq === lastRunCancelSeqRef.current) return;
    lastRunCancelSeqRef.current = runCancelSeq;
    if (!runCancelTargets.includes(executionNodeId)) return;
    if (status !== 'submitting' && status !== 'polling' && !taskId && !activeTaskIdRef.current) return;
    handleStop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runCancelSeq, runCancelTargets, executionNodeId, status, taskId]);

  const isBusy = status === 'submitting' || status === 'polling' || cancelling;
  const nodeInfoList: any[] = appInfo?.nodeInfoList || [];

  if (canvasRenderMode === 'cold') {
    return (
      <div className="t8-node-cold-shell w-[340px]" data-t8-node-cold-shell="runninghub" style={{ minHeight: 168 }}>
        <Handle type="target" position={Position.Left} className={`${accent.handle} !border-0`} />
        <Handle type="source" position={Position.Right} className={`${accent.handle} !border-0`} />
        <div className="t8-node-cold-shell__header">
          <TitleIcon size={16} className="shrink-0" style={{ color: accent.dotInk }} />
          <div className="t8-node-cold-shell__copy">
            <strong>{titleText}</strong>
            <small>{t('runningHub.offscreen', { name: appInfo?.appName || appInfo?.name || webappId || t('runningHub.offscreenEmpty') })}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-xl border-2 transition-all w-[340px] ${
        selected ? `${accent.ring} shadow-2xl ${accent.shadow}` : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        // 像素风：不透明背景 + 取消 backdrop blur，避免亚像素渲染导致节点内文字发虚
        background: isPixel ? 'var(--px-surface)' : 'rgba(20,20,22,.92)',
        backdropFilter: isPixel ? 'none' : 'blur(8px)',
        color: isPixel ? 'var(--px-ink)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className={`${accent.handle} !border-0`} />
      <Handle type="source" position={Position.Right} className={`${accent.handle} !border-0`} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: accent.dot, color: accent.dotInk, boxShadow: `inset 0 0 0 1px ${accent.dotEdge}` }}
        >
          <TitleIcon size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{titleText}</div>
          <div className="text-[10px] text-white/40 truncate">{appInfo?.appName || appInfo?.name || (useWallet ? t('runningHub.walletWorkflow') : t('runningHub.workflow'))}</div>
        </div>
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        {/* 上游素材聚合预览区：文本 RH# 会联动下方 RH 参数，媒体仍按类型顺序自动分配。 */}
        {(orderedTexts.length + orderedImages.length + orderedVideos.length + orderedAudios.length + excludedUpstreamCount) > 0 && (
          <MaterialPreviewSection
            texts={orderedTexts}
            images={orderedImages}
            videos={orderedVideos}
            audios={orderedAudios}
            order={materialOrder}
            onReorder={setMaterialOrder}
            onExcludeUpstream={handleExcludeUpstreamMaterial}
            excludedCount={excludedUpstreamCount}
            onRestoreExcluded={handleRestoreExcludedMaterials}
            isDark={isDark}
            isPixel={isPixel}
            groups={['text', 'image', 'video', 'audio']}
            title={t('runningHub.upstreamTitle')}
          />
        )}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">{t('runningHub.site')}</label>
          <select
            value={rhSite}
            onChange={(e) => {
              const site = e.target.value === 'intl' ? 'intl' : 'cn';
              activeRhSiteRef.current = site;
              update({ rhSite: site, appInfo: null, paramValues: {}, taskId: '', urls: [] });
            }}
            className="nodrag nowheel w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            title={t('runningHub.siteHint')}
          >
            <option value="cn">{t('runningHub.siteCn')}</option>
            <option value="intl">{t('runningHub.siteIntl')}</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-white/50 block mb-1">Webapp ID</label>
          <div className="flex gap-1">
            <input
              type="text"
              value={webappId}
              onChange={(e) => update({
                webappId: e.target.value,
                appInfo: null,
                paramValues: {},
                taskId: '',
                urls: [],
              })}
              placeholder="1234567890"
              className="flex-1 rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/30"
            />
            <button
              onClick={handleFetchInfo}
              disabled={fetchingInfo}
              title={t('runningHub.fetchInfo')}
              className="px-2 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 disabled:opacity-50"
            >
              {fetchingInfo ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
            </button>
          </div>
        </div>

        {/* 参数表单：拉取 nodeInfoList 后逐条展开 */}
        {/* nowheel: 阻止 xyflow 把滚轮事件接管成画布缩放，让节点内列表可滚动；nodrag: 鼠标按下不触发节点拖动 */}
        {nodeInfoList.length > 0 && (
          <div
            className={`nowheel nodrag rounded border ${accent.subBg} p-2 space-y-2 max-h-[420px] overflow-auto overscroll-contain`}
            onWheelCapture={(e) => e.stopPropagation()}
          >
            <div className={`text-[10px] ${accent.sub} flex items-center justify-between`}>
              <span>参数 ({nodeInfoList.length})</span>
              <span className="text-white/30">{t('runningHub.editable')}</span>
            </div>
            {nodeInfoList.map((it: any, i: number) => {
              const vt = inferValueType(it?.fieldType);
              const k = paramKey(it.nodeId, it.fieldName);
              const cur = paramValues[k] || { value: extractDefaultValue(it) };
              const isMedia = vt === 'image' || vt === 'video' || vt === 'audio';
              const fieldDataOptions = extractFieldOptions(it);
              return (
                <div key={i} className="space-y-1 pb-2 border-b border-white/5 last:border-0 last:pb-0">
                  <div className="flex items-center gap-1 text-[10px] leading-tight">
                    <span className="text-white/80 font-medium truncate">{it.fieldName}</span>
                    <span className="text-white/20">|</span>
                    <span className="text-cyan-300/60 px-1 rounded bg-cyan-500/10">
                      {fieldDataOptions ? `select(${fieldDataOptions.length})` : vt}
                    </span>
                    <span className="text-white/20">|</span>
                    <span className="text-white/30">#{it.nodeId}</span>
                  </div>
                  {it?.description && (
                    <div className="text-[9px] text-white/40 leading-tight">{it.description}</div>
                  )}
                  {isMedia ? (
                    <>
                      <div className="flex items-center justify-between text-[10px]">
                        <label className="flex items-center gap-1 text-cyan-200/80 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!cur.sourceFromUpstream}
                            onChange={(e) => setParam(k, { sourceFromUpstream: e.target.checked })}
                            className="accent-cyan-400"
                          />
                          {t('runningHub.upstreamAuto')}
                        </label>
                        {cur.sourceFromUpstream && (
                          <button
                            onClick={() => {
                              const u = findUpstreamUrl(vt, fieldKindIndex[k] ?? 0);
                              if (u) setParam(k, { value: u });
                            }}
                            className="flex items-center gap-1 text-cyan-200/80 hover:text-cyan-100"
                            title={t('runningHub.resyncUrl')}
                          >
                            <RefreshCw size={9} /> {t('runningHub.sync')}
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={cur.value}
                        onChange={(e) => setParam(k, { value: e.target.value })}
                        placeholder={cur.sourceFromUpstream ? '(从上游自动填入)' : `${vt} url 或 fileName`}
                        readOnly={!!cur.sourceFromUpstream}
                        className={`w-full rounded border px-2 py-1 text-[11px] text-white outline-none placeholder:text-white/30 ${
                          cur.sourceFromUpstream
                            ? 'bg-cyan-500/10 border-cyan-500/30 cursor-not-allowed'
                            : 'bg-white/5 border-white/10 focus:border-white/30'
                        }`}
                      />
                      {/* 字段内联预览已迁到顶部 MaterialPreviewSection 统一展示（与 Image/Video/Audio 节点样式一致，支持多图 + 拖拽排序），
                          这里不再重复渲染缩略图，仅保留输入框 + 从上游勾选按钮，避免与顶部预览区重复。 */}
                    </>
                  ) : fieldDataOptions ? (
                    <select
                      value={cur.value}
                      onChange={(e) => setParam(k, { value: e.target.value })}
                      className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30"
                    >
                      {/* 当前值不在 options 里（用户手填/定制值）→ 保留一个“(当前) value”项避免丢失选中 */}
                      {cur.value && !fieldDataOptions.some((o) => String(o) === String(cur.value)) && (
                        <option value={String(cur.value)}>(当前) {String(cur.value)}</option>
                      )}
                      {!cur.value && <option value="">{t('runningHub.choose')}</option>}
                      {fieldDataOptions.map((opt, oi) => (
                        <option key={oi} value={String(opt)}>{String(opt)}</option>
                      ))}
                    </select>
                  ) : vt === 'number' ? (
                    <input
                      type="number"
                      value={cur.value}
                      onChange={(e) => setParam(k, { value: e.target.value })}
                      placeholder={extractDefaultValue(it)}
                      className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
                    />
                  ) : (
                    (() => {
                      const selectedTextMaterial = findMaterialById(orderedTexts, cur.sourceMaterialId);
                      const autoTextMatch = findRhTextMaterialForField(it, orderedTexts);
                      const linkedTextMaterial = selectedTextMaterial || (autoTextMatch.status === 'matched' ? autoTextMatch.material || null : null);
                      const isLinked = !!cur.sourceFromUpstream && !!linkedTextMaterial;
                      const bindHint =
                        autoTextMatch.status === 'conflict'
                          ? `多个上游文本都填写了 RH#${normalizeRhNodeId(it.nodeId)}，请改成唯一 RH# 或手动选择。`
                          : autoTextMatch.status === 'no-match'
                            ? `给文本节点填写 RH#${normalizeRhNodeId(it.nodeId)} 后可自动绑定。`
                            : isLinked
                              ? `已绑定 ${linkedTextMaterial?.rhNodeId ? `RH#${linkedTextMaterial.rhNodeId}` : '手动选择的文本'}`
                              : '可按文本节点 RH# 自动绑定，也可手动选择上游文本。';
                      return (
                        <>
                          {orderedTexts.length > 0 && (
                            <div className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 space-y-1">
                              <div className="flex items-center justify-between gap-2 text-[10px]">
                                <label className="flex items-center gap-1 text-cyan-200/80 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!cur.sourceFromUpstream}
                                    onChange={(e) => {
                                      if (!e.target.checked) {
                                        setParam(k, { sourceFromUpstream: false, sourceMaterialId: '', sourceRhNodeId: '' });
                                        return;
                                      }
                                      const fallback = linkedTextMaterial || (orderedTexts.length === 1 ? orderedTexts[0] : null);
                                      if (fallback) {
                                        setParam(k, {
                                          value: fallback.url,
                                          sourceFromUpstream: true,
                                          sourceMaterialId: fallback.id,
                                          sourceRhNodeId: normalizeRhNodeId(fallback.rhNodeId),
                                        });
                                      } else {
                                        setParam(k, { sourceFromUpstream: true });
                                      }
                                    }}
                                    className="accent-cyan-400"
                                  />
                                  {t('runningHub.upstreamText')}
                                </label>
                                {linkedTextMaterial && (
                                  <button
                                    onClick={() => setParam(k, {
                                      value: linkedTextMaterial.url,
                                      sourceFromUpstream: true,
                                      sourceMaterialId: linkedTextMaterial.id,
                                      sourceRhNodeId: normalizeRhNodeId(linkedTextMaterial.rhNodeId),
                                    })}
                                    className="flex items-center gap-1 text-cyan-200/80 hover:text-cyan-100"
                                    title={t('runningHub.resyncText')}
                                  >
                                    <RefreshCw size={9} /> {t('runningHub.sync')}
                                  </button>
                                )}
                              </div>
                              <select
                                value={cur.sourceMaterialId || ''}
                                onChange={(e) => {
                                  const material = findMaterialById(orderedTexts, e.target.value);
                                  if (!material) {
                                    setParam(k, { sourceMaterialId: '', sourceRhNodeId: '', sourceFromUpstream: true });
                                    return;
                                  }
                                  setParam(k, {
                                    value: material.url,
                                    sourceFromUpstream: true,
                                    sourceMaterialId: material.id,
                                    sourceRhNodeId: normalizeRhNodeId(material.rhNodeId),
                                  });
                                }}
                                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-[10px] text-white outline-none focus:border-white/30"
                              >
                                <option value="">{t('runningHub.autoRh')}</option>
                                {orderedTexts.map((material) => (
                                  <option key={material.id} value={material.id}>
                                    {material.rhNodeId ? `RH#${material.rhNodeId}` : '未填 RH#'} · {material.label || material.url.slice(0, 24)}
                                  </option>
                                ))}
                              </select>
                              <div className="text-[9px] text-white/35 leading-tight">{bindHint}</div>
                            </div>
                          )}
                          {isLinked ? (
                            <PromptTextarea
                              title={`RunningHub 参数 · ${it.fieldName || '文本'} #${it.nodeId || ''}`}
                              value={cur.value}
                              onValueChange={() => undefined}
                              readOnly
                              className="w-full min-h-14 resize-none rounded bg-cyan-500/10 border border-cyan-500/30 px-2 py-1 text-[11px] text-white outline-none cursor-not-allowed"
                            />
                          ) : (
                            <MentionPromptInput
                              title={`RunningHub 参数 · ${it.fieldName || '文本'} #${it.nodeId || ''}`}
                              value={cur.value}
                              mentions={getParamMentions(k)}
                              materials={mentionMaterials}
                              onChange={(value, mentions) => setTextParam(k, value, mentions)}
                              placeholder={extractDefaultValue(it)}
                              isDark={isDark}
                              isPixel={isPixel}
                              promptTemplateKind="image"
                              className="w-full min-h-14 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
                            />
                          )}
                        </>
                      );
                    })()
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div>
          <label className="text-[10px] text-white/50 block mb-1">{t('runningHub.instanceType')}</label>
          <select
            value={instanceType || ''}
            onChange={(e) => update({ instanceType: e.target.value })}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          >
            <option value="" className="bg-zinc-800">{t('runningHub.default')}</option>
            <option value="plus" className="bg-zinc-800">plus</option>
          </select>
        </div>

        <ReuseResultToggle
          checked={d?.reuseResult === true}
          hasResult={hasReusableGenerationResult('runninghub', d)}
          onChange={(checked) => update({ reuseResult: checked })}
          accentColor={useWallet ? '#a78bfa' : '#22d3ee'}
        />

        {!isBusy ? (
          <button
            onClick={() => requestCanvasNodeRun(id)}
            className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded ${accent.primary} text-xs font-medium transition-colors`}
          >
            <Sparkles size={12} /> {useWallet ? t('runningHub.runWallet') : t('runningHub.run')}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-zinc-500/20 hover:bg-zinc-500/30 text-zinc-200 text-xs font-medium transition-colors"
          >
            <Square size={11} /> {cancelling ? t('runningHub.cancelling') : t('runningHub.stop')}
          </button>
        )}

        {isBusy && (
          <div className={`flex items-center gap-1 text-[10px] ${accent.spin}`}>
            <Loader2 size={11} className="animate-spin" />
            {cancelling ? t('runningHub.cancellingTask') : status === 'submitting' ? t('runningHub.submitting') : t('runningHub.polling')}
            {taskId && <span className="ml-auto text-white/30">{String(taskId).slice(0, 10)}…</span>}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
      </div>

      {urls.length > 0 && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2 space-y-1">
          {urls.map((u, i) => {
            if (/\.(mp4|webm|mov)$/i.test(u)) {
              return <LoopingVideo key={i} src={u} controls className="w-full rounded" />;
            }
            if (/\.(mp3|wav|ogg)$/i.test(u)) {
              return <LazyAudio key={i} src={u} controls className="w-full h-8" />;
            }
            return <SmartImage key={i} src={u} alt={`输出 ${i}`} className="w-full rounded object-cover" thumbSize={720} />;
          })}
        </div>
      )}
    </div>
  );
};

export default memo(RunningHubNode);
