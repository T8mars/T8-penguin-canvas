import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertCircle, ArrowLeft, Boxes, Download, FileText, Film, Loader2, Music, Play, Plus, RefreshCw, Search, Settings, Trash2, Upload, Workflow } from 'lucide-react';
import { COMFYUI_APP_MANIFEST } from '../../data/comfyuiAppManifest';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { requestCanvasNodeRun } from '../../utils/canvasRunRequest';
import { runComfyuiApp } from '../../services/comfyuiApps';
import { useApiKeysStore } from '../../stores/apiKeys';
import { logBus } from '../../stores/logs';
import { taskCompletionSound } from '../../stores/taskCompletionSound';
import { useThemeStore } from '../../stores/theme';
import {
  COMFY_APP_ALL_CATEGORY_ID,
  COMFY_APP_MANIFEST_EVENT,
  comfyAppInputRequirements,
  defaultComfyAppParamValues,
  deleteComfyApp,
  deleteComfyAppCategory,
  filterComfyApps,
  getComfyProviderBaseUrl,
  getUserComfyAppManifest,
  importComfyAppManifest,
  importComfyAppPayload,
  mergeComfyAppManifests,
  moveComfyAppToCategory,
  saveComfyAppCategory,
  type ComfyAppDefinition,
} from '../../utils/comfyuiApps';
import {
  countExcludedMaterials,
  excludeMaterialId,
  filterExcludedMaterials,
  normalizeExcludedMaterialIds,
} from '../../utils/materialExclusion';
import MaterialPreviewSection from './MaterialPreviewSection';
import SmartImage from '../SmartImage';
import LazyAudio from '../LazyAudio';
import LazyVideo from '../LazyVideo';
import PromptTextarea from '../PromptTextarea';
import ResizableCorners from './ResizableCorners';
import { useOrderedMaterials } from './useOrderedMaterials';
import { useUpdateNodeData } from './useUpdateNodeData';
import NodeVisible from '../../i18n/NodeVisible';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';

const handleStyle: CSSProperties = {
  width: 12,
  height: 12,
  border: 'none',
  zIndex: 20,
};

