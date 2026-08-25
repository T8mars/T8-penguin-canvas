import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CheckCircle2, Clipboard, Download, FileJson, RotateCcw, Save, Sparkles, Upload, XCircle } from 'lucide-react';
import { PORT_COLOR } from '../../config/portTypes';
import { COMFYUI_APP_MANIFEST } from '../../data/comfyuiAppManifest';
import { useThemeStore } from '../../stores/theme';
import {
  COMFY_APP_SOURCE_LABELS,
  COMFY_APP_MANIFEST_EVENT,
  buildComfyAppFromWorkflow,
  getUserComfyAppManifest,
  mergeComfyAppManifests,
  normalizeComfyAppManifest,
  saveComfyApp,
} from '../../utils/comfyuiApps';
import {
  analyzeComfyWorkflow,
  BASIC_COMFY_TEXT_TO_IMAGE_SAMPLE_ID,
  buildComfyWorkflowImportChecklist,
  createComfyFieldExcludeRulesBackup,
  filterComfyFieldsByExcludeRules,
  parseComfyFieldExcludeRules,
  parseComfyFieldExcludeRulesBackup,
  stringifyBasicComfyTextToImageWorkflow,
} from '../../utils/comfyuiWorkflow';
import { useUpdateNodeData } from './useUpdateNodeData';
import NodeVisible from '../../i18n/NodeVisible';
import ResizableCorners from './ResizableCorners';
import PromptTextarea from '../PromptTextarea';

const handleStyle: CSSProperties = {
  width: 12,
  height: 12,
  border: 'none',
  zIndex: 20,
};