function parseInputValue(kind: string, value: any) {
  if (kind === 'number') {
    if (value === '' || value === null || value === undefined) return '';
    const n = Number(value);
    return Number.isFinite(n) ? n : '';
  }
  if (kind === 'boolean') return value === true;
  return value ?? '';
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ComfyUIStoreNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const { theme, style } = useThemeStore();
  const isLight = theme === 'light';
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const d = (data || {}) as any;
  const [manifest, setManifest] = useState(() => mergeComfyAppManifests(COMFYUI_APP_MANIFEST, getUserComfyAppManifest()));
  const [importStatus, setImportStatus] = useState('');
  const refreshManifest = () => setManifest(mergeComfyAppManifests(COMFYUI_APP_MANIFEST, getUserComfyAppManifest()));

  useEffect(() => {
    window.addEventListener(COMFY_APP_MANIFEST_EVENT, refreshManifest);
    return () => window.removeEventListener(COMFY_APP_MANIFEST_EVENT, refreshManifest);
  }, []);

  const advancedProviders = useApiKeysStore((s) => s.settings.advancedProviders);
  const comfyProviders = useMemo(
    () => (advancedProviders || []).filter((provider) => provider.enabled && provider.protocol === 'comfyui'),
    [advancedProviders],
  );
  const providerId = d.comfyuiStoreProviderId || comfyProviders[0]?.id || '';
  const provider = comfyProviders.find((item) => item.id === providerId) || comfyProviders[0] || null;
  const categoryId = d.comfyuiStoreCategoryId || COMFY_APP_ALL_CATEGORY_ID;
  const query = String(d.comfyuiStoreSearchQuery || '');
  const apps = useMemo(() => filterComfyApps(manifest, { categoryId, query }), [manifest, categoryId, query]);
  const userManifest = useMemo(() => getUserComfyAppManifest(), [manifest]);
  const userAppIds = useMemo(() => new Set(userManifest.apps.map((app) => app.id)), [userManifest]);
  const userCategoryIds = useMemo(() => new Set(userManifest.categories.map((category) => category.id)), [userManifest]);
  const activeAppId = String(d.comfyuiStoreActiveAppId || '');
  const activeApp = activeAppId ? (manifest.apps.find((app) => app.id === activeAppId) || null) : null;
  const paramValues = {
    ...defaultComfyAppParamValues(activeApp),
    ...(d.comfyuiStoreParamValues || {}),
  };
  const status = d.status || 'idle';
  const isBusy = status === 'running' || status === 'submitting';
  const size = d.size && typeof d.size.w === 'number' ? d.size : { w: 400, h: 560 };

  const upstream = useUpstreamMaterials(id);
  const excludedMaterialIds = useMemo(() => normalizeExcludedMaterialIds(d.excludedMaterialIds), [d.excludedMaterialIds]);
  const visibleTexts = useMemo(() => filterExcludedMaterials(upstream.texts, excludedMaterialIds), [upstream.texts, excludedMaterialIds]);
  const visibleImages = useMemo(() => filterExcludedMaterials(upstream.images, excludedMaterialIds), [upstream.images, excludedMaterialIds]);
  const visibleVideos = useMemo(() => filterExcludedMaterials(upstream.videos, excludedMaterialIds), [upstream.videos, excludedMaterialIds]);
  const visibleAudios = useMemo(() => filterExcludedMaterials(upstream.audios, excludedMaterialIds), [upstream.audios, excludedMaterialIds]);
  const excludedCount = useMemo(
    () => countExcludedMaterials(excludedMaterialIds, [...upstream.texts, ...upstream.images, ...upstream.videos, ...upstream.audios]),
    [excludedMaterialIds, upstream.texts, upstream.images, upstream.videos, upstream.audios],
  );
  const order: string[] = Array.isArray(d.materialOrder) ? d.materialOrder : [];
  const orderedTexts = useOrderedMaterials(visibleTexts, order);
  const orderedImages = useOrderedMaterials(visibleImages, order);
  const orderedVideos = useOrderedMaterials(visibleVideos, order);
  const orderedAudios = useOrderedMaterials(visibleAudios, order);

  const req = comfyAppInputRequirements(activeApp);
  const missingRequirements = [
    req.images > orderedImages.length ? `图片还缺 ${req.images - orderedImages.length} 张` : '',
    req.videos > orderedVideos.length ? `视频还缺 ${req.videos - orderedVideos.length} 个` : '',
    req.audios > orderedAudios.length ? `音频还缺 ${req.audios - orderedAudios.length} 个` : '',
  ].filter(Boolean);
  const imageUrls: string[] = Array.isArray(d.imageUrls) ? d.imageUrls : (d.imageUrl ? [d.imageUrl] : []);
  const videoUrls: string[] = Array.isArray(d.videoUrls) ? d.videoUrls : (d.videoUrl ? [d.videoUrl] : []);
  const audioUrls: string[] = Array.isArray(d.audioUrls) ? d.audioUrls : (d.audioUrl ? [d.audioUrl] : []);
  const outputText = String(d.outputText || '');
  const outputKinds: string[] = Array.isArray(d.outputKinds) ? d.outputKinds : [];
  const outputSummary = [
    imageUrls.length ? `${imageUrls.length} 图` : '',
    videoUrls.length ? `${videoUrls.length} 视频` : '',
    audioUrls.length ? `${audioUrls.length} 音频` : '',
    outputText.trim() ? '1 文本' : '',
  ].filter(Boolean).join(' / ');
  const multiTypeHandle = 'linear-gradient(135deg, #facc15 0 25%, #fb7185 25% 50%, #a78bfa 50% 75%, #38bdf8 75% 100%)';

  const bg = isPixel ? 'var(--px-surface)' : isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.96)';
  const text = isPixel ? 'var(--px-ink)' : isLight ? '#0f172a' : '#e5f7fb';
  const sub = isPixel ? 'var(--px-ink-soft)' : isLight ? '#64748b' : 'rgba(229,247,251,0.62)';
  const border = isPixel ? 'var(--px-ink)' : isLight ? 'rgba(14,165,233,0.24)' : 'rgba(103,232,249,0.24)';
  const accent = activeApp?.ui?.accent || '#67e8f9';
  const inputCls = isPixel ? 'px-input nodrag nopan nowheel w-full px-2 py-1 text-xs' : 'nodrag nopan nowheel w-full rounded border px-2 py-1 text-xs outline-none';
  const inputStyle: CSSProperties = isPixel ? {} : {
    background: isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.06)',
    borderColor: border,
    color: text,
  };
  const buttonCls = isPixel
    ? 'px-btn nodrag nopan nowheel inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px]'
    : 'nodrag nopan nowheel inline-flex items-center justify-center gap-1 rounded border px-2 py-1 text-[11px]';
  const rootStyle: CSSProperties = {
    width: size.w,
    height: size.h,
    minWidth: 340,
    minHeight: 420,
    background: bg,
    color: text,
    border: `2px solid ${selected ? accent : border}`,
    borderRadius: isPixel ? 8 : 14,
    overflow: 'visible',
    boxShadow: isPixel ? '3px 3px 0 var(--px-ink)' : 'var(--t8-node-shadow, 0 12px 30px rgba(0,0,0,0.28))',
  };

  const setOrder = (next: string[]) => update({ materialOrder: next });
  const excludeMaterial = (m: Material) => {
    if (m.origin !== 'upstream') return;
    update({
      excludedMaterialIds: excludeMaterialId(excludedMaterialIds, m.id),
      materialOrder: order.filter((item) => item !== m.id),
    });
  };
  const setParam = (key: string, value: any) => update({ comfyuiStoreParamValues: { ...paramValues, [key]: value } });
  const selectApp = (app: ComfyAppDefinition) => update({
    comfyuiStoreActiveAppId: app.id,
    comfyuiStoreParamValues: defaultComfyAppParamValues(app),
    status: 'idle',
    error: '',
  });

  const createCategory = () => {
    const name = String(d.comfyuiStoreNewCategoryName || '').trim();
    const rawId = String(d.comfyuiStoreNewCategoryId || '').trim();
    if (!name) {
      setImportStatus('请先填写分类名称。');
      return;
    }
    const next = saveComfyAppCategory({ id: rawId || name, name });
    setManifest(mergeComfyAppManifests(COMFYUI_APP_MANIFEST, next));
    const created = next.categories.find((category) => category.name === name) || next.categories[next.categories.length - 1];
    update({ comfyuiStoreNewCategoryName: '', comfyuiStoreNewCategoryId: '', comfyuiStoreCategoryId: created?.id || COMFY_APP_ALL_CATEGORY_ID, comfyuiStoreManageCategories: true });
    setImportStatus(`已新建分类：${created?.name || name}`);
  };

  const removeCategory = (targetCategoryId: string) => {
    const category = manifest.categories.find((item) => item.id === targetCategoryId);
    if (!category) return;
    if (!userCategoryIds.has(targetCategoryId)) {
      setImportStatus('内置分类不能删除；可以新建自己的分类并把应用移过去。');
      return;
    }
    if (!window.confirm(`删除分类「${category.name}」？其中应用会移动到默认分类。`)) return;
    const next = deleteComfyAppCategory(targetCategoryId);
    setManifest(mergeComfyAppManifests(COMFYUI_APP_MANIFEST, next));
    if (categoryId === targetCategoryId) update({ comfyuiStoreCategoryId: COMFY_APP_ALL_CATEGORY_ID });
    setImportStatus(`已删除分类：${category.name}`);
  };

  const moveAppCategory = (app: ComfyAppDefinition, nextCategoryId: string) => {
    if (!userAppIds.has(app.id)) {
      setImportStatus('内置应用不能直接改分类；请先导出后作为自定义应用导入。');
      return;
    }
    const next = moveComfyAppToCategory(app.id, nextCategoryId);
    setManifest(mergeComfyAppManifests(COMFYUI_APP_MANIFEST, next));
    setImportStatus(`已移动应用「${app.title}」。`);
  };

  const removeApp = (app: ComfyAppDefinition) => {
    if (!userAppIds.has(app.id)) {
      setImportStatus('内置应用不能删除。');
      return;
    }
    if (!window.confirm(`删除 ComfyUI 应用「${app.title}」？`)) return;
    const next = deleteComfyApp(app.id);
    setManifest(mergeComfyAppManifests(COMFYUI_APP_MANIFEST, next));
    if (activeAppId === app.id) update({ comfyuiStoreActiveAppId: '', status: 'idle', error: '' });
    setImportStatus(`已删除应用：${app.title}`);
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = importComfyAppPayload(JSON.parse(String(reader.result || '{}')));
        const next = importComfyAppManifest(imported);
        setManifest(mergeComfyAppManifests(COMFYUI_APP_MANIFEST, next));
        setImportStatus(imported.apps.length ? `已导入 ${imported.apps.length} 个应用、${imported.categories.length} 个分类。` : '没有找到可导入应用。');
      } catch (error: any) {
        setImportStatus(error?.message || '导入失败。');
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleRun = async () => {
    const src = `comfyui-store:${id.slice(0, 6)}`;
    if (!provider) {
      update({ status: 'error', error: '请先在 API 设置里启用 ComfyUI。' });
      throw new Error('请先在 API 设置里启用 ComfyUI。');
    }
    if (!activeApp) {
      update({ status: 'error', error: '请先导入或制作一个 ComfyUI 应用。' });
      throw new Error('请先导入或制作一个 ComfyUI 应用。');
    }
    if (missingRequirements.length) {
      const message = `当前应用需要更多上游素材：${missingRequirements.join('、')}。请连接上传节点或从资源库插入素材后再运行。`;
      update({ status: 'error', error: message });
      throw new Error(message);
    }
    taskCompletionSound.primeAudio();
    update({
      status: 'running',
      error: '',
      imageUrl: '',
      imageUrls: [],
      videoUrl: '',
      videoUrls: [],
      audioUrl: '',
      audioUrls: [],
      outputText: '',
      outputKinds: [],
      primaryKind: '',
      outputSaveErrors: [],
      progress: '提交中',
    });
    logBus.info(`ComfyUI 应用提交: ${activeApp.title} · ${getComfyProviderBaseUrl(provider)}`, src);
    try {
      const result = await runComfyuiApp({
        provider,
        app: activeApp,
        userParams: paramValues,
        inputs: {
          texts: orderedTexts.map((item) => item.url),
          images: orderedImages.map((item) => item.url),
          videos: orderedVideos.map((item) => item.url),
          audios: orderedAudios.map((item) => item.url),
        },
      });
      const firstImage = result.imageUrls[0] || '';
      update({
        status: 'success',
        progress: '100%',
        taskId: result.taskId || '',
        imageUrl: firstImage,
        imageUrls: result.imageUrls,
        videoUrls: result.videoUrls || [],
        audioUrls: result.audioUrls || [],
        outputText: result.text || '',
        outputKinds: result.outputKinds,
        primaryKind: result.primaryKind,
        outputSaveErrors: result.outputSaveErrors || [],
        error: '',
      });
      const summary = [
        result.imageUrls.length ? `${result.imageUrls.length} 图` : '',
        result.videoUrls?.length ? `${result.videoUrls.length} 视频` : '',
        result.audioUrls?.length ? `${result.audioUrls.length} 音频` : '',
        result.text?.trim() ? '1 文本' : '',
      ].filter(Boolean).join(' / ');
      logBus.success(`ComfyUI 应用完成: ${summary || '无输出'}`, src);
      taskCompletionSound.notifyComplete(id, result.primaryKind);
    } catch (error: any) {
      const message = error?.message || 'ComfyUI 应用运行失败';
      update({ status: 'error', error: message, progress: '' });
      logBus.error(message, src);
      throw error;
    }
  };

  useRunTrigger(id, handleRun, String(d.primaryKind || outputKinds[0] || 'image'));

  return (
    <NodeVisible>
      <div className="t8-comfyui-store-node relative flex flex-col nowheel" style={rootStyle}>
      <Handle type="target" position={Position.Left} title="多类型输入：文本 / 图片 / 视频 / 音频" style={{ ...handleStyle, background: multiTypeHandle, left: -6 }} />
      <Handle type="source" position={Position.Right} title="多类型输出：文本 / 图片 / 视频 / 音频" style={{ ...handleStyle, background: multiTypeHandle, right: -6 }} />
      <ResizableCorners
        selected={selected}
        minWidth={340}
        minHeight={420}
        accent={accent}
        keepAspectRatio={false}
        onResize={(_, params) => update({ size: { w: Math.round(params.width), h: Math.round(params.height) } })}
        onResizeEnd={(_, params) => update({ size: { w: Math.round(params.width), h: Math.round(params.height) } })}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ borderRadius: isPixel ? 6 : 12 }}>
        <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: border }}>
          <div className="flex h-8 w-8 items-center justify-center rounded border" style={{ borderColor: accent, color: accent }}>
            <Boxes size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-black">ComfyUI超市</div>
            <div className="truncate text-[11px]" style={{ color: sub }}>
              {activeApp ? activeApp.title : `${manifest.apps.length} 个应用`} · {outputSummary || '本地工作流'}
            </div>
          </div>
          {activeApp && (
            <button type="button" className={buttonCls} style={inputStyle} onClick={() => update({ comfyuiStoreActiveAppId: '' })}>
              <ArrowLeft size={12} /> 列表
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3 nowheel">
        <div className="grid grid-cols-1 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] font-bold" style={{ color: sub }}>ComfyUI 实例</span>
            <select
              value={provider?.id || ''}
              onChange={(e) => update({ comfyuiStoreProviderId: e.target.value })}
              className={inputCls}
              style={inputStyle}
            >
              {comfyProviders.length ? comfyProviders.map((item) => (
                <option key={item.id} value={item.id}>{item.label || item.id} · {getComfyProviderBaseUrl(item)}</option>
              )) : <option value="">未启用 ComfyUI</option>}
            </select>
          </label>
        </div>

        {!activeApp ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 opacity-60" />
                <input
                  value={query}
                  onChange={(e) => update({ comfyuiStoreSearchQuery: e.target.value })}
                  className={`${inputCls} pl-7`}
                  style={inputStyle}
                  placeholder="搜索 ComfyUI 应用"
                />
              </div>
              <button
                type="button"
                className={buttonCls}
                style={inputStyle}
                onClick={() => update({ comfyuiStoreManageCategories: true })}
                title="新建分类"
              >
                <Plus size={12} /> 新建
              </button>
              <button
                type="button"
                className={buttonCls}
                style={inputStyle}
                onClick={() => update({ comfyuiStoreManageCategories: !d.comfyuiStoreManageCategories })}
                title="管理分类"
              >
                <Settings size={12} /> 分类
              </button>
              <label className={buttonCls} style={inputStyle} title="导入 ComfyUI 应用备份">
                <Upload size={12} /> 导入
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportFile(file);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                className={buttonCls}
                style={inputStyle}
                onClick={() => downloadJson(`t8-comfyui-apps-${new Date().toISOString().slice(0, 10)}.json`, getUserComfyAppManifest())}
                title="导出本地自定义应用和分类"
              >
                <Download size={12} /> 导出
              </button>
            </div>
            {d.comfyuiStoreManageCategories && (
              <div className="rounded border p-2 space-y-2" style={{ borderColor: border, background: isLight ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.05)' }}>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={d.comfyuiStoreNewCategoryName || ''}
                    onChange={(e) => update({ comfyuiStoreNewCategoryName: e.target.value })}
                    className={inputCls}
                    style={inputStyle}
                    placeholder="新分类名称"
                  />
                  <input
                    value={d.comfyuiStoreNewCategoryId || ''}
                    onChange={(e) => update({ comfyuiStoreNewCategoryId: e.target.value })}
                    className={inputCls}
                    style={inputStyle}
                    placeholder="稳定 ID，可留空"
                  />
                </div>
                <button type="button" className={buttonCls} style={{ ...inputStyle, borderColor: accent, color: accent }} onClick={createCategory}>
                  <Plus size={12} /> 新建分类
                </button>
                <div className="grid grid-cols-2 gap-1.5">
                  {manifest.categories.map((category) => (
                    <div key={category.id} className="flex items-center gap-1 rounded border px-2 py-1" style={{ borderColor: border }}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-bold">{category.name}</div>
                        <div className="truncate text-[10px]" style={{ color: sub }}>
                          {manifest.apps.filter((app) => app.categoryId === category.id).length} 个应用
                          {!userCategoryIds.has(category.id) ? ' · 内置' : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="nodrag nopan nowheel inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border"
                        style={{ borderColor: 'rgba(248,113,113,0.45)', color: userCategoryIds.has(category.id) ? '#f87171' : sub, opacity: userCategoryIds.has(category.id) ? 1 : 0.55 }}
                        title={userCategoryIds.has(category.id) ? '删除分类' : '内置分类不能删除'}
                        onClick={() => removeCategory(category.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={buttonCls}
                style={inputStyle}
                onClick={() => update({ comfyuiStoreCategoryId: COMFY_APP_ALL_CATEGORY_ID })}
              >
                全部 {manifest.apps.length}
              </button>
              {manifest.categories.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  className={buttonCls}
                  style={categoryId === category.id ? { ...inputStyle, borderColor: accent, color: accent } : inputStyle}
                  onClick={() => update({ comfyuiStoreCategoryId: category.id })}
                >
                  {category.name}
                </button>
              ))}
            </div>
            {apps.length ? (
              <div className="space-y-1.5">
                {apps.map((app) => (
                  <div
                    key={app.id}
                    role="button"
                    tabIndex={0}
                    className="nodrag nopan nowheel w-full cursor-pointer rounded border p-2 text-left"
                    style={{ borderColor: border, background: isLight ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.05)', color: text }}
                    onClick={() => selectApp(app)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectApp(app);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Workflow size={14} style={{ color: app.ui?.accent || accent }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-black">{app.title}</div>
                        <div className="truncate text-[10px]" style={{ color: sub }}>{app.description || `${app.fields.length} 个字段`}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <select
                        value={app.categoryId}
                        className={`${inputCls} flex-1`}
                        style={inputStyle}
                        title="设置应用分类"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          moveAppCategory(app, event.target.value);
                        }}
                        disabled={!userAppIds.has(app.id)}
                      >
                        {manifest.categories.map((category) => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={buttonCls}
                        style={{ ...inputStyle, borderColor: 'rgba(248,113,113,0.45)', color: userAppIds.has(app.id) ? '#f87171' : sub, opacity: userAppIds.has(app.id) ? 1 : 0.55 }}
                        title={userAppIds.has(app.id) ? '删除应用' : '内置应用不能删除'}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeApp(app);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border p-3 text-[11px]" style={{ borderColor: border, color: sub }}>
                还没有 ComfyUI 应用。先添加「ComfyUI应用制作工具」节点，上传 workflow JSON 后保存到超市；也可以直接导入应用 JSON。
              </div>
            )}
            {importStatus && <div className="text-[11px]" style={{ color: sub }}>{importStatus}</div>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border p-2" style={{ borderColor: border, background: isLight ? 'rgba(14,165,233,0.06)' : 'rgba(103,232,249,0.08)' }}>
              <div className="text-xs font-black">{activeApp.title}</div>
              <div className="mt-1 text-[10px]" style={{ color: sub }}>
                需要：图片 {req.images} / 视频 {req.videos} / 音频 {req.audios} · 字段 {activeApp.fields.length}
              </div>
              {missingRequirements.length > 0 && (
                <div className="mt-2 rounded border px-2 py-1 text-[10px] text-amber-500" style={{ borderColor: 'rgba(245,158,11,0.45)' }}>
                  当前还缺：{missingRequirements.join('、')}。把素材节点连到左侧输入口即可。
                </div>
              )}
              <div className="mt-2 flex items-center gap-1.5">
                <select
                  value={activeApp.categoryId}
                  className={`${inputCls} flex-1`}
                  style={inputStyle}
                  title="设置应用分类"
                  disabled={!userAppIds.has(activeApp.id)}
                  onChange={(event) => moveAppCategory(activeApp, event.target.value)}
                >
                  {manifest.categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className={buttonCls}
                  style={{ ...inputStyle, borderColor: 'rgba(248,113,113,0.45)', color: userAppIds.has(activeApp.id) ? '#f87171' : sub, opacity: userAppIds.has(activeApp.id) ? 1 : 0.55 }}
                  title={userAppIds.has(activeApp.id) ? '删除应用' : '内置应用不能删除'}
                  onClick={() => removeApp(activeApp)}
                >
                  <Trash2 size={12} /> 删除
                </button>
              </div>
            </div>

            <MaterialPreviewSection
              texts={orderedTexts}
              images={orderedImages}
              videos={orderedVideos}
              audios={orderedAudios}
              order={order}
              onReorder={setOrder}
              onExcludeUpstream={excludeMaterial}
              excludedCount={excludedCount}
              onRestoreExcluded={() => update({ excludedMaterialIds: [] })}
              selected={!!selected}
              isDark={isDark}
              isPixel={isPixel}
              groups={['text', 'image', 'video', 'audio']}
              title="上游素材 · 可拖拽调整顺序"
            />

            <div className="space-y-2">
              <div className="text-xs font-black">参数</div>
              {activeApp.userParams.map((param) => (
                <label key={param.key} className="block space-y-1">
                  <span className="flex items-center justify-between gap-2 text-[11px] font-bold" style={{ color: sub }}>
                    <span className="min-w-0 truncate">{param.label}</span>
                    {(param.nodeId || param.fieldName) && (
                      <span className="shrink-0 font-mono text-[10px]" style={{ color: accent }}>
                        {param.nodeId ? `#${param.nodeId}` : ''}{param.fieldName ? `.${param.fieldName}` : ''}
                      </span>
                    )}
                  </span>
                  {param.kind === 'textarea' ? (
                    <PromptTextarea
                      title={`ComfyUI 参数 · ${param.label}`}
                      value={String(paramValues[param.key] ?? '')}
                      onValueChange={(value) => setParam(param.key, value)}
                      rows={param.rows || 4}
                      promptTemplateKind="image"
                      className={`${inputCls} resize-y`}
                      style={inputStyle}
                      placeholder={param.placeholder}
                    />
                  ) : param.kind === 'boolean' ? (
                    <input
                      type="checkbox"
                      className="nodrag nopan nowheel"
                      checked={!!paramValues[param.key]}
                      onChange={(e) => setParam(param.key, e.target.checked)}
                    />
                  ) : param.kind === 'select' && param.options?.length ? (
                    <select
                      value={String(paramValues[param.key] ?? param.defaultValue ?? param.options[0] ?? '')}
                      onChange={(e) => setParam(param.key, e.target.value)}
                      className={inputCls}
                      style={inputStyle}
                    >
                      {param.options.map((option) => (
                        <option key={String(option)} value={String(option)}>
                          {String(option)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type={param.kind === 'number' ? 'number' : 'text'}
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        value={parseInputValue(param.kind, paramValues[param.key])}
                        onChange={(e) => setParam(param.key, e.target.value)}
                        className={`${inputCls} min-w-0 flex-1`}
                        style={inputStyle}
                        placeholder={param.placeholder}
                      />
                      {param.kind === 'number' && /^(?:seed|noise_seed)(?:__.*)?$/i.test(String(param.fieldName || param.source || '')) && (
                        <button
                          type="button"
                          className={`${buttonCls} shrink-0 px-2`}
                          style={inputStyle}
                          title={paramValues[param.key] === '' || paramValues[param.key] === null || paramValues[param.key] === undefined
                            ? '当前为每次运行随机 Seed；点击生成固定 Seed'
                            : '切换为每次运行随机 Seed'}
                          onClick={() => {
                            const randomMode = paramValues[param.key] === '' || paramValues[param.key] === null || paramValues[param.key] === undefined;
                            setParam(param.key, randomMode ? Math.floor(Math.random() * 2147483647) : '');
                          }}
                        >
                          🎲 {paramValues[param.key] === '' || paramValues[param.key] === null || paramValues[param.key] === undefined ? '随机' : '固定'}
                        </button>
                      )}
                    </div>
                  )}
                </label>
              ))}
            </div>

            <button type="button" className={`${buttonCls} w-full py-2 text-sm font-black`} style={{ ...inputStyle, borderColor: accent, color: accent }} disabled={isBusy} onClick={() => requestCanvasNodeRun(id)}>
              {isBusy ? <><Loader2 size={14} className="animate-spin" /> 运行中...</> : <><Play size={14} /> 运行 ComfyUI</>}
            </button>

            {d.error && (
              <div className="flex gap-1 rounded border px-2 py-1 text-[11px] text-red-400" style={{ borderColor: 'rgba(248,113,113,0.45)' }}>
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span className="break-all">{d.error}</span>
              </div>
            )}
            {imageUrls.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">
                {imageUrls.slice(0, 4).map((url, index) => (
                  <SmartImage key={`${url}-${index}`} src={url} alt="ComfyUI 输出" className="w-full rounded object-contain" thumbSize={420} />
                ))}
              </div>
            )}
            {Array.isArray(d.outputSaveErrors) && d.outputSaveErrors.length > 0 && status === 'success' && (
              <div className="flex gap-1 rounded border px-2 py-1 text-[11px] text-amber-500" style={{ borderColor: 'rgba(245,158,11,0.45)' }}>
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span className="break-all">部分输出未能保存到 T8 本地：{d.outputSaveErrors[0]?.error || '下载失败'}</span>
              </div>
            )}
            {videoUrls.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] font-bold" style={{ color: sub }}><Film size={12} /> 视频 ({videoUrls.length})</div>
                {videoUrls.slice(0, 3).map((url, index) => (
                  <LazyVideo key={`${url}-${index}`} src={url} controls preload="metadata" className="nodrag nopan nowheel w-full rounded border" style={{ borderColor: border, maxHeight: 180 }} />
                ))}
              </div>
            )}
            {audioUrls.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] font-bold" style={{ color: sub }}><Music size={12} /> 音频 ({audioUrls.length})</div>
                {audioUrls.slice(0, 4).map((url, index) => (
                  <LazyAudio key={`${url}-${index}`} src={url} controls preload="metadata" className="nodrag nopan nowheel w-full" />
                ))}
              </div>
            )}
            {outputText && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-bold" style={{ color: sub }}><FileText size={12} /> 文本</div>
                <pre className="max-h-24 overflow-auto rounded border p-2 text-[10px] whitespace-pre-wrap" style={{ borderColor: border }}>{outputText}</pre>
              </div>
            )}
            <button type="button" className={buttonCls} style={inputStyle} onClick={() => setManifest(mergeComfyAppManifests(COMFYUI_APP_MANIFEST, getUserComfyAppManifest()))}>
              <RefreshCw size={12} /> 刷新应用
            </button>
          </div>
        )}
        </div>
      </div>
      </div>
    </NodeVisible>
  );
};

export default memo(ComfyUIStoreNode);