function parseWorkflow(raw: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(raw || '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ComfyUIAppMakerNode = ({ id, data, selected }: NodeProps) => {
  const { t } = useTranslation('settings');
  const update = useUpdateNodeData(id);
  const { theme, style } = useThemeStore();
  const isLight = theme === 'light';
  const isPixel = style === 'pixel';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const excludeRulesFileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState('');
  const [libraryManifest, setLibraryManifest] = useState(() => mergeComfyAppManifests(COMFYUI_APP_MANIFEST, getUserComfyAppManifest()));

  const d = (data || {}) as any;
  const size = d.size && typeof d.size.w === 'number' ? d.size : { w: 720, h: 620 };
  const workflowRaw = String(d.comfyMakerWorkflowRaw || '');
  const workflowJson = useMemo(() => parseWorkflow(workflowRaw), [workflowRaw]);
  const analysis = useMemo(() => analyzeComfyWorkflow(workflowJson || null), [workflowJson]);
  const availableOutputNodeIds = useMemo(() => analysis.outputNodes.map((item) => item.nodeId), [analysis.outputNodes]);
  const selectedOutputNodeIds = useMemo(() => {
    if (!Array.isArray(d.comfyMakerOutputNodeIds)) return availableOutputNodeIds;
    const available = new Set(availableOutputNodeIds);
    const selected: string[] = [...new Set<string>(d.comfyMakerOutputNodeIds
      .map((nodeId: unknown) => String(nodeId))
      .filter((nodeId: string) => available.has(nodeId)))];
    return selected.length ? selected : availableOutputNodeIds;
  }, [availableOutputNodeIds, d.comfyMakerOutputNodeIds]);
  const importChecklist = useMemo(() => buildComfyWorkflowImportChecklist(workflowJson || null, analysis), [workflowJson, analysis]);
  const excludeRulesRaw = String(d.comfyMakerExcludeRules || '');
  const excludeRules = useMemo(() => parseComfyFieldExcludeRules(excludeRulesRaw), [excludeRulesRaw]);
  const filteredAnalysisFields = useMemo(
    () => filterComfyFieldsByExcludeRules(workflowJson || null, analysis.fields, excludeRules),
    [workflowJson, analysis.fields, excludeRules],
  );
  const excludedFieldCount = Math.max(0, analysis.fields.length - filteredAnalysisFields.length);
  const hiddenParamKeys: string[] = Array.isArray(d.comfyMakerHiddenParamKeys) ? d.comfyMakerHiddenParamKeys : [];
  const hiddenParamKeySet = useMemo(() => new Set(hiddenParamKeys), [hiddenParamKeys]);
  const categories = useMemo(() => normalizeComfyAppManifest(libraryManifest).categories, [libraryManifest]);
  const rawApp = useMemo(() => (
    workflowJson
      ? buildComfyAppFromWorkflow({
        workflowJson,
        title: d.comfyMakerTitle || 'Anima 文生图',
        id: d.comfyMakerAppId || '',
        categoryId: d.comfyMakerCategoryId || categories[0]?.id || 'general',
        description: d.comfyMakerDescription || '',
        excludeRules,
        outputNodeIds: selectedOutputNodeIds,
      })
      : null
  ), [workflowJson, d.comfyMakerTitle, d.comfyMakerAppId, d.comfyMakerCategoryId, d.comfyMakerDescription, excludeRules, selectedOutputNodeIds, categories]);
  const app = useMemo(() => (
    rawApp
      ? { ...rawApp, userParams: rawApp.userParams.filter((param) => !hiddenParamKeySet.has(param.key)) }
      : null
  ), [rawApp, hiddenParamKeySet]);

  useEffect(() => {
    const refresh = () => setLibraryManifest(mergeComfyAppManifests(COMFYUI_APP_MANIFEST, getUserComfyAppManifest()));
    window.addEventListener(COMFY_APP_MANIFEST_EVENT, refresh);
    return () => window.removeEventListener(COMFY_APP_MANIFEST_EVENT, refresh);
  }, []);

  const bg = isPixel ? 'var(--px-surface)' : isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.96)';
  const text = isPixel ? 'var(--px-ink)' : isLight ? '#0f172a' : '#e5f7fb';
  const sub = isPixel ? 'var(--px-ink-soft)' : isLight ? '#64748b' : 'rgba(229,247,251,0.62)';
  const border = isPixel ? 'var(--px-ink)' : isLight ? 'rgba(14,165,233,0.25)' : 'rgba(103,232,249,0.24)';
  const accent = '#67e8f9';

  const rootStyle: CSSProperties = {
    width: size.w,
    height: size.h,
    minWidth: 520,
    minHeight: 460,
    background: bg,
    color: text,
    border: `2px solid ${selected ? accent : border}`,
    borderRadius: isPixel ? 8 : 14,
    overflow: 'hidden',
    boxShadow: isPixel ? '3px 3px 0 var(--px-ink)' : 'var(--t8-node-shadow, 0 12px 30px rgba(0,0,0,0.28))',
  };
  const inputCls = isPixel
    ? 'px-input nodrag nopan nowheel w-full text-xs px-2 py-1'
    : 'nodrag nopan nowheel w-full rounded border px-2 py-1 text-xs outline-none';
  const inputStyle: CSSProperties = isPixel
    ? {}
    : {
      background: isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.06)',
      borderColor: border,
      color: text,
    };
  const btnCls = isPixel
    ? 'px-btn nodrag nopan nowheel text-[11px] px-2 py-1 inline-flex items-center justify-center gap-1'
    : 'nodrag nopan nowheel rounded border px-2 py-1 text-[11px] inline-flex items-center justify-center gap-1';

  const setRaw = (raw: string) => {
    update({ comfyMakerWorkflowRaw: raw, comfyMakerHiddenParamKeys: [], comfyMakerOutputNodeIds: null });
    setStatus('');
  };

  const applySampleWorkflow = () => {
    update({
      comfyMakerWorkflowRaw: stringifyBasicComfyTextToImageWorkflow(),
      comfyMakerTitle: '基础文生图样例',
      comfyMakerAppId: BASIC_COMFY_TEXT_TO_IMAGE_SAMPLE_ID,
      comfyMakerCategoryId: 'image',
      comfyMakerDescription: '用于学习字段映射和首次连通测试；运行前把 Checkpoint 改成本机已安装的模型文件名。',
      comfyMakerExcludeRules: '',
      comfyMakerHiddenParamKeys: [],
      comfyMakerOutputNodeIds: null,
    });
    setStatus('已载入基础文生图样例。保存到超市后，运行前请把 Checkpoint 改成本机模型文件名。');
  };

  const setExcludeRules = (raw: string) => {
    update({ comfyMakerExcludeRules: raw, comfyMakerHiddenParamKeys: [] });
    setStatus('已更新排除规则，自动识别结果会按规则过滤。');
  };

  const appendExcludeRules = (items: string[]) => {
    setExcludeRules([...excludeRules, ...items].join('\n'));
  };

  const exportExcludeRules = () => {
    const payload = createComfyFieldExcludeRulesBackup(excludeRulesRaw, 'comfyui-app-maker');
    downloadText(`t8-comfyui-exclude-rules-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`, JSON.stringify(payload, null, 2));
    setStatus(`已导出 ${payload.rules.length} 条排除规则。`);
  };

  const importExcludeRulesFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const rules = parseComfyFieldExcludeRulesBackup(String(reader.result || ''));
      setExcludeRules(rules.join('\n'));
      setStatus(`已导入 ${rules.length} 条排除规则，自动识别结果会按规则过滤。`);
    };
    reader.onerror = () => setStatus('读取排除规则 JSON 文件失败。');
    reader.readAsText(file, 'utf-8');
  };

  const hideParam = (key: string) => {
    if (hiddenParamKeySet.has(key)) return;
    update({ comfyMakerHiddenParamKeys: [...hiddenParamKeys, key] });
    setStatus('已从新手参数面板移除，保存到超市时不会包含这个参数。');
  };

  const toggleOutputNode = (nodeId: string) => {
    const selected = new Set(selectedOutputNodeIds);
    if (selected.has(nodeId)) {
      if (selected.size <= 1) {
        setStatus('至少保留一个输出节点；旧应用未配置时仍会收集全部输出。');
        return;
      }
      selected.delete(nodeId);
    } else {
      selected.add(nodeId);
    }
    update({ comfyMakerOutputNodeIds: availableOutputNodeIds.filter((id) => selected.has(id)) });
    setStatus('已更新要收集的 ComfyUI 输出节点。');
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      setRaw(raw);
      if (!d.comfyMakerTitle) {
        update({ comfyMakerTitle: file.name.replace(/\.json$/i, '').slice(0, 80) });
      }
      setStatus('已读取 workflow JSON，下面会显示自动识别结果。');
    };
    reader.onerror = () => setStatus('读取文件失败。');
    reader.readAsText(file, 'utf-8');
  };

  const handleSave = async () => {
    if (!app) {
      setStatus('请先上传或粘贴有效的 ComfyUI API Workflow JSON。');
      return;
    }
    saveComfyApp(app);
    const textJson = JSON.stringify({
      schema: 't8-comfyui-app-manifest',
      version: 1,
      categories: categories.filter((category) => category.id === app.categoryId),
      apps: [app],
    }, null, 2);
    update({ text: textJson, outputText: textJson });
    setStatus('已保存到 ComfyUI超市，添加或刷新超市节点即可使用。');
  };

  const appJson = app ? JSON.stringify({
    schema: 't8-comfyui-app-manifest',
    version: 1,
    categories: categories.filter((category) => category.id === app.categoryId),
    apps: [app],
  }, null, 2) : '';

  return (
    <NodeVisible>
      <div style={rootStyle} className="relative nowheel">
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: border }}>
        <div className="flex h-8 w-8 items-center justify-center rounded border" style={{ borderColor: accent, color: accent }}>
          <FileJson size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-black">ComfyUI应用制作工具</div>
          <div className="truncate text-[11px]" style={{ color: sub }}>
            上传 API Workflow JSON，自动生成可复用应用
          </div>
        </div>
        <button type="button" className={btnCls} style={inputStyle} onClick={() => fileInputRef.current?.click()}>
          <Upload size={12} /> 上传 JSON
        </button>
        <button type="button" className={btnCls} style={inputStyle} onClick={applySampleWorkflow}>
          <Sparkles size={12} /> 载入样例
        </button>
      </div>

      <div className="h-[calc(100%-58px)] overflow-auto p-3 space-y-3 nowheel">
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] font-bold" style={{ color: sub }}>应用名称</span>
            <input
              value={d.comfyMakerTitle || ''}
              onChange={(e) => update({ comfyMakerTitle: e.target.value })}
              className={inputCls}
              style={inputStyle}
              placeholder="例如 Anima 文生图"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold" style={{ color: sub }}>稳定 ID</span>
            <input
              value={d.comfyMakerAppId || ''}
              onChange={(e) => update({ comfyMakerAppId: e.target.value })}
              className={inputCls}
              style={inputStyle}
              placeholder="留空会按名称自动生成"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold" style={{ color: sub }}>分类</span>
            <select
              value={d.comfyMakerCategoryId || categories[0]?.id || 'general'}
              onChange={(e) => update({ comfyMakerCategoryId: e.target.value })}
              className={inputCls}
              style={inputStyle}
            >
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold" style={{ color: sub }}>说明</span>
            <input
              value={d.comfyMakerDescription || ''}
              onChange={(e) => update({ comfyMakerDescription: e.target.value })}
              className={inputCls}
              style={inputStyle}
              placeholder="给自己看的简短说明"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-bold" style={{ color: sub }}>Workflow JSON</span>
          <PromptTextarea
            title="ComfyUI Workflow JSON"
            value={workflowRaw}
            onValueChange={setRaw}
            editorKind="json"
            mono
            className={`${inputCls} min-h-[120px] resize-y font-mono leading-relaxed`}
            style={inputStyle}
            placeholder='粘贴 ComfyUI API Workflow JSON，例如 {"1":{"class_type":"CLIPTextEncode","inputs":{"text":""}}}'
          />
          <span className="block text-[10px]" style={{ color: sub }}>
            需要 ComfyUI 开启 dev mode 后导出的 API workflow，不是普通前端 workflow。
          </span>
        </label>

        <div className="block space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold" style={{ color: sub }}>自动映射排除规则（可选）</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={btnCls}
                style={inputStyle}
                onClick={exportExcludeRules}
                title="导出当前排除规则 JSON"
              >
                <Download size={12} /> 导出规则
              </button>
              <button
                type="button"
                className={btnCls}
                style={inputStyle}
                onClick={() => excludeRulesFileInputRef.current?.click()}
                title="导入排除规则 JSON"
              >
                <Upload size={12} /> 导入规则
              </button>
              <input
                ref={excludeRulesFileInputRef}
                type="file"
                accept="application/json,.json,.txt"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) importExcludeRulesFile(file);
                  event.currentTarget.value = '';
                }}
              />
            </div>
          </div>
          <PromptTextarea
            title="ComfyUI 自动映射排除规则"
            value={excludeRulesRaw}
            onValueChange={setExcludeRules}
            editorKind="lines"
            mono
            className={`${inputCls} min-h-[68px] resize-y font-mono leading-relaxed`}
            style={inputStyle}
            placeholder={'每行一个：seed、steps、class:KSampler、CLIPTextEncode.text、#86.batch_size'}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnCls}
              style={inputStyle}
              onClick={() => appendExcludeRules(['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'])}
            >
              排除采样器参数
            </button>
            <button
              type="button"
              className={btnCls}
              style={inputStyle}
              onClick={() => appendExcludeRules(['model_name', 'ckpt_name', 'clip_name', 'vae_name', 'lora_name'])}
            >
              排除模型加载
            </button>
            <button
              type="button"
              className={btnCls}
              style={inputStyle}
              onClick={() => appendExcludeRules(['width', 'height', 'batch_size'])}
            >
              排除尺寸批量
            </button>
            <span className="text-[10px]" style={{ color: sub }}>
              {excludeRules.length} 条规则 · 已排除 {excludedFieldCount} 个字段
            </span>
          </div>
          <span className="block text-[10px]" style={{ color: sub }}>
            支持 source/字段名/节点类名/节点编号，例如 source:cfg、field:width、class:KSampler、node:86、#86.width。
          </span>
        </div>

        <div className="rounded border p-2" style={{ borderColor: border, background: isLight ? 'rgba(14,165,233,0.06)' : 'rgba(103,232,249,0.08)' }}>
          <div className="flex items-center gap-2">
            {workflowJson ? <CheckCircle2 size={14} color="#22c55e" /> : <XCircle size={14} color="#f87171" />}
            <span className="text-xs font-black">自动识别结果</span>
          </div>
          <div className="mt-1 text-[11px]" style={{ color: sub }}>
            字段 {analysis.fields.length} 个 · 排除后 {filteredAnalysisFields.length} 个 · 图片输入 {analysis.imageInputCount} · 视频输入 {analysis.videoInputCount} · 音频输入 {analysis.audioInputCount} · 输出节点 {analysis.outputCount}
          </div>
          {analysis.outputNodes.length > 0 && (
            <div className="mt-2 space-y-1 rounded border p-2" style={{ borderColor: border }}>
              <div className="text-[10px] font-bold" style={{ color: sub }}>收集这些输出节点（默认全选）</div>
              {analysis.outputNodes.map((outputNode) => (
                <label key={outputNode.nodeId} className="nodrag nopan nowheel flex items-center gap-2 text-[10px]">
                  <input
                    type="checkbox"
                    checked={selectedOutputNodeIds.includes(outputNode.nodeId)}
                    onChange={() => toggleOutputNode(outputNode.nodeId)}
                  />
                  <span className="font-mono" style={{ color: accent }}>#{outputNode.nodeId}</span>
                  <span className="min-w-0 truncate">{outputNode.nodeTitle || outputNode.classType}</span>
                  <span className="ml-auto shrink-0" style={{ color: sub }}>{outputNode.classType}</span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-2 grid grid-cols-1 gap-1">
            {importChecklist.map((item) => (
              <div
                key={item.id}
                className="rounded border px-2 py-1 text-[10px]"
                style={{
                  borderColor: item.level === 'ok' ? 'rgba(34,197,94,0.36)' : item.level === 'warn' ? 'rgba(245,158,11,0.42)' : border,
                  color: item.level === 'ok' ? '#22c55e' : item.level === 'warn' ? '#f59e0b' : sub,
                  background: item.level === 'ok' ? 'rgba(34,197,94,0.08)' : item.level === 'warn' ? 'rgba(245,158,11,0.08)' : 'transparent',
                }}
              >
                <b>{String(t(item.labelKey as any, item.labelParams as any))}</b> · {String(t(item.detailKey as any, item.detailParams as any))}
              </div>
            ))}
          </div>
          {analysis.warnings.slice(0, 3).map((warning, index) => (
            <div key={index} className="mt-1 text-[10px] text-amber-500">
              {String(t(warning.key as any, warning.params as any))}
            </div>
          ))}
        </div>

        {app && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-black">新手参数面板预览</div>
              {hiddenParamKeys.length > 0 && (
                <button
                  type="button"
                  className={btnCls}
                  style={inputStyle}
                  onClick={() => update({ comfyMakerHiddenParamKeys: [] })}
                  title="恢复全部已移除参数"
                >
                  <RotateCcw size={11} /> 恢复 {hiddenParamKeys.length}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {app.userParams.map((param) => (
                <div key={param.key} className="rounded border px-2 py-1" style={{ borderColor: border }}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-[11px] font-bold">{param.label}</div>
                    {(param.nodeId || param.fieldName) && (
                      <span className="shrink-0 font-mono text-[10px]" style={{ color: accent }}>
                        {param.nodeId ? `#${param.nodeId}` : ''}{param.fieldName ? `.${param.fieldName}` : ''}
                      </span>
                    )}
                    <button
                      type="button"
                      className="nodrag nopan nowheel inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px]"
                      style={{ borderColor: 'rgba(248,113,113,0.45)', color: '#f87171', background: isLight ? 'rgba(248,113,113,0.08)' : 'rgba(248,113,113,0.12)' }}
                      title="移除此参数"
                      onClick={() => hideParam(param.key)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="truncate text-[10px]" style={{ color: sub }}>
                    {COMFY_APP_SOURCE_LABELS[param.source] || COMFY_APP_SOURCE_LABELS[param.fieldName || ''] || param.fieldName || param.source} · {param.kind}{param.options?.length ? `(${param.options.length}项)` : ''} · 默认 {String(param.defaultValue ?? '空').slice(0, 28)}
                  </div>
                </div>
              ))}
            </div>
            {rawApp && app.userParams.length === 0 && (
              <div className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: border, color: sub }}>
                已移除全部可编辑参数。保存后这个应用仍会按 workflow 固定字段运行。
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnCls} style={inputStyle} onClick={handleSave}>
            <Save size={12} /> 保存到超市
          </button>
          <button
            type="button"
            className={btnCls}
            style={inputStyle}
            disabled={!appJson}
            onClick={() => {
              navigator.clipboard?.writeText(appJson);
              setStatus('已复制应用 JSON。');
            }}
          >
            <Clipboard size={12} /> 复制 JSON
          </button>
          <button
            type="button"
            className={btnCls}
            style={inputStyle}
            disabled={!appJson}
            onClick={() => downloadText(`${app?.id || 'comfyui-app'}.json`, appJson)}
          >
            <Download size={12} /> 导出 JSON
          </button>
        </div>

        {status && <div className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: border, color: sub }}>{status}</div>}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.currentTarget.value = '';
        }}
      />
      <Handle type="source" position={Position.Right} style={{ ...handleStyle, background: PORT_COLOR.text }} />
      <ResizableCorners
        selected={selected}
        minWidth={520}
        minHeight={460}
        accent={accent}
        keepAspectRatio={false}
        onResize={(_, params) => update({ size: { w: Math.round(params.width), h: Math.round(params.height) } })}
        onResizeEnd={(_, params) => update({ size: { w: Math.round(params.width), h: Math.round(params.height) } })}
      />
      </div>
    </NodeVisible>
  );
};

export default memo(ComfyUIAppMakerNode);
