import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { localizeApiError } from '../i18n/apiErrors';
import { ChevronDown, ChevronRight, CloudUpload, Download, ExternalLink, Eye, EyeOff, FileUp, Info, KeyRound, Loader2, Lock, Plus, Save, Settings2, TestTube2, Trash2, X, FolderOpen, ServerCog, Volume2 } from 'lucide-react';
import { useApiKeysStore, FIXED_ZHENZHEN_BASE, FIXED_ZHENZHEN_SD2_BASE, RH_BASE, RH_INTL_BASE } from '../stores/apiKeys';
import { taskCompletionSound as taskCompletionSoundController } from '../stores/taskCompletionSound';
import { useThemeStore } from '../stores/theme';
import type { AdvancedProviderConfig, AdvancedProviderProtocol, ApiSettings, CloudUploadProvider, CloudUploadTargetConfig } from '../types/canvas';
import { getRawSettings, resetTaskCompletionSound, testAdvancedProvider, testCloudUploadTarget, uploadTaskCompletionSound } from '../services/api';
import { playTaskCompletionSound } from '../utils/taskCompletionSound';
import { UI_FONT_PRESETS, resolveUiFontStack } from '../utils/uiFont';
import {
  advancedProviderSummary as summarizeAdvancedProviderForm,
  normalizeModelscopeLoraStrength,
  normalizeModelscopeLoras,
  parseAdvancedProviderModelText,
  stringifyAdvancedProviderModels,
} from '../utils/advancedProviders';
import {
  JIMENG_CLI_INSTALL_UPDATE_COMMAND,
  JIMENG_CLI_SUPPORTED_VERSION,
} from '../config/jimengCli';
import {
  COMFY_FIELD_SOURCE_OPTIONS,
  BASIC_COMFY_TEXT_TO_IMAGE_SAMPLE_ID,
  analyzeComfyWorkflow,
  buildComfyWorkflowImportChecklist,
  canonicalizeComfyFieldsByWorkflow,
  createComfyFieldExcludeRulesBackup,
  filterComfyFieldsByExcludeRules,
  parseComfyFieldExcludeRules,
  parseComfyFieldExcludeRulesBackup,
  stringifyBasicComfyTextToImageWorkflow,
  type ComfyFieldMapping,
} from '../utils/comfyuiWorkflow';
import PromptTextarea from './PromptTextarea';
import { LocalSettingsAddonSlot } from 'virtual:t8-local-extensions';

interface ApiSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

// 主 Key 字段名类型
type KeyField =
  | 'zhenzhenApiKey'
  | 'zhenzhenSd2ApiKey'
  | 'rhApiKey'
  | 'rhIntlApiKey'
  | 'llmApiKey'
  | 'gptImageApiKey'
  | 'nanoBananaApiKey'
  | 'mjApiKey'
  | 'veoApiKey'
  | 'soraApiKey'
  | 'grokApiKey'
  | 'seedanceApiKey'
  | 'sunoApiKey';

interface KeySpec {
  field: KeyField;
  labelKey: string;
  descKey: string;
  bullet: string; // tailwind bg color class
}

const COMMON_KEYS: KeySpec[] = [
  { field: 'zhenzhenApiKey', labelKey: 'keys.zhenzhen.label', descKey: 'keys.zhenzhen.description', bullet: 'bg-amber-400' },
  { field: 'zhenzhenSd2ApiKey', labelKey: 'keys.zhenzhenBudget.label', descKey: 'keys.zhenzhenBudget.description', bullet: 'bg-lime-400' },
  { field: 'rhApiKey', labelKey: 'keys.rhCn.label', descKey: 'keys.rhCn.description', bullet: 'bg-cyan-400' },
  { field: 'rhIntlApiKey', labelKey: 'keys.rhIntl.label', descKey: 'keys.rhIntl.description', bullet: 'bg-blue-400' },
  { field: 'llmApiKey', labelKey: 'keys.llm.label', descKey: 'keys.llm.description', bullet: 'bg-emerald-400' },
];

const CLASSIFIED_KEYS: KeySpec[] = [
  { field: 'gptImageApiKey', labelKey: 'keys.gptImage.label', descKey: 'keys.gptImage.description', bullet: 'bg-pink-400' },
  { field: 'nanoBananaApiKey', labelKey: 'keys.nanoBanana.label', descKey: 'keys.nanoBanana.description', bullet: 'bg-yellow-400' },
  { field: 'mjApiKey', labelKey: 'keys.midjourney.label', descKey: 'keys.midjourney.description', bullet: 'bg-purple-400' },
  { field: 'veoApiKey', labelKey: 'keys.veo.label', descKey: 'keys.veo.description', bullet: 'bg-blue-400' },
  { field: 'soraApiKey', labelKey: 'keys.sora.label', descKey: 'keys.sora.description', bullet: 'bg-sky-400' },
  { field: 'grokApiKey', labelKey: 'keys.grok.label', descKey: 'keys.grok.description', bullet: 'bg-orange-400' },
  { field: 'seedanceApiKey', labelKey: 'keys.seedance.label', descKey: 'keys.seedance.description', bullet: 'bg-teal-400' },
  { field: 'sunoApiKey', labelKey: 'keys.suno.label', descKey: 'keys.suno.description', bullet: 'bg-rose-400' },
];

const ALL_FIELDS: KeyField[] = [
  ...COMMON_KEYS.map((k) => k.field),
  ...CLASSIFIED_KEYS.map((k) => k.field),
];

const PATH_FIELDS = [
  'fileSavePath',
  'canvasAutoSavePath',
  'resourceLibraryPath',
  'themeTemplatePath',
  'eagleApiBase',
] as const;

const SETTINGS_BACKUP_SCHEMA = 't8-penguin-canvas-settings';
const SETTINGS_BACKUP_VERSION = 1;

const ADVANCED_PROVIDER_GUIDES: Record<AdvancedProviderProtocol, {
  nodeScopes: Array<'image' | 'video' | 'llm' | 'sd20'>;
  baseUrlPlaceholder?: string;
  keyLabelKey?: string;
}> = {
  'openai-compatible': {
    nodeScopes: ['image', 'video', 'llm'],
    baseUrlPlaceholder: 'https://api.example.com/v1',
    keyLabelKey: 'providers.keyLabels.apiToken',
  },
  modelscope: {
    nodeScopes: ['image', 'llm'],
    baseUrlPlaceholder: 'https://api-inference.modelscope.cn/v1',
    keyLabelKey: 'providers.keyLabels.modelscope',
  },
  volcengine: {
    nodeScopes: ['image', 'video', 'llm'],
    baseUrlPlaceholder: 'https://ark.cn-beijing.volces.com/api/v3',
    keyLabelKey: 'providers.keyLabels.volcengine',
  },
  agnes: {
    nodeScopes: ['image', 'video', 'llm'],
    baseUrlPlaceholder: 'https://apihub.agnes-ai.com/v1',
    keyLabelKey: 'providers.keyLabels.agnes',
  },
  comfyui: {
    nodeScopes: ['image'],
    baseUrlPlaceholder: 'http://127.0.0.1:8188',
  },
  'jimeng-cli': {
    nodeScopes: ['image', 'video', 'sd20'],
  },
};

const MODELSCOPE_TOKEN_URLS = {
  cn: 'https://www.modelscope.cn/my/access/token',
  intl: 'https://www.modelscope.ai/my/access/token',
} as const;

const AGNES_API_KEY_URL = 'https://platform.agnes-ai.com/settings/apiKeys';

function summarizeCloudUploadForm(targets: CloudUploadTargetConfig[]) {
  const normalized = Array.isArray(targets) ? targets : [];
  const configuredCount = normalized.filter((target) => {
    if (target.provider === 'tencent-cos') {
      return !!(target.tencentCos?.bucket && target.tencentCos?.region && (target.tencentCos?.secretId || target.tencentCos?.hasSecretId) && (target.tencentCos?.secretKey || target.tencentCos?.hasSecretKey));
    }
    if (target.provider === 'aliyun-oss') {
      return !!(target.aliyunOss?.bucket && target.aliyunOss?.endpoint && (target.aliyunOss?.accessKeyId || target.aliyunOss?.hasAccessKeyId) && (target.aliyunOss?.accessKeySecret || target.aliyunOss?.hasAccessKeySecret));
    }
    if (target.provider === 'baidu-netdisk') {
      return !!target.baiduNetdisk?.webdavUrl;
    }
    if (target.provider === 'quark-netdisk') {
      return !!target.quarkNetdisk?.webdavUrl;
    }
    return false;
  }).length;
  const defaultTarget = normalized.find((target) => target.isDefault) || normalized.find((target) => target.enabled) || null;
  return {
    totalCount: normalized.length,
    enabledCount: normalized.filter((target) => target.enabled).length,
    configuredCount,
    defaultLabel: defaultTarget?.label || '',
  };
}

function tryParseJsonObject(raw: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface AdvancedProviderFormBlockProps {
  title: string;
  note?: string;
  className: string;
  labelClassName: string;
  hintClassName: string;
  children: ReactNode;
}

function AdvancedProviderFormBlock({
  title,
  note,
  className,
  labelClassName,
  hintClassName,
  children,
}: AdvancedProviderFormBlockProps) {
  return (
    <section className={className}>
      <div className="space-y-1">
        <div className={`text-xs font-black ${labelClassName}`}>{title}</div>
        {note && <p className={`text-[11px] leading-relaxed ${hintClassName}`}>{note}</p>}
      </div>
      {children}
    </section>
  );
}

const emptyMap = (): Record<KeyField, string> => ({
  zhenzhenApiKey: '', zhenzhenSd2ApiKey: '', rhApiKey: '', rhIntlApiKey: '', llmApiKey: '',
  gptImageApiKey: '', nanoBananaApiKey: '', mjApiKey: '', veoApiKey: '',
  soraApiKey: '', grokApiKey: '', seedanceApiKey: '', sunoApiKey: '',
});
const emptyShow = (): Record<KeyField, boolean> => ({
  zhenzhenApiKey: false, zhenzhenSd2ApiKey: false, rhApiKey: false, rhIntlApiKey: false, llmApiKey: false,
  gptImageApiKey: false, nanoBananaApiKey: false, mjApiKey: false, veoApiKey: false,
  soraApiKey: false, grokApiKey: false, seedanceApiKey: false, sunoApiKey: false,
});

function formatCloudError(error: string, data?: any) {
  const parts = [
    error,
    data?.hint,
    data?.providerCode ? `Code: ${data.providerCode}` : '',
    data?.requestId ? `RequestId: ${data.requestId}` : '',
  ].filter(Boolean);
  return parts.join('；');
}

export default function ApiSettingsModal({ open, onClose }: ApiSettingsModalProps) {
  const { t, i18n } = useTranslation('settings');
  const advancedProviderLabel = (protocol: AdvancedProviderProtocol) => t(`providers.${protocol}.label` as any);
  const advancedProviderGuide = (protocol: AdvancedProviderProtocol) => {
    const meta = ADVANCED_PROVIDER_GUIDES[protocol];
    return {
      subtitle: t(`providers.${protocol}.subtitle` as any),
      description: t(`providers.${protocol}.description` as any),
      nodeScopes: meta.nodeScopes.map((scope) => t(`providers.scopes.${scope}` as any)),
      connectionHint: t(`providers.${protocol}.connectionHint` as any),
      modelHint: t(`providers.${protocol}.modelHint` as any),
      baseUrlPlaceholder: meta.baseUrlPlaceholder,
      keyLabel: meta.keyLabelKey ? t(meta.keyLabelKey as any) : t('providers.keyLabels.apiToken'),
    };
  };
  const cloudProviderLabel = (provider: CloudUploadProvider) => t(`cloudProviders.${provider}.label` as any);
  const cloudProviderGuide = (provider: CloudUploadProvider) => ({
    subtitle: t(`cloudProviders.${provider}.subtitle` as any),
    description: t(`cloudProviders.${provider}.description` as any),
    status: t('cloudProviders.supported'),
  });
  const {
    theme,
    style,
    uiFontPreset,
    customUiFont,
    setUiFontPreset,
    setCustomUiFont,
    resetUiFontPreference,
  } = useThemeStore();
  const { settings, loading, error, load, save, loaded } = useApiKeysStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';

  const [inputs, setInputs] = useState<Record<KeyField, string>>(emptyMap());
  const [shows, setShows] = useState<Record<KeyField, boolean>>(emptyShow());
  const [clearedFields, setClearedFields] = useState<Partial<Record<KeyField, boolean>>>({});
  const [saved, setSaved] = useState(false);
  // v1.2.10.2: 文件自动保存路径输入
  const [fileSavePathInput, setFileSavePathInput] = useState<string>('');
  // v1.3.1: 画布自动保存路径输入
  const [canvasAutoSavePathInput, setCanvasAutoSavePathInput] = useState<string>('');
  // v1.3.4: 资源库路径输入
  const [resourceLibraryPathInput, setResourceLibraryPathInput] = useState<string>('');
  // v1.3.6: 主题模板路径输入
  const [themeTemplatePathInput, setThemeTemplatePathInput] = useState<string>('');
  // 本地 Eagle API 地址
  const [eagleApiBaseInput, setEagleApiBaseInput] = useState<string>('');
  // 分类独立 Key 区块折叠状态（新手友好：默认折叠，点击展开）
  const [classifiedOpen, setClassifiedOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedProvidersInput, setAdvancedProvidersInput] = useState<AdvancedProviderConfig[]>([]);
  const [activeAdvancedProviderId, setActiveAdvancedProviderId] = useState<string>('');
  const [advancedSecretShows, setAdvancedSecretShows] = useState<Record<string, boolean>>({});
  const [advancedDirty, setAdvancedDirty] = useState(false);
  const [advancedTestStatus, setAdvancedTestStatus] = useState<Record<string, { loading?: boolean; ok?: boolean; message?: string }>>({});
  const [advancedComfyDrafts, setAdvancedComfyDrafts] = useState<Record<string, { workflowJson?: string; fields?: string; excludeRules?: string }>>({});
  const [cloudUploadOpen, setCloudUploadOpen] = useState(false);
  const [cloudUploadTargetsInput, setCloudUploadTargetsInput] = useState<CloudUploadTargetConfig[]>([]);
  const [activeCloudTargetId, setActiveCloudTargetId] = useState<string>('');
  const [cloudUploadDirty, setCloudUploadDirty] = useState(false);
  const [cloudTestStatus, setCloudTestStatus] = useState<Record<string, { loading?: boolean; ok?: boolean; message?: string }>>({});
  const [backupMessage, setBackupMessage] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);
  const [taskSoundMessage, setTaskSoundMessage] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);
  const [taskSoundBusy, setTaskSoundBusy] = useState(false);
  const [taskSoundTesting, setTaskSoundTesting] = useState(false);
  const [customUiFontDraft, setCustomUiFontDraft] = useState<string>('');
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);
  const taskCompletionSoundFileInputRef = useRef<HTMLInputElement | null>(null);
  // 眼睛预览拉取的明文（仅缓存，不提交）
  const revealedRef = useRef<Partial<Record<KeyField, string>>>({});

  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded, load]);

  // 重置表单(脱敏 Key 不直接填充,留空则保持后端原值)
  useEffect(() => {
    if (open) {
      setInputs(emptyMap());
      setShows(emptyShow());
      setClearedFields({});
      revealedRef.current = {};
      setSaved(false);
      setBackupMessage(null);
      setClassifiedOpen(false);
      setAdvancedOpen(false);
      const providers = Array.isArray((settings as any)?.advancedProviders)
        ? ((settings as any).advancedProviders as AdvancedProviderConfig[])
        : [];
      setAdvancedProvidersInput(providers);
      setActiveAdvancedProviderId(providers[0]?.id || '');
      setAdvancedSecretShows({});
      setAdvancedDirty(false);
      setAdvancedTestStatus({});
      setAdvancedComfyDrafts({});
      setCloudUploadOpen(false);
      const cloudTargets = Array.isArray((settings as any)?.cloudUploadTargets)
        ? ((settings as any).cloudUploadTargets as CloudUploadTargetConfig[])
        : [];
      setCloudUploadTargetsInput(cloudTargets);
      setActiveCloudTargetId(cloudTargets[0]?.id || '');
      setCloudUploadDirty(false);
      setCloudTestStatus({});
      setTaskSoundMessage(null);
      setTaskSoundBusy(false);
      setTaskSoundTesting(false);
      setCustomUiFontDraft(customUiFont);
      // 回填文件自动保存路径(明文字段，不脱敏)
      setFileSavePathInput((settings as any)?.fileSavePath || '');
      setCanvasAutoSavePathInput((settings as any)?.canvasAutoSavePath || '');
      setResourceLibraryPathInput((settings as any)?.resourceLibraryPath || '');
      setThemeTemplatePathInput((settings as any)?.themeTemplatePath || '');
      setEagleApiBaseInput((settings as any)?.eagleApiBase || '');
    }
  }, [customUiFont, open, settings]);

  if (!open) return null;

  const uiFontPreviewSource = uiFontPreset === 'custom' ? customUiFontDraft : (customUiFontDraft || customUiFont);
  const activeUiFontStack = resolveUiFontStack(uiFontPreset, uiFontPreviewSource) || 'var(--t8-font-family)';
  const commitCustomUiFont = () => {
    if (!customUiFontDraft.trim() && uiFontPreset !== 'custom') return;
    setCustomUiFont(customUiFontDraft);
  };

  const setInputAt = (f: KeyField, v: string) => {
    setInputs((prev) => ({ ...prev, [f]: v }));
    if (v.trim()) {
      setClearedFields((prev) => {
        if (!prev[f]) return prev;
        const next = { ...prev };
        delete next[f];
        return next;
      });
    }
  };

  const getCurrentEditableSettings = (): Partial<ApiSettings> => ({
    zhenzhenApiKey: inputs.zhenzhenApiKey.trim(),
    zhenzhenSd2ApiKey: inputs.zhenzhenSd2ApiKey.trim(),
    rhApiKey: inputs.rhApiKey.trim(),
    llmApiKey: inputs.llmApiKey.trim(),
    gptImageApiKey: inputs.gptImageApiKey.trim(),
    nanoBananaApiKey: inputs.nanoBananaApiKey.trim(),
    mjApiKey: inputs.mjApiKey.trim(),
    veoApiKey: inputs.veoApiKey.trim(),
    soraApiKey: inputs.soraApiKey.trim(),
    grokApiKey: inputs.grokApiKey.trim(),
    seedanceApiKey: inputs.seedanceApiKey.trim(),
    sunoApiKey: inputs.sunoApiKey.trim(),
    fileSavePath: fileSavePathInput.trim(),
    canvasAutoSavePath: canvasAutoSavePathInput.trim(),
    resourceLibraryPath: resourceLibraryPathInput.trim(),
    themeTemplatePath: themeTemplatePathInput.trim(),
    eagleApiBase: eagleApiBaseInput.trim(),
    ...(advancedDirty ? { advancedProviders: advancedProvidersInput } : {}),
    ...(cloudUploadDirty ? { cloudUploadTargets: cloudUploadTargetsInput } : {}),
  });

  const isMaskedKeyValue = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    return /^\*{2,}/.test(value.trim());
  };

  const normalizeImportedSettings = (raw: unknown): Partial<ApiSettings> => {
    const source = raw && typeof raw === 'object' && 'settings' in raw
      ? (raw as any).settings
      : raw;
    if (!source || typeof source !== 'object') {
      throw new Error(t('backup.invalidFormat'));
    }
    const next: Partial<ApiSettings> = {};
    for (const field of ALL_FIELDS) {
      const value = (source as any)[field];
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed || isMaskedKeyValue(trimmed)) continue;
      (next as any)[field] = trimmed;
    }
    for (const field of PATH_FIELDS) {
      const value = (source as any)[field];
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      (next as any)[field] = trimmed;
    }
    if ((source as any).preferences && typeof (source as any).preferences === 'object') {
      next.preferences = { ...(source as any).preferences };
    }
    if (Array.isArray((source as any).advancedProviders)) {
      next.advancedProviders = (source as any).advancedProviders;
    }
    if (Array.isArray((source as any).cloudUploadTargets)) {
      next.cloudUploadTargets = (source as any).cloudUploadTargets;
    }
    return next;
  };

  const downloadJson = (filename: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportSettings = async () => {
    try {
      let raw: ApiSettings | null = null;
      try {
        raw = await getRawSettings();
      } catch {
        raw = null;
      }
      const editable = getCurrentEditableSettings();
      const exportSettings = {
        ...(raw || {}),
        ...Object.fromEntries(
          Object.entries(editable).filter(([, value]) => typeof value === 'string' && value.trim())
        ),
        zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE,
        llmBaseUrl: FIXED_ZHENZHEN_BASE,
        rhBaseUrl: RH_BASE,
        rhIntlBaseUrl: RH_INTL_BASE,
      };
      const payload = {
        schema: SETTINGS_BACKUP_SCHEMA,
        version: SETTINGS_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        containsSecrets: true,
        note: t('backup.secretNote'),
        settings: exportSettings,
      };
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadJson(`t8-settings-backup-${date}.json`, payload);
      setBackupMessage({ text: t('backup.saved'), tone: 'success' });
    } catch (e: any) {
      setBackupMessage({ text: localizeApiError(e, { fallback: t('backup.exportFailed') }), tone: 'error' });
    }
  };

  const applyImportedSettings = (patch: Partial<ApiSettings>) => {
    setInputs((prev) => {
      const nextInputs = { ...prev };
      for (const field of ALL_FIELDS) {
        const value = (patch as any)[field];
        if (typeof value === 'string' && value.trim()) nextInputs[field] = value.trim();
      }
      return nextInputs;
    });
    setShows(emptyShow());
    setClearedFields({});
    revealedRef.current = {};
    if (typeof patch.fileSavePath === 'string') setFileSavePathInput(patch.fileSavePath);
    if (typeof patch.canvasAutoSavePath === 'string') setCanvasAutoSavePathInput(patch.canvasAutoSavePath);
    if (typeof patch.resourceLibraryPath === 'string') setResourceLibraryPathInput(patch.resourceLibraryPath);
    if (typeof patch.themeTemplatePath === 'string') setThemeTemplatePathInput(patch.themeTemplatePath);
    if (typeof patch.eagleApiBase === 'string') setEagleApiBaseInput(patch.eagleApiBase);
    if (Array.isArray(patch.advancedProviders)) {
      setAdvancedProvidersInput(patch.advancedProviders);
      setActiveAdvancedProviderId(patch.advancedProviders[0]?.id || '');
      setAdvancedSecretShows({});
      setAdvancedDirty(true);
      setAdvancedOpen(true);
    }
    if (Array.isArray((patch as any).cloudUploadTargets)) {
      const targets = (patch as any).cloudUploadTargets as CloudUploadTargetConfig[];
      setCloudUploadTargetsInput(targets);
      setActiveCloudTargetId(targets[0]?.id || '');
      setCloudUploadDirty(true);
      setCloudUploadOpen(true);
    }
    setClassifiedOpen(true);
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const patch = normalizeImportedSettings(parsed);
      if (Object.keys(patch).length === 0) {
        setBackupMessage({ text: t('backup.emptyImport'), tone: 'error' });
        return;
      }
      applyImportedSettings(patch);
      setBackupMessage({ text: t('backup.imported'), tone: 'success' });
    } catch (e: any) {
      setBackupMessage({ text: localizeApiError(e, { fallback: t('backup.importFailed') }), tone: 'error' });
    } finally {
      if (backupFileInputRef.current) backupFileInputRef.current.value = '';
    }
  };

  // 眼睛点击: 如果要切为“显示”且当前 input 为空但后端已存在 key,
  // 调 /api/settings/raw 拿明文填充。
  const handleToggleShow = async (f: KeyField) => {
    if (clearedFields[f]) {
      setClearedFields((prev) => {
        const next = { ...prev };
        delete next[f];
        return next;
      });
    }
    const newShow = !shows[f];
    if (newShow && !inputs[f].trim() && (settings as any)[f]) {
      try {
        if (!revealedRef.current || Object.keys(revealedRef.current).length === 0) {
          const raw = await getRawSettings();
          revealedRef.current = raw as any;
        }
      } catch {
        // 忽略拉取失败
      }
      const plain = (revealedRef.current as any)?.[f];
      if (plain) setInputAt(f, String(plain));
    }
    setShows((prev) => ({ ...prev, [f]: newShow }));
  };

  const handleClearClassifiedKey = (f: KeyField) => {
    if (clearedFields[f]) {
      setClearedFields((prev) => {
        const next = { ...prev };
        delete next[f];
        return next;
      });
      return;
    }
    setInputs((prev) => ({ ...prev, [f]: '' }));
    setShows((prev) => ({ ...prev, [f]: false }));
    if (revealedRef.current) {
      delete (revealedRef.current as any)[f];
    }
    const hasSaved = !!String((settings as any)?.[f] || '').trim();
    if (hasSaved) {
      setClearedFields((prev) => ({ ...prev, [f]: true }));
    }
  };

  const handleSave = async () => {
    const patch: Partial<ApiSettings> = {};
    for (const f of ALL_FIELDS) {
      if (clearedFields[f]) {
        (patch as any)[f] = '';
        continue;
      }
      const v = inputs[f].trim();
      if (!v) continue;
      // 眼睛拉出明文未修改 → 跳过，不走一道上行请求
      const revealed = (revealedRef.current as any)?.[f];
      if (revealed && v === String(revealed)) continue;
      (patch as any)[f] = v;
    }
    // v1.2.10.2: 文件自动保存路径变动才上行
    const newPath = (fileSavePathInput || '').trim();
    const oldPath = (settings as any)?.fileSavePath || '';
    if (newPath && newPath !== oldPath) {
      (patch as any).fileSavePath = newPath;
    }
    const newCanvasPath = (canvasAutoSavePathInput || '').trim();
    const oldCanvasPath = (settings as any)?.canvasAutoSavePath || '';
    if (newCanvasPath && newCanvasPath !== oldCanvasPath) {
      (patch as any).canvasAutoSavePath = newCanvasPath;
    }
    const newResourcePath = (resourceLibraryPathInput || '').trim();
    const oldResourcePath = (settings as any)?.resourceLibraryPath || '';
    if (newResourcePath && newResourcePath !== oldResourcePath) {
      (patch as any).resourceLibraryPath = newResourcePath;
    }
    const newThemeTemplatePath = (themeTemplatePathInput || '').trim();
    const oldThemeTemplatePath = (settings as any)?.themeTemplatePath || '';
    if (newThemeTemplatePath && newThemeTemplatePath !== oldThemeTemplatePath) {
      (patch as any).themeTemplatePath = newThemeTemplatePath;
    }
    const newEagleApiBase = (eagleApiBaseInput || '').trim();
    const oldEagleApiBase = (settings as any)?.eagleApiBase || '';
    if (newEagleApiBase && newEagleApiBase !== oldEagleApiBase) {
      (patch as any).eagleApiBase = newEagleApiBase;
    }
    if (advancedDirty) {
      (patch as any).advancedProviders = advancedProvidersInput;
    }
    if (cloudUploadDirty) {
      (patch as any).cloudUploadTargets = cloudUploadTargetsInput;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    await save(patch);
    setClearedFields({});
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  const inputCls = isPixel
    ? 't8-api-settings-input flex-1 px-3 py-2 rounded-[10px] text-sm outline-none px-input'
    : 't8-api-settings-input flex-1 px-3 py-2 rounded-md text-sm outline-none border';

  const labelCls = 't8-api-settings-label';
  const hintCls = 't8-api-settings-hint';
  const eyeBtnCls = isPixel
    ? 't8-api-settings-icon-btn px-btn px-btn--icon px-btn--ghost'
    : 't8-api-settings-icon-btn p-2 rounded-md';

  // 防御性脱敏：始终只显示尾4位（与之前 `****9zVR` 一致），
  // 即使后端意外返回明文也不会暴露完整 Key
  const toMaskedDisplay = (v?: string): string => {
    if (!v) return '';
    const s = String(v);
    // 后端已脱敏（****xxxx 形式）直接原样
    if (/^\*{2,}/.test(s)) return s;
    if (s.length <= 4) return '****';
    return '****' + s.slice(-4);
  };

  // 获取 APIKey 外部链接按钮样式（双主题）
  const linkBtnCls = isPixel
    ? 't8-api-settings-action-btn px-btn px-btn--mint flex items-center gap-1 text-[11px] px-2 py-1'
    : 't8-api-settings-action-btn flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition border';
  const linkBtnAltCls = isPixel
    ? 't8-api-settings-action-btn px-btn flex items-center gap-1 text-[11px] px-2 py-1'
    : 't8-api-settings-action-btn flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition border';

  const openExternal = (url: string) => {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // 志忘
    }
  };

  const isTaskCompletionSoundFile = (file: File): boolean => {
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    return file.type.startsWith('audio/') || ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'].includes(ext);
  };

  const formatTaskCompletionSoundSize = (size?: number): string => {
    const n = Number(size || 0);
    if (!Number.isFinite(n) || n <= 0) return '';
    const formatter = new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, { maximumFractionDigits: 1 });
    if (n >= 1024 * 1024) return `${formatter.format(n / 1024 / 1024)} MB`;
    return `${formatter.format(Math.max(1, Math.round(n / 1024)))} KB`;
  };

  const refreshTaskCompletionSoundSettings = async () => {
    await load();
    await taskCompletionSoundController.refreshSettings();
  };

  const handleTaskCompletionSoundUpload = async (file: File | null) => {
    if (!file) return;
    if (!isTaskCompletionSoundFile(file)) {
      setTaskSoundMessage({ text: t('sound.selectAudio'), tone: 'error' });
      if (taskCompletionSoundFileInputRef.current) taskCompletionSoundFileInputRef.current.value = '';
      return;
    }
    setTaskSoundBusy(true);
    setTaskSoundMessage(null);
    try {
      const result = await uploadTaskCompletionSound(file);
      await refreshTaskCompletionSoundSettings();
      const sizeLabel = formatTaskCompletionSoundSize(result.size || file.size);
      setTaskSoundMessage({ text: t('sound.customApplied', { name: result.name || file.name, size: sizeLabel ? ` · ${sizeLabel}` : '' }), tone: 'success' });
    } catch (e: any) {
      setTaskSoundMessage({ text: localizeApiError(e, { fallback: t('sound.uploadFailed') }), tone: 'error' });
    } finally {
      setTaskSoundBusy(false);
      if (taskCompletionSoundFileInputRef.current) taskCompletionSoundFileInputRef.current.value = '';
    }
  };

  const handleResetTaskCompletionSound = async () => {
    setTaskSoundBusy(true);
    setTaskSoundMessage(null);
    try {
      await resetTaskCompletionSound();
      await refreshTaskCompletionSoundSettings();
      setTaskSoundMessage({ text: t('sound.restored'), tone: 'success' });
    } catch (e: any) {
      setTaskSoundMessage({ text: localizeApiError(e, { fallback: t('sound.restoreFailed') }), tone: 'error' });
    } finally {
      setTaskSoundBusy(false);
    }
  };

  const handlePreviewTaskCompletionSound = async () => {
    setTaskSoundTesting(true);
    setTaskSoundMessage(null);
    try {
      await playTaskCompletionSound((settings as any)?.taskCompletionSound);
    } catch (e: any) {
      setTaskSoundMessage({ text: localizeApiError(e, { fallback: t('sound.testFailed') }), tone: 'error' });
    } finally {
      setTaskSoundTesting(false);
    }
  };

  // 每个字段费应的「获取 APIKey」按钮配置
  const renderGetKeyButtons = (field: KeyField) => {
    if (field === 'zhenzhenApiKey') {
      return (
        <button
          type="button"
          onClick={() => openExternal('https://ai.t8star.org/register?aff=dP7j')}
          className={linkBtnCls}
          title={t('links.zhenzhenTitle')}
        >
          <ExternalLink size={11} /> {t('links.getApiKey')}
        </button>
      );
    }
    if (field === 'zhenzhenSd2ApiKey') {
      return (
        <button
          type="button"
          onClick={() => openExternal('https://api.seedance.nz/sign-up?aff=ibVH')}
          className={linkBtnCls}
          title={t('links.zhenzhenBudgetTitle')}
        >
          <ExternalLink size={11} /> {t('links.getApiKey')}
        </button>
      );
    }
    if (field === 'rhApiKey') {
      return (
        <button
          type="button"
          onClick={() => openExternal('https://www.runninghub.cn/user-center/1819214514410942465/webapp?inviteCode=rh-v1121')}
          className={linkBtnCls}
          title={t('links.rhCnTitle')}
        >
          <ExternalLink size={11} /> {t('links.getRhCn')}
        </button>
      );
    }
    if (field === 'rhIntlApiKey') {
      return (
        <button
          type="button"
          onClick={() => openExternal('https://www.runninghub.ai/user-center/1819214514410942465/webapp?inviteCode=rh-v1121')}
          className={linkBtnAltCls}
          title={t('links.rhIntlTitle')}
        >
          <ExternalLink size={11} /> {t('links.getRhIntl')}
        </button>
      );
    }
    return null;
  };

  const advancedSummary = summarizeAdvancedProviderForm(advancedProvidersInput);
  const activeAdvancedProvider = advancedProvidersInput.find((provider) => provider.id === activeAdvancedProviderId)
    || advancedProvidersInput[0]
    || null;
  const cloudSummary = summarizeCloudUploadForm(cloudUploadTargetsInput);
  const activeCloudTarget = cloudUploadTargetsInput.find((target) => target.id === activeCloudTargetId)
    || cloudUploadTargetsInput[0]
    || null;
  const taskCompletionSoundSettings = (settings as any)?.taskCompletionSound || { mode: 'default', url: '' };
  const hasCustomTaskCompletionSound = taskCompletionSoundSettings.mode === 'custom' && !!taskCompletionSoundSettings.url;
  const taskCompletionSoundSizeLabel = formatTaskCompletionSoundSize(taskCompletionSoundSettings.size);

  const updateAdvancedProvider = (id: string, patch: Partial<AdvancedProviderConfig>) => {
    setAdvancedProvidersInput((prev) => prev.map((provider) => (
      provider.id === id ? { ...provider, ...patch } : provider
    )));
    setAdvancedDirty(true);
  };

  const updateAdvancedProviderNested = (
    id: string,
    key: 'modelscopeConfig' | 'volcengineConfig' | 'comfyuiConfig' | 'jimengConfig',
    patch: Record<string, any>,
  ) => {
    setAdvancedProvidersInput((prev) => prev.map((provider) => (
      provider.id === id
        ? { ...provider, [key]: { ...(provider as any)[key], ...patch } }
        : provider
    )));
    setAdvancedDirty(true);
  };

  const handleTestAdvancedProvider = async (provider: AdvancedProviderConfig) => {
    setAdvancedTestStatus((prev) => ({ ...prev, [provider.id]: { loading: true } }));
    try {
      const result = await testAdvancedProvider({ provider, dryRun: false });
      setAdvancedTestStatus((prev) => ({
        ...prev,
        [provider.id]: {
          ok: result.ok,
          message: result.ok ? (result.message || t('providerForm.connectionAvailable')) : (result.error || t('providerForm.testFailed')),
        },
      }));
    } catch (e: any) {
      setAdvancedTestStatus((prev) => ({
        ...prev,
        [provider.id]: { ok: false, message: e?.message || t('providerForm.testFailed') },
      }));
    }
  };

  const updateCloudTarget = (id: string, patch: Partial<CloudUploadTargetConfig>) => {
    setCloudUploadTargetsInput((prev) => prev.map((target) => (
      target.id === id ? { ...target, ...patch } : target
    )));
    setCloudUploadDirty(true);
  };

  const updateCloudTargetNested = (
    id: string,
    key: 'tencentCos' | 'aliyunOss' | 'baiduNetdisk' | 'quarkNetdisk',
    patch: Record<string, any>,
  ) => {
    setCloudUploadTargetsInput((prev) => prev.map((target) => (
      target.id === id
        ? { ...target, [key]: { ...(target as any)[key], ...patch } }
        : target
    )));
    setCloudUploadDirty(true);
  };

  const markCloudDefault = (id: string) => {
    setCloudUploadTargetsInput((prev) => prev.map((target) => ({ ...target, isDefault: target.id === id })));
    setCloudUploadDirty(true);
  };

  const handleTestCloudTarget = async (target: CloudUploadTargetConfig) => {
    setCloudTestStatus((prev) => ({ ...prev, [target.id]: { loading: true } }));
    try {
      const result = await testCloudUploadTarget({ target });
      setCloudTestStatus((prev) => ({
        ...prev,
        [target.id]: {
          ok: result.success ? result.data.ok : false,
          message: result.success
            ? (result.data.message || t('cloudForm.available'))
            : formatCloudError(result.error || t('cloudForm.checkFailed'), result.data),
        },
      }));
    } catch (e: any) {
      setCloudTestStatus((prev) => ({
        ...prev,
        [target.id]: { ok: false, message: e?.message || t('cloudForm.checkFailed') },
      }));
    }
  };

  const renderCloudTargetForm = (target: CloudUploadTargetConfig) => {
    const providerLabel = cloudProviderLabel(target.provider);
    const guide = cloudProviderGuide(target.provider);
    const sectionCls = isPixel
      ? 't8-api-settings-provider-panel border p-3 space-y-4 min-w-0'
      : 't8-api-settings-provider-panel border rounded-xl p-3 sm:p-4 space-y-4 min-w-0';
    const formBlockCls = isPixel
      ? 't8-api-settings-section border p-3 space-y-3'
      : 't8-api-settings-section rounded-lg border p-3 space-y-3';
    const fieldInputCls = `${inputCls.replace('flex-1 ', '')} w-full min-w-0`;
    const guideBoxCls = isPixel
      ? 't8-api-settings-guide border p-3 text-[11px] leading-relaxed'
      : 't8-api-settings-guide rounded-lg border p-3 text-[11px] leading-relaxed';
    const smallPillCls = isPixel
      ? 't8-api-settings-pill inline-flex items-center px-1.5 py-0.5 border text-[10px] font-bold'
      : 't8-api-settings-pill inline-flex items-center rounded px-1.5 py-0.5 border text-[10px] font-semibold';
    const supported = true;
    const test = cloudTestStatus[target.id];
    return (
      <div className={sectionCls}>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-black ${labelCls}`}>{target.label || providerLabel}</span>
              <span className={smallPillCls}>{providerLabel}</span>
              <span className={target.enabled ? 'text-[11px] font-bold text-emerald-500' : `text-[11px] font-bold ${hintCls}`}>
                {target.enabled ? t('state.enabled') : t('state.disabled')}
              </span>
              <span className={supported ? 'text-[11px] font-bold text-emerald-500' : `text-[11px] font-bold ${hintCls}`}>
                {guide?.status}
              </span>
            </div>
            <p className={`mt-1 text-[11px] leading-relaxed ${hintCls}`}>{guide?.subtitle}</p>
          </div>
          <label className={`flex items-center gap-2 text-xs font-bold shrink-0 ${labelCls}`}>
            <input
              type="checkbox"
              checked={!!target.enabled}
              onChange={(e) => updateCloudTarget(target.id, { enabled: e.target.checked })}
            />
            {t('cloudForm.showInContext')}
          </label>
          <label className={`flex items-center gap-2 text-xs font-bold shrink-0 ${labelCls}`}>
            <input
              type="radio"
              checked={!!target.isDefault}
              onChange={() => markCloudDefault(target.id)}
            />
            {t('cloudForm.defaultTarget')}
          </label>
          <button
            type="button"
            onClick={() => handleTestCloudTarget(target)}
            disabled={!!test?.loading}
            className={
              isPixel
                ? 't8-api-settings-secondary-btn px-btn text-[11px] px-2 py-1 shrink-0'
                : 't8-api-settings-secondary-btn px-2 py-1 text-[11px] rounded border shrink-0 inline-flex items-center gap-1'
            }
          >
            <TestTube2 size={12} />
            {test?.loading ? t('cloudForm.checking') : t('cloudForm.check')}
          </button>
        </div>

        {test?.message && (
          <div className={test.ok ? 'text-[11px] text-emerald-500' : 'text-[11px] text-red-400'}>
            {test.message}
          </div>
        )}

        <div className={guideBoxCls}>
          <div className="flex items-start gap-2">
            <Info size={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-bold">{t('cloudForm.whatIsThis')}</div>
              <p>{guide?.description}</p>
              <p className={`mt-2 ${hintCls}`}>
                {t('cloudForm.copyNote')}
              </p>
            </div>
          </div>
        </div>

        <AdvancedProviderFormBlock
          className={formBlockCls}
          labelClassName={labelCls}
          hintClassName={hintCls}
          title={t('cloudForm.basicTitle')}
          note={t('cloudForm.basicNote')}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.displayName')}</span>
              <input
                value={target.label || ''}
                onChange={(e) => updateCloudTarget(target.id, { label: e.target.value })}
                className={fieldInputCls}
                placeholder={providerLabel}
              />
            </label>
            <label className="space-y-1">
              <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.prefix')}</span>
              <input
                value={target.prefix || ''}
                onChange={(e) => updateCloudTarget(target.id, { prefix: e.target.value })}
                className={fieldInputCls}
                placeholder="t8-canvas/{kind}/{yyyy-mm}"
              />
            </label>
            <label className="space-y-1 lg:col-span-2">
              <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.publicDomain')}</span>
              <input
                value={target.publicBaseUrl || ''}
                onChange={(e) => updateCloudTarget(target.id, { publicBaseUrl: e.target.value })}
                className={fieldInputCls}
                placeholder={
                  target.provider === 'tencent-cos' || target.provider === 'aliyun-oss'
                    ? t('cloudForm.publicObjectPlaceholder')
                    : t('cloudForm.publicWebdavPlaceholder')
                }
              />
            </label>
          </div>
        </AdvancedProviderFormBlock>

        {target.provider === 'tencent-cos' && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={t('cloudForm.tencent.title')}
            note={t('cloudForm.tencent.note')}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>Bucket</span>
                <input
                  value={target.tencentCos?.bucket || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'tencentCos', { bucket: e.target.value })}
                  className={fieldInputCls}
                  placeholder="example-1250000000"
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>Region</span>
                <input
                  value={target.tencentCos?.region || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'tencentCos', { region: e.target.value })}
                  className={fieldInputCls}
                  placeholder="ap-guangzhou"
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>SecretId</span>
                <input
                  type="password"
                  value={target.tencentCos?.secretId || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'tencentCos', { secretId: e.target.value })}
                  className={fieldInputCls}
                  placeholder={target.tencentCos?.hasSecretId ? t('cloudForm.keepSecret') : t('cloudForm.enterSecretId')}
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>SecretKey</span>
                <input
                  type="password"
                  value={target.tencentCos?.secretKey || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'tencentCos', { secretKey: e.target.value })}
                  className={fieldInputCls}
                  placeholder={target.tencentCos?.hasSecretKey ? t('cloudForm.keepSecret') : t('cloudForm.enterSecretKey')}
                />
              </label>
            </div>
            <div className={`text-[11px] leading-relaxed ${hintCls}`}>
              <div className="font-bold">{t('cloudForm.console')}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <a
                  href="https://console.cloud.tencent.com/cam/capi"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  {t('cloudForm.tencent.apiConsole')} <ExternalLink size={11} />
                </a>
                <a
                  href="https://console.cloud.tencent.com/lighthouse/cos/index?rid=5"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  {t('cloudForm.tencent.storageConsole')} <ExternalLink size={11} />
                </a>
              </div>
              <div>{t('cloudForm.tencent.reminder')}</div>
            </div>
          </AdvancedProviderFormBlock>
        )}

        {target.provider === 'aliyun-oss' && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={t('cloudForm.aliyun.title')}
            note={t('cloudForm.aliyun.note')}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>Bucket</span>
                <input
                  value={target.aliyunOss?.bucket || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'aliyunOss', { bucket: e.target.value })}
                  className={fieldInputCls}
                  placeholder="example-bucket"
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>Endpoint</span>
                <input
                  value={target.aliyunOss?.endpoint || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'aliyunOss', { endpoint: e.target.value })}
                  className={fieldInputCls}
                  placeholder="oss-cn-hangzhou.aliyuncs.com"
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>AccessKeyId</span>
                <input
                  type="password"
                  value={target.aliyunOss?.accessKeyId || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'aliyunOss', { accessKeyId: e.target.value })}
                  className={fieldInputCls}
                  placeholder={target.aliyunOss?.hasAccessKeyId ? t('cloudForm.keepSecret') : t('cloudForm.enterAccessKeyId')}
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>AccessKeySecret</span>
                <input
                  type="password"
                  value={target.aliyunOss?.accessKeySecret || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'aliyunOss', { accessKeySecret: e.target.value })}
                  className={fieldInputCls}
                  placeholder={target.aliyunOss?.hasAccessKeySecret ? t('cloudForm.keepSecret') : t('cloudForm.enterAccessKeySecret')}
                />
              </label>
            </div>
            <div className={`text-[11px] leading-relaxed ${hintCls}`}>
              <div className="font-bold">{t('cloudForm.console')}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <a
                  href="https://ram.console.aliyun.com/manage/ak"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  {t('cloudForm.aliyun.keyConsole')} <ExternalLink size={11} />
                </a>
                <a
                  href="https://oss.console.aliyun.com/bucket"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  {t('cloudForm.aliyun.storageConsole')} <ExternalLink size={11} />
                </a>
              </div>
              <div>{t('cloudForm.aliyun.reminder')}</div>
            </div>
          </AdvancedProviderFormBlock>
        )}

        {target.provider === 'baidu-netdisk' && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={t('cloudForm.baidu.title')}
            note={t('cloudForm.baidu.note')}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="space-y-1 lg:col-span-2">
                <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.webdavUrl')}</span>
                <input
                  value={target.baiduNetdisk?.webdavUrl || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'baiduNetdisk', { webdavUrl: e.target.value })}
                  className={fieldInputCls}
                  placeholder={t('cloudForm.baidu.urlPlaceholder')}
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.username')}</span>
                <input
                  value={target.baiduNetdisk?.username || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'baiduNetdisk', { username: e.target.value })}
                  className={fieldInputCls}
                  placeholder={t('cloudForm.usernamePlaceholder')}
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.password')}</span>
                <input
                  type="password"
                  value={target.baiduNetdisk?.password || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'baiduNetdisk', { password: e.target.value })}
                  className={fieldInputCls}
                  placeholder={target.baiduNetdisk?.hasPassword ? t('cloudForm.keepSecret') : t('cloudForm.passwordPlaceholder')}
                />
              </label>
              <label className="space-y-1 lg:col-span-2">
                <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.folder')}</span>
                <input
                  value={target.baiduNetdisk?.folder || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'baiduNetdisk', { folder: e.target.value })}
                  className={fieldInputCls}
                  placeholder="/T8PenguinCanvas"
                />
              </label>
            </div>
            <div className={`text-[11px] leading-relaxed ${hintCls}`}>
              {t('cloudForm.baidu.instructions')}
            </div>
          </AdvancedProviderFormBlock>
        )}

        {target.provider === 'quark-netdisk' && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={t('cloudForm.quark.title')}
            note={t('cloudForm.quark.note')}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="space-y-1 lg:col-span-2">
                <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.webdavUrl')}</span>
                <input
                  value={target.quarkNetdisk?.webdavUrl || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'quarkNetdisk', { webdavUrl: e.target.value })}
                  className={fieldInputCls}
                  placeholder={t('cloudForm.quark.urlPlaceholder')}
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.username')}</span>
                <input
                  value={target.quarkNetdisk?.username || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'quarkNetdisk', { username: e.target.value })}
                  className={fieldInputCls}
                  placeholder={t('cloudForm.usernamePlaceholder')}
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.password')}</span>
                <input
                  type="password"
                  value={target.quarkNetdisk?.password || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'quarkNetdisk', { password: e.target.value })}
                  className={fieldInputCls}
                  placeholder={target.quarkNetdisk?.hasPassword ? t('cloudForm.keepSecret') : t('cloudForm.passwordPlaceholder')}
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('cloudForm.folder')}</span>
                <input
                  value={target.quarkNetdisk?.folder || ''}
                  onChange={(e) => updateCloudTargetNested(target.id, 'quarkNetdisk', { folder: e.target.value })}
                  className={fieldInputCls}
                  placeholder="/T8PenguinCanvas"
                />
              </label>
            </div>
            <div className={`text-[11px] leading-relaxed ${hintCls}`}>
              {t('cloudForm.quark.instructions')}
            </div>
          </AdvancedProviderFormBlock>
        )}
      </div>
    );
  };

  const renderAdvancedProviderForm = (provider: AdvancedProviderConfig) => {
    const protocolLabel = advancedProviderLabel(provider.protocol);
    const guide = advancedProviderGuide(provider.protocol);
    const isComfy = provider.protocol === 'comfyui';
    const isJimeng = provider.protocol === 'jimeng-cli';
    const isVolc = provider.protocol === 'volcengine';
    const isModelScope = provider.protocol === 'modelscope';
    const isAgnes = provider.protocol === 'agnes';
    const sectionCls = isPixel
      ? 't8-api-settings-provider-panel border p-3 space-y-4 min-w-0'
      : 't8-api-settings-provider-panel border rounded-xl p-3 sm:p-4 space-y-4 min-w-0';
    const formBlockCls = isPixel
      ? 't8-api-settings-section border p-3 space-y-3'
      : 't8-api-settings-section rounded-lg border p-3 space-y-3';
    const fieldInputCls = `${inputCls.replace('flex-1 ', '')} w-full min-w-0`;
    const textareaCls = `${fieldInputCls} min-h-[76px] resize-y font-mono text-xs leading-relaxed`;
    const guideBoxCls = isPixel
      ? 't8-api-settings-guide border p-3 text-[11px] leading-relaxed'
      : 't8-api-settings-guide rounded-lg border p-3 text-[11px] leading-relaxed';
    const smallPillCls = isPixel
      ? 't8-api-settings-pill inline-flex items-center px-1.5 py-0.5 border text-[10px] font-bold'
      : 't8-api-settings-pill inline-flex items-center rounded px-1.5 py-0.5 border text-[10px] font-semibold';
    const comfyWorkflow = (provider.comfyuiConfig?.workflows?.[0] || { id: 'workflow-1', name: t('comfy.defaultWorkflow') }) as NonNullable<NonNullable<AdvancedProviderConfig['comfyuiConfig']>['workflows']>[number];
    const comfyDraft = advancedComfyDrafts[provider.id] || {};
    const comfyWorkflowRaw = comfyDraft.workflowJson ?? (comfyWorkflow.workflowJson ? JSON.stringify(comfyWorkflow.workflowJson, null, 2) : '');
    const comfyWorkflowObject = tryParseJsonObject(comfyWorkflowRaw);
    const comfyWorkflowSource = comfyWorkflowObject || comfyWorkflow.workflowJson || null;
    const comfyAnalysis = analyzeComfyWorkflow(comfyWorkflowSource);
    const comfyImportChecklist = buildComfyWorkflowImportChecklist(comfyWorkflowSource, comfyAnalysis);
    const comfyExcludeRulesRaw = comfyDraft.excludeRules ?? parseComfyFieldExcludeRules((comfyWorkflow as any).excludeRules).join('\n');
    const comfyExcludeRules = parseComfyFieldExcludeRules(comfyExcludeRulesRaw);
    const comfyFilteredAnalysisFields = filterComfyFieldsByExcludeRules(comfyWorkflowSource, comfyAnalysis.fields, comfyExcludeRules);
    const comfyExcludedFieldCount = Math.max(0, comfyAnalysis.fields.length - comfyFilteredAnalysisFields.length);
    const comfyBaseMappedFields = (Array.isArray(comfyWorkflow.fields) && comfyWorkflow.fields.length
      ? comfyWorkflow.fields
      : comfyFilteredAnalysisFields) as ComfyFieldMapping[];
    const comfyMappedFields = canonicalizeComfyFieldsByWorkflow(
      comfyWorkflowSource,
      filterComfyFieldsByExcludeRules(comfyWorkflowSource, comfyBaseMappedFields, comfyExcludeRules),
    );
    const setComfyDraft = (patch: { workflowJson?: string; fields?: string; excludeRules?: string }) => {
      setAdvancedComfyDrafts((prev) => ({ ...prev, [provider.id]: { ...(prev[provider.id] || {}), ...patch } }));
    };
    const updateComfyWorkflow = (patch: Record<string, any>) => {
      updateAdvancedProviderNested(provider.id, 'comfyuiConfig', {
        workflows: [{ ...comfyWorkflow, ...patch }],
      });
    };
    const updateComfyWorkflowJson = (raw: string) => {
      setComfyDraft({ workflowJson: raw });
      try {
        const workflowJson = JSON.parse(raw);
        const analysis = analyzeComfyWorkflow(workflowJson);
        const nextFields = canonicalizeComfyFieldsByWorkflow(
          workflowJson,
          filterComfyFieldsByExcludeRules(workflowJson, analysis.fields, comfyExcludeRules),
        );
        updateComfyWorkflow({
          workflowJson,
          ...(nextFields.length ? { fields: nextFields } : {}),
        });
        if (nextFields.length) setComfyDraft({ fields: JSON.stringify(nextFields, null, 2) });
        setAdvancedTestStatus((prev) => ({
          ...prev,
          [provider.id]: {
            ok: true,
            message: nextFields.length
              ? t('comfy.parsedFields', { count: nextFields.length })
              : t('comfy.parsedNoFields'),
          },
        }));
      } catch {
        setAdvancedTestStatus((prev) => ({ ...prev, [provider.id]: { ok: false, message: t('comfy.invalidWorkflow') } }));
      }
    };
    const updateComfyExcludeRules = (raw: string) => {
      setComfyDraft({ excludeRules: raw });
      const excludeRules = parseComfyFieldExcludeRules(raw);
      const workflowJson = comfyWorkflowSource;
      const currentFields = comfyAnalysis.fields.length
        ? comfyAnalysis.fields
        : (Array.isArray(comfyWorkflow.fields) ? comfyWorkflow.fields : []);
      const fields = canonicalizeComfyFieldsByWorkflow(
        workflowJson,
        filterComfyFieldsByExcludeRules(workflowJson, currentFields as ComfyFieldMapping[], excludeRules),
      );
      updateComfyWorkflow({ excludeRules, fields });
      setComfyDraft({ fields: JSON.stringify(fields, null, 2) });
      setAdvancedTestStatus((prev) => ({
        ...prev,
        [provider.id]: {
          ok: true,
          message: excludeRules.length
            ? t('comfy.rulesSet', { rules: excludeRules.length, fields: fields.length })
            : t('comfy.rulesCleared', { fields: fields.length }),
        },
      }));
    };
    const appendComfyExcludeRules = (items: string[]) => {
      updateComfyExcludeRules([...parseComfyFieldExcludeRules(comfyExcludeRulesRaw), ...items].join('\n'));
    };
    const exportComfyExcludeRules = () => {
      const payload = createComfyFieldExcludeRulesBackup(comfyExcludeRulesRaw, `api-settings:${provider.id}`);
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadJson(`t8-comfyui-exclude-rules-${provider.id || 'provider'}-${date}.json`, payload);
      setAdvancedTestStatus((prev) => ({
        ...prev,
        [provider.id]: { ok: true, message: t('comfy.rulesExported', { count: payload.rules.length }) },
      }));
    };
    const handleComfyExcludeRulesFile = (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const rules = parseComfyFieldExcludeRulesBackup(String(reader.result || ''));
        updateComfyExcludeRules(rules.join('\n'));
        setAdvancedTestStatus((prev) => ({
          ...prev,
          [provider.id]: { ok: true, message: t('comfy.rulesImported', { count: rules.length }) },
        }));
      };
      reader.onerror = () => setAdvancedTestStatus((prev) => ({
        ...prev,
        [provider.id]: { ok: false, message: t('comfy.rulesReadFailed') },
      }));
      reader.readAsText(file, 'utf-8');
    };
    const handleComfyWorkflowFile = (file: File) => {
      const reader = new FileReader();
      reader.onload = () => updateComfyWorkflowJson(String(reader.result || ''));
      reader.onerror = () => setAdvancedTestStatus((prev) => ({
        ...prev,
        [provider.id]: { ok: false, message: t('comfy.workflowReadFailed') },
      }));
      reader.readAsText(file, 'utf-8');
    };
    const updateComfyFields = (raw: string) => {
      setComfyDraft({ fields: raw });
      try {
        const parsed = JSON.parse(raw || '[]');
        if (!Array.isArray(parsed)) throw new Error('fields must be array');
        const workflowJson = comfyWorkflowSource;
        const fields = canonicalizeComfyFieldsByWorkflow(
          workflowJson,
          filterComfyFieldsByExcludeRules(workflowJson, parsed as ComfyFieldMapping[], comfyExcludeRules),
        );
        updateComfyWorkflow({ fields });
        setAdvancedTestStatus((prev) => ({ ...prev, [provider.id]: { ok: true, message: t('comfy.mappingParsed') } }));
      } catch {
        setAdvancedTestStatus((prev) => ({ ...prev, [provider.id]: { ok: false, message: t('comfy.mappingMustArray') } }));
      }
    };
    const applyComfyAutoMapping = () => {
      const workflowJson = comfyWorkflowSource;
      const analysis = analyzeComfyWorkflow(workflowJson || null);
      const fields = canonicalizeComfyFieldsByWorkflow(
        workflowJson || null,
        filterComfyFieldsByExcludeRules(workflowJson || null, analysis.fields, comfyExcludeRules),
      );
      updateComfyWorkflow({ fields });
      setComfyDraft({ fields: JSON.stringify(fields, null, 2) });
      setAdvancedTestStatus((prev) => ({
        ...prev,
        [provider.id]: {
          ok: fields.length > 0,
          message: fields.length
            ? t('comfy.autoMappingApplied', {
                fields: fields.length,
                excluded: comfyExcludeRules.length ? analysis.fields.length - fields.length : 0,
              })
            : t('comfy.autoMappingEmpty'),
        },
      }));
    };
    const applyComfySampleWorkflow = () => {
      const workflowJson = JSON.parse(stringifyBasicComfyTextToImageWorkflow());
      const analysis = analyzeComfyWorkflow(workflowJson);
      const fields = canonicalizeComfyFieldsByWorkflow(workflowJson, analysis.fields);
      updateComfyWorkflow({
        id: BASIC_COMFY_TEXT_TO_IMAGE_SAMPLE_ID,
        name: t('comfy.sampleName'),
        workflowJson,
        fields,
        excludeRules: [],
      });
      setComfyDraft({
        workflowJson: JSON.stringify(workflowJson, null, 2),
        fields: JSON.stringify(fields, null, 2),
        excludeRules: '',
      });
      setAdvancedTestStatus((prev) => ({
        ...prev,
        [provider.id]: {
          ok: true,
          message: t('comfy.sampleLoaded'),
        },
      }));
    };
    const updateComfyField = (index: number, patch: Partial<ComfyFieldMapping>) => {
      const nextFields = canonicalizeComfyFieldsByWorkflow(
        comfyWorkflowSource,
        filterComfyFieldsByExcludeRules(
          comfyWorkflowSource,
          comfyMappedFields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
          comfyExcludeRules,
        ),
      );
      updateComfyWorkflow({ fields: nextFields });
      setComfyDraft({ fields: JSON.stringify(nextFields, null, 2) });
    };
    const removeComfyField = (index: number) => {
      const nextFields = comfyMappedFields.filter((_, i) => i !== index);
      updateComfyWorkflow({ fields: nextFields });
      setComfyDraft({ fields: JSON.stringify(nextFields, null, 2) });
    };
    const modelscopeLoras = Array.isArray(provider.modelscopeConfig?.loras) ? provider.modelscopeConfig.loras : [];
    const setModelscopeLoras = (loras: any[]) => {
      updateAdvancedProviderNested(provider.id, 'modelscopeConfig', {
        defaultsVersion: provider.modelscopeConfig?.defaultsVersion,
        loras,
      });
    };
    const modelscopeTargetOptions = (selected?: string) => {
      const out: string[] = [];
      for (const value of [
        selected,
        ...(Array.isArray(provider.imageModels) ? provider.imageModels : []),
        'Tongyi-MAI/Z-Image-Turbo',
        'Qwen/Qwen-Image-2512',
        'Qwen/Qwen-Image-Edit-2511',
        'black-forest-labs/FLUX.2-klein-9B',
      ]) {
        const item = String(value || '').trim();
        if (item && !out.includes(item)) out.push(item);
      }
      return out;
    };
    const addModelscopeLora = () => {
      setModelscopeLoras([
        ...modelscopeLoras,
        {
          id: '',
          name: '',
          targetModel: modelscopeTargetOptions()[0] || 'Tongyi-MAI/Z-Image-Turbo',
          strength: 0.8,
          enabled: true,
          note: '',
        },
      ]);
    };
    const updateModelscopeLora = (index: number, patch: Record<string, any>) => {
      setModelscopeLoras(modelscopeLoras.map((lora, i) => (
        i === index
          ? {
            ...lora,
            ...patch,
            ...(Object.prototype.hasOwnProperty.call(patch, 'strength')
              ? { strength: normalizeModelscopeLoraStrength(patch.strength, 0.8) }
              : {}),
          }
          : lora
      )));
    };
    const removeModelscopeLora = (index: number) => {
      setModelscopeLoras(modelscopeLoras.filter((_, i) => i !== index));
    };
    const enabledModelscopeLoraCount = normalizeModelscopeLoras(modelscopeLoras).filter((lora) => lora.enabled !== false).length;
    return (
      <div className={sectionCls}>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-black ${labelCls}`}>{provider.label || protocolLabel}</span>
              <span className={smallPillCls}>{protocolLabel}</span>
              <span className={provider.enabled ? 'text-[11px] font-bold text-emerald-500' : `text-[11px] font-bold ${hintCls}`}>
                {provider.enabled ? t('state.enabled') : t('state.disabled')}
              </span>
            </div>
            <p className={`mt-1 text-[11px] leading-relaxed ${hintCls}`}>{guide?.subtitle}</p>
          </div>
          <label className={`flex items-center gap-2 text-xs font-bold shrink-0 ${labelCls}`}>
            <input
              type="checkbox"
              checked={!!provider.enabled}
              onChange={(e) => updateAdvancedProvider(provider.id, { enabled: e.target.checked })}
            />
            {t('providerForm.showInNodes')}
          </label>
          <button
            type="button"
            onClick={() => handleTestAdvancedProvider(provider)}
            disabled={!!advancedTestStatus[provider.id]?.loading}
            className={
              isPixel
                ? 't8-api-settings-secondary-btn px-btn text-[11px] px-2 py-1 shrink-0'
                : 't8-api-settings-secondary-btn px-2 py-1 text-[11px] rounded border shrink-0 inline-flex items-center gap-1'
            }
          >
            <TestTube2 size={12} />
            {advancedTestStatus[provider.id]?.loading ? t('providerForm.testing') : t('providerForm.testConnection')}
          </button>
        </div>

        {advancedTestStatus[provider.id]?.message && (
          <div
            className={
              advancedTestStatus[provider.id]?.ok
                ? 'text-[11px] text-emerald-500'
                : 'text-[11px] text-red-400'
            }
          >
            {advancedTestStatus[provider.id]?.message}
          </div>
        )}

        <div className={guideBoxCls}>
          <div className="flex items-start gap-2">
            <Info size={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-bold">{t('providerForm.whatIsThis')}</div>
              <p>{guide?.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(guide?.nodeScopes || []).map((scope) => (
                  <span key={scope} className={smallPillCls}>{scope}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <AdvancedProviderFormBlock
          className={formBlockCls}
          labelClassName={labelCls}
          hintClassName={hintCls}
          title={t('providerForm.basicTitle')}
          note={t('providerForm.basicNote')}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className={`text-[11px] ${labelCls}`}>{t('providerForm.displayName')}</span>
              <input
                value={provider.label || ''}
                onChange={(e) => updateAdvancedProvider(provider.id, { label: e.target.value })}
                className={fieldInputCls}
                placeholder={protocolLabel}
              />
            </label>
            {!isJimeng && (
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{isComfy ? t('providerForm.defaultInstance') : 'Base URL'}</span>
                <input
                  value={provider.baseUrl || ''}
                  onChange={(e) => updateAdvancedProvider(provider.id, { baseUrl: e.target.value })}
                  className={fieldInputCls}
                  placeholder={guide?.baseUrlPlaceholder || 'https://api.example.com/v1'}
                />
              </label>
            )}
          </div>
        </AdvancedProviderFormBlock>

        {!isComfy && !isJimeng && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={isVolc ? t('providerForm.generationKeyTitle') : t('providerForm.connectionKeyTitle')}
            note={guide?.connectionHint}
          >
            <div className="space-y-1 block">
              <span className={`block text-[11px] ${labelCls}`}>{guide?.keyLabel || 'API Key / Token'}</span>
              <div className="t8-api-settings-secret-field">
                <input
                  type={advancedSecretShows[provider.id] ? 'text' : 'password'}
                  value={provider.apiKey || ''}
                  onChange={(e) => updateAdvancedProvider(provider.id, { apiKey: e.target.value })}
                  className={fieldInputCls}
                  autoComplete="off"
                  placeholder={
                    provider.hasApiKey || provider.apiKey
                      ? t('providerForm.keepSecret')
                      : isVolc
                        ? t('providerForm.enterArkKey')
                        : t('providerForm.enterApiKey')
                  }
                />
                <button
                  type="button"
                  className="t8-api-settings-secret-toggle t8-api-settings-icon-btn"
                  onClick={() => setAdvancedSecretShows((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                  title={advancedSecretShows[provider.id] ? t('keys.hide') : t('keys.showPlaintext')}
                  aria-label={`${guide?.keyLabel || 'API Key / Token'}${advancedSecretShows[provider.id] ? t('keys.hide') : t('keys.showPlaintext')}`}
                >
                  {advancedSecretShows[provider.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            {isVolc && (
              <div className={guideBoxCls}>
                <div className="font-bold">{t('providerForm.volc.whichKey')}</div>
                <p>{t('providerForm.volc.whichKeyBody')}</p>
                <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-400/15 px-3 py-2">
                  <div className="font-bold">{t('providerForm.volc.seedanceReminder')}</div>
                  <p>{t('providerForm.volc.seedanceReminderBody')}</p>
                </div>
              </div>
            )}
            {provider.protocol === 'modelscope' && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openExternal(MODELSCOPE_TOKEN_URLS.cn)}
                  className={linkBtnCls}
                  title={t('providerForm.modelscope.cnTitle')}
                >
                  <ExternalLink size={11} /> {t('providerForm.modelscope.cnAction')}
                </button>
                <button
                  type="button"
                  onClick={() => openExternal(MODELSCOPE_TOKEN_URLS.intl)}
                  className={linkBtnAltCls}
                  title={t('providerForm.modelscope.intlTitle')}
                >
                  <ExternalLink size={11} /> {t('providerForm.modelscope.intlAction')}
                </button>
              </div>
            )}
            {isAgnes && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openExternal(AGNES_API_KEY_URL)}
                    className={linkBtnCls}
                    title={t('providerForm.agnes.keyTitle')}
                  >
                    <ExternalLink size={11} /> {t('providerForm.agnes.keyAction')}
                  </button>
                </div>
                <div className={guideBoxCls}>
                  <div className="font-bold">{t('providerForm.agnes.howTitle')}</div>
                  <p>{t('providerForm.agnes.howBody')}</p>
                </div>
              </div>
            )}
          </AdvancedProviderFormBlock>
        )}

        {isVolc && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={t('providerForm.volc.akTitle')}
            note={t('providerForm.volc.akNote')}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>Project</span>
                <input
                  value={provider.volcengineConfig?.project || ''}
                  onChange={(e) => updateAdvancedProviderNested(provider.id, 'volcengineConfig', { project: e.target.value })}
                  className={fieldInputCls}
                  placeholder={t('providerForm.optionalDefault')}
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>Region</span>
                <input
                  value={provider.volcengineConfig?.region || ''}
                  onChange={(e) => updateAdvancedProviderNested(provider.id, 'volcengineConfig', { region: e.target.value })}
                  className={fieldInputCls}
                  placeholder="cn-beijing"
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('providerForm.volc.akLabel')}</span>
                <input
                  type="password"
                  value={provider.volcengineConfig?.accessKeyId || ''}
                  onChange={(e) => updateAdvancedProviderNested(provider.id, 'volcengineConfig', { accessKeyId: e.target.value })}
                  className={fieldInputCls}
                  placeholder={provider.volcengineConfig?.hasAccessKeyId ? t('cloudForm.keepSecret') : t('providerForm.volc.akPlaceholder')}
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('providerForm.volc.skLabel')}</span>
                <input
                  type="password"
                  value={provider.volcengineConfig?.secretAccessKey || ''}
                  onChange={(e) => updateAdvancedProviderNested(provider.id, 'volcengineConfig', { secretAccessKey: e.target.value })}
                  className={fieldInputCls}
                  placeholder={provider.volcengineConfig?.hasSecretAccessKey ? t('cloudForm.keepSecret') : t('providerForm.volc.akPlaceholder')}
                />
              </label>
            </div>
          </AdvancedProviderFormBlock>
        )}

        {isComfy && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={t('comfy.sectionTitle')}
            note={guide?.connectionHint}
          >
            <label className="space-y-1 block">
              <span className={`text-[11px] ${labelCls}`}>{t('comfy.instances')}</span>
              <PromptTextarea
                title={t('comfy.instances')}
                value={(provider.comfyuiConfig?.instances || [provider.baseUrl || '']).filter(Boolean).join('\n')}
                onValueChange={(value) => updateAdvancedProviderNested(provider.id, 'comfyuiConfig', {
                  instances: parseAdvancedProviderModelText(value),
                })}
                editorKind="lines"
                mono
                className={textareaCls}
                placeholder={guide?.baseUrlPlaceholder || 'http://127.0.0.1:8188'}
              />
            </label>
            <label
              className={
                isPixel
                  ? `t8-api-settings-guide border p-3 flex items-start gap-2 text-[11px] leading-relaxed ${labelCls}`
                  : `t8-api-settings-guide rounded-lg border p-3 flex items-start gap-2 text-[11px] leading-relaxed ${labelCls}`
              }
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={!!provider.allowRemote}
                onChange={(e) => updateAdvancedProvider(provider.id, { allowRemote: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="font-black inline-flex items-center gap-1">
                   <Lock size={11} /> {t('comfy.allowRemote')}
                </span>
                <span className={`block mt-1 ${hintCls}`}>
                   {t('comfy.allowRemoteNote')}
                </span>
              </span>
            </label>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('comfy.workflowId')}</span>
                <input
                  value={comfyWorkflow.id || ''}
                  onChange={(e) => updateComfyWorkflow({ id: e.target.value || 'workflow-1' })}
                  className={fieldInputCls}
                  placeholder="workflow-1"
                />
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('comfy.workflowName')}</span>
                <input
                  value={comfyWorkflow.name || ''}
                  onChange={(e) => updateComfyWorkflow({ name: e.target.value || t('comfy.defaultWorkflow') })}
                  className={fieldInputCls}
                  placeholder={t('comfy.defaultWorkflow')}
                />
              </label>
            </div>
            <label className="space-y-1 block">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[11px] ${labelCls}`}>{t('comfy.workflowJson')}</span>
                <label
                  className={
                    isPixel
                      ? 't8-api-settings-secondary-btn px-btn text-[11px] px-2 py-1 shrink-0 cursor-pointer inline-flex items-center gap-1'
                      : 't8-api-settings-secondary-btn px-2 py-1 text-[11px] rounded border shrink-0 cursor-pointer inline-flex items-center gap-1'
                  }
                  title={t('comfy.uploadTitle')}
                >
                  <FileUp size={12} /> {t('comfy.upload')}
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleComfyWorkflowFile(file);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={applyComfySampleWorkflow}
                  className={
                    isPixel
                      ? 't8-api-settings-secondary-btn px-btn text-[11px] px-2 py-1 shrink-0'
                      : 't8-api-settings-secondary-btn px-2 py-1 text-[11px] rounded border shrink-0 inline-flex items-center gap-1'
                  }
                  title={t('comfy.loadSampleTitle')}
                >
                  <Plus size={12} /> {t('comfy.loadSample')}
                </button>
              </div>
              <PromptTextarea
                title="ComfyUI Workflow JSON"
                value={comfyWorkflowRaw}
                onValueChange={updateComfyWorkflowJson}
                editorKind="json"
                mono
                className={`${textareaCls} min-h-[140px]`}
                placeholder={t('comfy.workflowPlaceholder')}
              />
              <p className={`text-[11px] ${hintCls}`}>{t('comfy.apiWorkflowNote')}</p>
            </label>
            <div className="space-y-1 block">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-[11px] ${labelCls}`}>{t('comfy.excludeRules')}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={exportComfyExcludeRules}
                    className={isPixel ? 'px-btn text-[11px] px-2 py-1 inline-flex items-center gap-1' : 'rounded border px-2 py-1 text-[11px] inline-flex items-center gap-1'}
                    title={t('comfy.exportRulesTitle')}
                  >
                    <Download size={12} /> {t('comfy.exportRules')}
                  </button>
                  <label
                    className={isPixel ? 'px-btn text-[11px] px-2 py-1 inline-flex cursor-pointer items-center gap-1' : 'rounded border px-2 py-1 text-[11px] inline-flex cursor-pointer items-center gap-1'}
                    title={t('comfy.importRulesTitle')}
                  >
                    <FileUp size={12} /> {t('comfy.importRules')}
                    <input
                      type="file"
                      accept="application/json,.json,.txt"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) handleComfyExcludeRulesFile(file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
              <PromptTextarea
                title={t('comfy.excludeRules')}
                value={comfyExcludeRulesRaw}
                onValueChange={updateComfyExcludeRules}
                editorKind="lines"
                mono
                className={`${textareaCls} min-h-[72px]`}
                placeholder={t('comfy.excludeRulesPlaceholder')}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => appendComfyExcludeRules(['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'])}
                  className={isPixel ? 'px-btn text-[11px] px-2 py-1' : 'rounded border px-2 py-1 text-[11px]'}
                >
                  {t('comfy.excludeSampler')}
                </button>
                <button
                  type="button"
                  onClick={() => appendComfyExcludeRules(['model_name', 'ckpt_name', 'clip_name', 'vae_name', 'lora_name'])}
                  className={isPixel ? 'px-btn text-[11px] px-2 py-1' : 'rounded border px-2 py-1 text-[11px]'}
                >
                  {t('comfy.excludeModels')}
                </button>
                <button
                  type="button"
                  onClick={() => appendComfyExcludeRules(['width', 'height', 'batch_size'])}
                  className={isPixel ? 'px-btn text-[11px] px-2 py-1' : 'rounded border px-2 py-1 text-[11px]'}
                >
                  {t('comfy.excludeSize')}
                </button>
                <span className={`text-[10px] ${hintCls}`}>
                  {t('comfy.excludeSummary', { rules: comfyExcludeRules.length, fields: comfyExcludedFieldCount })}
                </span>
              </div>
              <p className={`text-[11px] ${hintCls}`}>
                {t('comfy.excludeHelp')}
              </p>
            </div>
            <div className={guideBoxCls}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={`text-xs font-black ${labelCls}`}>{t('comfy.analysisTitle')}</div>
                  <p className={`mt-1 ${hintCls}`}>
                    {t('comfy.analysisSummary', { fields: comfyAnalysis.fields.length, kept: comfyFilteredAnalysisFields.length, images: comfyAnalysis.imageInputCount, outputs: comfyAnalysis.outputCount })}
                  </p>
                  {comfyAnalysis.warnings.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {comfyAnalysis.warnings.slice(0, 3).map((warning, index) => (
                        <p key={`${provider.id}-comfy-warning-${index}`} className="text-[10px] text-amber-400">
                          {String(t(warning.key as any, warning.params as any))}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-1">
                    {comfyImportChecklist.map((item) => (
                      <div
                        key={`${provider.id}-comfy-check-${item.id}`}
                        className="rounded border px-2 py-1 text-[10px]"
                        style={{
                          borderColor: item.level === 'ok' ? 'rgba(34,197,94,0.38)' : item.level === 'warn' ? 'rgba(245,158,11,0.42)' : 'var(--t8-border)',
                          color: item.level === 'ok' ? '#22c55e' : item.level === 'warn' ? '#f59e0b' : undefined,
                        }}
                      >
                        <b>{String(t(item.labelKey as any, item.labelParams as any))}</b> · {String(t(item.detailKey as any, item.detailParams as any))}
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={applyComfyAutoMapping}
                  className={
                    isPixel
                      ? 't8-api-settings-secondary-btn px-btn text-[11px] px-2 py-1 shrink-0'
                      : 't8-api-settings-secondary-btn px-2 py-1 text-[11px] rounded border shrink-0'
                  }
                >
                  {t('comfy.autoMap')}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className={`text-xs font-black ${labelCls}`}>{t('comfy.mappingTitle')}</div>
              {comfyMappedFields.length > 0 ? (
                <div className="space-y-1.5">
                  {comfyMappedFields.map((field, index) => {
                    const detected = comfyAnalysis.fields.find((item) => item.nodeId === field.nodeId && item.fieldName === field.fieldName);
                    const isFixed = String(field.source || '') === 'fixed';
                    return (
                      <div
                        key={`${field.nodeId}-${field.fieldName}-${index}`}
                        className={isPixel ? 't8-api-settings-section border p-2 space-y-2' : 't8-api-settings-section rounded border p-2 space-y-2'}
                      >
                        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_180px_32px] gap-2 items-end">
                          <div className="min-w-0">
                            <div className={`text-[11px] font-bold truncate ${labelCls}`} title={detected?.label || `${field.nodeId}.${field.fieldName}`}>
                              {detected?.label || t('comfy.nodeField', { nodeId: field.nodeId, fieldName: field.fieldName })}
                            </div>
                            <div className={`text-[10px] truncate ${hintCls}`}>
                              {detected?.classType || 'Custom'} / {field.nodeId}.{field.fieldName}
                            </div>
                          </div>
                          <label className="space-y-1">
                            <span className={`text-[10px] ${hintCls}`}>{t('comfy.source')}</span>
                            <select
                              value={(field.source || field.fieldName || 'fixed') as string}
                              onChange={(e) => updateComfyField(index, { source: e.target.value })}
                              className={fieldInputCls}
                            >
                              {COMFY_FIELD_SOURCE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{t(option.labelKey as any)}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => removeComfyField(index)}
                            className={isPixel ? 'px-btn text-[11px] px-2 py-1' : 'rounded border px-2 py-1 text-[11px]'}
                            title={t('comfy.removeMapping')}
                          >
                            <X size={12} />
                          </button>
                        </div>
                        {isFixed && (
                          <input
                            value={String(field.value ?? '')}
                            onChange={(e) => updateComfyField(index, { value: e.target.value })}
                            className={fieldInputCls}
                            placeholder={t('comfy.fixedValue')}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={`text-[11px] ${hintCls}`}>{t('comfy.mappingEmpty')}</p>
              )}
            </div>
            <details className="space-y-2">
              <summary className={`cursor-pointer text-[11px] font-bold ${labelCls}`}>{t('comfy.advancedJson')}</summary>
              <PromptTextarea
                title="ComfyUI fields JSON"
                value={comfyDraft.fields ?? JSON.stringify(comfyMappedFields, null, 2)}
                onValueChange={updateComfyFields}
                editorKind="json"
                mono
                className={textareaCls}
                placeholder='[{"nodeId":"1","fieldName":"text","source":"prompt"}]'
              />
              <p className={`text-[11px] ${hintCls}`}>{t('comfy.advancedJsonNote')}</p>
            </details>
          </AdvancedProviderFormBlock>
        )}

        {isJimeng && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={t('jimeng.sectionTitle')}
            note={guide?.connectionHint}
          >
            <div className={guideBoxCls}>
              <div className="flex items-start gap-2">
                <Info size={14} className="mt-0.5 shrink-0" />
                <div className="min-w-0 space-y-2">
                  <div className={`font-bold ${labelCls}`}>{t('jimeng.installTitle')}</div>
                  <p className={hintCls}>{t('jimeng.installBody', { version: JIMENG_CLI_SUPPORTED_VERSION })}</p>
                  <code className="block w-full overflow-x-auto rounded border px-2 py-1.5 font-mono text-[11px] leading-relaxed">
                    {JIMENG_CLI_INSTALL_UPDATE_COMMAND}
                  </code>
                  <p className={hintCls}>{t('jimeng.loginCommands')}</p>
                  <p className={hintCls}>{t('jimeng.pathHelp')}</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="space-y-1 lg:col-span-2">
                <span className={`text-[11px] ${labelCls}`}>{t('jimeng.executable')}</span>
                <input
                  value={provider.jimengConfig?.executablePath || ''}
                  onChange={(e) => updateAdvancedProviderNested(provider.id, 'jimengConfig', { executablePath: e.target.value })}
                  className={fieldInputCls}
                  placeholder={t('jimeng.executablePlaceholder')}
                />
              </label>
              <label className={`flex items-center gap-2 text-[11px] ${labelCls}`}>
                <input
                  type="checkbox"
                  checked={!!provider.jimengConfig?.useWsl}
                  onChange={(e) => updateAdvancedProviderNested(provider.id, 'jimengConfig', { useWsl: e.target.checked })}
                />
                {t('jimeng.useWsl')}
              </label>
              <label className="space-y-1">
                <span className={`text-[11px] ${labelCls}`}>{t('jimeng.wslDistro')}</span>
                <input
                  value={provider.jimengConfig?.wslDistro || ''}
                  onChange={(e) => updateAdvancedProviderNested(provider.id, 'jimengConfig', { wslDistro: e.target.value })}
                  className={fieldInputCls}
                  placeholder={t('jimeng.wslPlaceholder')}
                />
              </label>
            </div>
          </AdvancedProviderFormBlock>
        )}

        {!isComfy && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={t('providerForm.modelsTitle')}
            note={guide?.modelHint}
          >
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <label className="space-y-1 min-w-0">
                <span className={`text-[11px] ${labelCls}`}>{t('providerForm.imageModels')}</span>
                <PromptTextarea
                  title={t('providerForm.modelEditorTitle', { provider: provider.label || protocolLabel, kind: t('providerForm.imageKind') })}
                  value={stringifyAdvancedProviderModels(provider.imageModels)}
                  onValueChange={(value) => updateAdvancedProvider(provider.id, { imageModels: parseAdvancedProviderModelText(value) })}
                  editorKind="lines"
                  mono
                  className={textareaCls}
                  placeholder={isJimeng ? t('providerForm.imageJimengPlaceholder') : t('providerForm.imagePlaceholder')}
                />
              </label>
              <label className="space-y-1 min-w-0">
                <span className={`text-[11px] ${labelCls}`}>{t('providerForm.videoModels')}</span>
                <PromptTextarea
                  title={t('providerForm.modelEditorTitle', { provider: provider.label || protocolLabel, kind: t('providerForm.videoKind') })}
                  value={stringifyAdvancedProviderModels(provider.videoModels)}
                  onValueChange={(value) => updateAdvancedProvider(provider.id, { videoModels: parseAdvancedProviderModelText(value) })}
                  editorKind="lines"
                  mono
                  className={textareaCls}
                  placeholder={isJimeng ? t('providerForm.videoJimengPlaceholder') : t('providerForm.videoPlaceholder')}
                />
              </label>
              <label className="space-y-1 min-w-0">
                <span className={`text-[11px] ${labelCls}`}>{t('providerForm.chatModels')}</span>
                <PromptTextarea
                  title={t('providerForm.modelEditorTitle', { provider: provider.label || protocolLabel, kind: t('providerForm.chatKind') })}
                  value={stringifyAdvancedProviderModels(provider.chatModels)}
                  onValueChange={(value) => updateAdvancedProvider(provider.id, { chatModels: parseAdvancedProviderModelText(value) })}
                  editorKind="lines"
                  mono
                  className={textareaCls}
                  placeholder={isJimeng ? t('providerForm.chatJimengPlaceholder') : t('providerForm.chatPlaceholder')}
                />
              </label>
            </div>
          </AdvancedProviderFormBlock>
        )}

        {isModelScope && (
          <AdvancedProviderFormBlock
            className={formBlockCls}
            labelClassName={labelCls}
            hintClassName={hintCls}
            title={t('lora.title')}
            note={t('lora.note', { enabled: enabledModelscopeLoraCount, total: modelscopeLoras.length })}
          >
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openExternal('https://www.modelscope.cn/aigc/models')}
                className={linkBtnCls}
                title={t('lora.cnLibraryTitle')}
              >
                <ExternalLink size={11} /> {t('lora.cnLibrary')}
              </button>
              <button
                type="button"
                onClick={() => openExternal('https://www.modelscope.ai/civision/models')}
                className={linkBtnAltCls}
                title={t('lora.intlLibraryTitle')}
              >
                <ExternalLink size={11} /> {t('lora.intlLibrary')}
              </button>
              <button
                type="button"
                onClick={addModelscopeLora}
                className={
                  isPixel
                    ? 't8-api-settings-secondary-btn px-btn text-[11px] px-2 py-1 inline-flex items-center gap-1'
                    : 't8-api-settings-secondary-btn rounded border px-2 py-1 text-[11px] inline-flex items-center gap-1'
                }
              >
                <Plus size={12} /> {t('lora.add')}
              </button>
            </div>

            {!modelscopeLoras.length ? (
              <div className={`border border-dashed p-3 text-center text-[11px] ${hintCls} ${isPixel ? '' : 'rounded-lg'}`}>
                {t('lora.empty')}
              </div>
            ) : (
              <div className="space-y-2">
                {modelscopeLoras.map((lora, index) => {
                  const target = String((lora as any).targetModel || (lora as any).target_model || (lora as any).model || '').trim();
                  const strength = normalizeModelscopeLoraStrength((lora as any).strength ?? (lora as any).default_strength, 0.8);
                  return (
                    <div
                      key={index}
                      className={isPixel ? 't8-api-settings-section border p-2 space-y-2' : 't8-api-settings-section rounded-lg border p-2 space-y-2'}
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_92px_36px] gap-2 items-end">
                        <label className="space-y-1 min-w-0">
                          <span className={`text-[11px] ${labelCls}`}>LoRA ID</span>
                          <input
                            value={(lora as any).id || ''}
                            onChange={(e) => updateModelscopeLora(index, { id: e.target.value })}
                            className={fieldInputCls}
                            placeholder={t('lora.idPlaceholder')}
                          />
                        </label>
                        <label className="space-y-1 min-w-0">
                          <span className={`text-[11px] ${labelCls}`}>{t('lora.targetModel')}</span>
                          <select
                            value={target || modelscopeTargetOptions()[0] || ''}
                            onChange={(e) => updateModelscopeLora(index, { targetModel: e.target.value })}
                            className={fieldInputCls}
                          >
                            {modelscopeTargetOptions(target).map((modelName) => (
                              <option key={modelName} value={modelName}>{modelName}</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 min-w-0">
                          <span className={`text-[11px] ${labelCls}`} title={t('lora.strengthHelp')}>{t('lora.defaultStrength')}</span>
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={strength}
                            onChange={(e) => updateModelscopeLora(index, { strength: e.target.value })}
                            className={fieldInputCls}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => removeModelscopeLora(index)}
                          className={
                            isPixel
                              ? 't8-mini-icon-button h-9 w-9 inline-flex items-center justify-center'
                              : 't8-mini-icon-button h-9 w-9 rounded border inline-flex items-center justify-center'
                          }
                          title={t('lora.remove')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                        <label className="space-y-1 min-w-0">
                          <span className={`text-[11px] ${labelCls}`}>{t('lora.displayName')}</span>
                          <input
                            value={(lora as any).name || ''}
                            onChange={(e) => updateModelscopeLora(index, { name: e.target.value })}
                            className={fieldInputCls}
                            placeholder={t('lora.displayNamePlaceholder')}
                          />
                        </label>
                        <label className="space-y-1 min-w-0">
                          <span className={`text-[11px] ${labelCls}`}>{t('lora.noteLabel')}</span>
                          <input
                            value={(lora as any).note || ''}
                            onChange={(e) => updateModelscopeLora(index, { note: e.target.value })}
                            className={fieldInputCls}
                            placeholder={t('lora.notePlaceholder')}
                          />
                        </label>
                      </div>
                      <label className={`inline-flex items-center gap-2 text-[11px] font-bold ${labelCls}`}>
                        <input
                          type="checkbox"
                          checked={(lora as any).enabled !== false}
                          onChange={(e) => updateModelscopeLora(index, { enabled: e.target.checked })}
                        />
                        {t('lora.enabled')}
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </AdvancedProviderFormBlock>
        )}
      </div>
    );
  };

  // 渲染单个 Key 表项
  const renderKey = (spec: KeySpec, opts: { fallbackHint?: boolean; baseUrlNote?: string; clearable?: boolean }) => {
    const f = spec.field;
    const rawVal = (settings as any)[f] as string | undefined;
    const hasSaved = !!rawVal;
    const maskedDisplay = toMaskedDisplay(rawVal);
    const pendingClear = !!clearedFields[f];
    const showClearButton = !!opts.fallbackHint || !!opts.clearable;
    const clearDisabled = showClearButton && !pendingClear && !hasSaved && !inputs[f].trim();
    return (
      <div key={f} className="space-y-2">
        <label className={`text-sm font-medium flex items-center gap-2 flex-wrap ${labelCls}`}>
          <span className={`w-2 h-2 rounded-full ${spec.bullet}`} />
          {t(spec.labelKey as any)}
          <span className={`text-[11px] font-normal ${hintCls}`}>{t(spec.descKey as any)}</span>
          {pendingClear ? (
            <span className="t8-api-settings-badge text-[10px] font-bold px-1.5 py-0.5 rounded border" data-tone="muted">
              {t('keys.pendingClear')}
            </span>
          ) : hasSaved && (
            <span className="t8-api-settings-badge text-[10px] font-bold px-1.5 py-0.5 rounded border" data-tone="success">
              {t('keys.saved', { masked: maskedDisplay })}
            </span>
          )}
          {opts.fallbackHint && !hasSaved && (
            <span className="t8-api-settings-badge text-[10px] font-normal px-1.5 py-0.5 rounded border" data-tone="muted">
              {t('keys.fallback')}
            </span>
          )}
        </label>
        <div className="flex items-center gap-2">
          <input
            type={shows[f] ? 'text' : 'password'}
            value={inputs[f]}
            onChange={(e) => setInputAt(f, e.target.value)}
            placeholder={pendingClear
              ? (opts.fallbackHint ? t('keys.clearFallbackPlaceholder') : t('keys.clearRemovePlaceholder'))
              : (hasSaved ? t('keys.keepPlaceholder') : (opts.fallbackHint ? t('keys.fallbackPlaceholder') : t('keys.inputPlaceholder')))}
            className={inputCls}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => handleToggleShow(f)}
            className={eyeBtnCls}
            title={shows[f] ? t('keys.hide') : t('keys.showPlaintext')}
            aria-label={`${t(spec.labelKey as any)}${shows[f] ? t('keys.hide') : t('keys.showPlaintext')}`}
          >
            {shows[f] ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          {showClearButton && (
            <button
              type="button"
              onClick={() => handleClearClassifiedKey(f)}
              className={`${eyeBtnCls} disabled:opacity-40 disabled:cursor-not-allowed`}
              title={clearDisabled ? t('keys.nothingToClear') : (pendingClear ? t('keys.cancelClear') : t('keys.clearClassified'))}
              aria-label={`${t(spec.labelKey as any)}${pendingClear ? t('keys.cancelClear') : t('keys.clear')}`}
              disabled={clearDisabled}
            >
              {pendingClear ? <X size={16} /> : <Trash2 size={16} />}
            </button>
          )}
        </div>
        {(opts.baseUrlNote || renderGetKeyButtons(spec.field)) && (
          <div className={`flex items-center gap-2 flex-wrap text-[11px] ${hintCls}`}>
            {opts.baseUrlNote && (
              <span className="flex items-center gap-1.5">
                <Lock size={11} /> {opts.baseUrlNote}
              </span>
            )}
            {renderGetKeyButtons(spec.field)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm ${
        isPixel ? 'px-modal-mask' : 'bg-black/60'
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={
          isPixel
            ? `t8-api-settings-modal w-full ${advancedOpen || cloudUploadOpen ? 'max-w-4xl' : 'max-w-2xl'} mx-4 px-card overflow-hidden flex flex-col max-h-[90vh]`
            : `t8-api-settings-modal w-full ${advancedOpen || cloudUploadOpen ? 'max-w-4xl' : 'max-w-2xl'} mx-4 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border`
        }
      >
        {/* 头部 */}
        <div
          className={`t8-api-settings-header flex items-center gap-3 px-5 py-4 border-b shrink-0 ${
            isPixel
              ? 'border-[var(--px-ink)]'
              : ''
          }`}
        >
          <KeyRound size={18} className="t8-api-settings-icon" />
          <div className="flex-1">
            <h2
              className={`t8-api-settings-title text-base font-semibold ${isPixel ? 'px-title' : ''}`}
            >
              {t('title')}
            </h2>
            <p className={`text-xs mt-0.5 ${hintCls}`}>
              {t('subtitle')}
            </p>
          </div>
          <button
            onClick={onClose}
            className={
              isPixel
                ? 't8-api-settings-icon-btn px-btn px-btn--icon px-btn--ghost'
                : 't8-api-settings-icon-btn p-1.5 rounded-md'
            }
          >
            <X size={18} />
          </button>
        </div>

        {/* 表单 */}
        <div className="t8-api-settings-body p-5 space-y-5 overflow-y-auto">
          <div className="t8-api-settings-divider pb-1" data-ui-font-settings="true">
            <label className={`text-sm font-medium flex items-center gap-2 flex-wrap ${labelCls}`}>
              <Settings2 size={14} className="t8-api-settings-icon" />
              {t('fonts.title')}
              <span className={`text-[11px] font-normal ${hintCls}`}>{t('fonts.hint')}</span>
            </label>
            <div className={`t8-api-settings-section mt-2 p-3 space-y-3 border ${isPixel ? '' : 'rounded-lg'}`}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {UI_FONT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-ui-font-preset={preset.id}
                    data-active={uiFontPreset === preset.id}
                    onClick={() => setUiFontPreset(preset.id)}
                    className={
                      isPixel
                        ? 't8-ui-font-option px-btn !block w-full text-left p-2'
                        : 't8-ui-font-option w-full text-left p-2 rounded-md border transition'
                    }
                  >
                    <span className="block text-xs font-black">{t(preset.labelKey)}</span>
                    <span className={`mt-1 block text-[10px] leading-snug ${hintCls}`}>{t(preset.descriptionKey)}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
                <label className={`block min-w-0 ${labelCls}`}>
                  <span className="block text-[11px] font-bold mb-1">{t('fonts.customStack')}</span>
                  <input
                    type="text"
                    value={customUiFontDraft}
                    onChange={(e) => setCustomUiFontDraft(e.target.value)}
                    onBlur={commitCustomUiFont}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        commitCustomUiFont();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                    placeholder={'"霞鹜文楷", "Microsoft YaHei UI", sans-serif'}
                    className={`${inputCls} w-full`}
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    resetUiFontPreference();
                    setCustomUiFontDraft('');
                  }}
                  className={isPixel ? 't8-api-settings-secondary-btn px-btn px-3 py-2' : 't8-api-settings-secondary-btn px-3 py-2 rounded-md border text-xs'}
                >
                  {t('fonts.restoreRecommended')}
                </button>
              </div>
              <div
                className={`t8-ui-font-preview border p-3 text-xs leading-relaxed ${isPixel ? '' : 'rounded-lg'}`}
                data-ui-font-preview="true"
                style={{ fontFamily: activeUiFontStack }}
              >
                <span className="block text-[11px] font-bold">{t('fonts.previewTitle')}</span>
                <span>{t('fonts.previewText')}</span>
              </div>
            </div>
          </div>

          {/* 通用与主力 Key */}
          {renderKey(COMMON_KEYS[0], { baseUrlNote: t('keys.lockedBase', { url: FIXED_ZHENZHEN_BASE }) })}
          {renderKey(COMMON_KEYS[1], { baseUrlNote: t('keys.lockedBase', { url: FIXED_ZHENZHEN_SD2_BASE }), clearable: true })}
          <LocalSettingsAddonSlot
            open={open}
            isPixel={isPixel}
            isDark={isDark}
            settings={settings as any}
            onSaved={load}
          />
          {renderKey(COMMON_KEYS[2], { baseUrlNote: `Base URL: ${RH_BASE}` })}
          {renderKey(COMMON_KEYS[3], { baseUrlNote: `Base URL: ${RH_INTL_BASE}`, clearable: true })}
          {renderKey(COMMON_KEYS[4], { baseUrlNote: t('keys.sameBaseIndependent', { url: FIXED_ZHENZHEN_BASE }) })}

          {/* 分类独立 Key（默认折叠，点击展开 —— 新手友好） */}
          <div className="t8-api-settings-divider pt-3 border-t">
            {(() => {
              const configuredCount = CLASSIFIED_KEYS.filter((spec) => {
                const v = (settings as any)?.[spec.field];
                return typeof v === 'string' && v.trim().length > 0;
              }).length;
              const totalCount = CLASSIFIED_KEYS.length;
              return (
                <button
                  type="button"
                  onClick={() => setClassifiedOpen((v) => !v)}
                  aria-expanded={classifiedOpen}
                  data-open={classifiedOpen}
                  className={
                    isPixel
                      ? 't8-api-settings-toggle w-full flex items-center gap-2 px-3 py-2 px-btn'
                      : 't8-api-settings-toggle w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition'
                  }
                >
                  <Settings2 size={14} className="t8-api-settings-icon" />
                  <span className="text-xs font-bold">{t('classified.title')}</span>
                  <span
                    className="t8-api-settings-badge ml-1 px-1.5 py-0.5 text-[10px] rounded border"
                    data-tone={configuredCount > 0 ? 'success' : 'muted'}
                  >
                    {t('state.configured', { configured: configuredCount, total: totalCount })}
                  </span>
                  <span className={`ml-auto flex items-center gap-1 text-[11px] ${hintCls}`}>
                    {classifiedOpen ? t('state.collapse') : t('state.expand')}
                    {classifiedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
              );
            })()}
            {!classifiedOpen && (
              <div className={`text-[11px] mt-2 ${hintCls}`}>
                {t('classified.collapsedHelp')}
              </div>
            )}
            {classifiedOpen && (
              <div className="mt-3">
                <div className={`text-[11px] ${hintCls} mb-3`}>
                  {t('classified.expandedHelp')}
                </div>
                <div className="space-y-4">
                  {CLASSIFIED_KEYS.map((spec) => renderKey(spec, { fallbackHint: true }))}
                </div>
              </div>
            )}
          </div>

          {/* v1.8.x: 扩展 API 平台，高级可选 */}
          <div className="t8-api-settings-divider pt-3 border-t">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              data-open={advancedOpen}
              className={
                isPixel
                  ? 't8-api-settings-toggle w-full flex items-center gap-2 px-3 py-2 px-btn'
                  : 't8-api-settings-toggle w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition'
              }
            >
              <ServerCog size={14} className="t8-api-settings-icon" />
              <span className="text-xs font-bold shrink-0">{t('advanced.title')}</span>
              <span className={`hidden sm:inline text-[11px] ${hintCls}`}>{t('advanced.hint')}</span>
              <span className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
                <span
                  className="t8-api-settings-badge px-1.5 py-0.5 text-[10px] rounded border"
                  data-tone={advancedSummary.enabledCount > 0 ? 'success' : 'muted'}
                >
                  {t('state.enabledCount', { enabled: advancedSummary.enabledCount, total: advancedProvidersInput.length || 0 })}
                </span>
                <span className={`text-[10px] ${hintCls}`}>{t('state.keysCount', { count: advancedSummary.configuredKeyCount })}</span>
              </span>
              <span className={`flex items-center gap-1 text-[11px] ${hintCls}`}>
                {advancedOpen ? t('state.collapse') : t('state.expand')}
                {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>
            {!advancedOpen && (
              <div className={`text-[11px] mt-2 ${hintCls}`}>
                {t('advanced.collapsedHelp')}
              </div>
            )}
            {advancedOpen && (
              <div className="mt-3 space-y-3">
                <div className={`text-[11px] leading-relaxed ${hintCls}`}>
                  {t('advanced.expandedHelp')}<br />
                  {t('advanced.summary', { enabled: advancedSummary.enabledCount, keys: advancedSummary.configuredKeyCount, comfy: advancedSummary.comfyuiConfigured ? t('advanced.configuredAddress') : t('advanced.missingAddress'), jimeng: advancedSummary.jimengConfigured ? t('advanced.configuredPath') : t('advanced.missingPath') })}
                </div>
                {advancedProvidersInput.length === 0 ? (
                  <div className={`text-xs ${hintCls}`}>{t('advanced.empty')}</div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)] gap-3 items-start">
                    <div className={`space-y-2 min-w-0 ${isPixel ? '' : 'lg:sticky lg:top-0'}`}>
                      {advancedProvidersInput.map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={() => setActiveAdvancedProviderId(provider.id)}
                          data-active={activeAdvancedProvider?.id === provider.id}
                          data-enabled={!!provider.enabled}
                          className={
                            isPixel
                              ? 't8-api-settings-provider-card w-full !block text-left px-2 py-2 px-btn'
                              : 't8-api-settings-provider-card w-full block text-left px-2 py-2 rounded-md border text-xs transition'
                          }
                        >
                          <div className="flex items-center gap-2 min-w-0 w-full">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${provider.enabled ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
                            <span className="font-bold min-w-0 truncate">{provider.label || advancedProviderLabel(provider.protocol) || provider.id}</span>
                            <span className={`ml-auto text-[10px] shrink-0 ${provider.enabled ? 'text-emerald-500' : hintCls}`}>
                              {provider.enabled ? t('state.enabled') : t('state.disabled')}
                            </span>
                          </div>
                          <div className={`mt-1 text-[10px] leading-snug ${hintCls}`}>
                            {advancedProviderGuide(provider.protocol).nodeScopes.join(' / ')}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="min-w-0">
                      {activeAdvancedProvider && renderAdvancedProviderForm(activeAdvancedProvider)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 云端上传目标：素材右键上传到 OSS/COS/网盘 */}
          <div className="t8-api-settings-divider pt-3 border-t">
            <button
              type="button"
              onClick={() => setCloudUploadOpen((v) => !v)}
              aria-expanded={cloudUploadOpen}
              data-open={cloudUploadOpen}
              className={
                isPixel
                  ? 't8-api-settings-toggle w-full flex items-center gap-2 px-3 py-2 px-btn'
                  : 't8-api-settings-toggle w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition'
              }
            >
              <CloudUpload size={14} className="t8-api-settings-icon" />
              <span className="text-xs font-bold shrink-0">{t('cloud.title')}</span>
              <span className={`hidden sm:inline text-[11px] ${hintCls}`}>{t('cloud.hint')}</span>
              <span className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
                <span
                  className="t8-api-settings-badge px-1.5 py-0.5 text-[10px] rounded border"
                  data-tone={cloudSummary.enabledCount > 0 ? 'success' : 'muted'}
                >
                  {t('state.enabledCount', { enabled: cloudSummary.enabledCount, total: cloudSummary.totalCount || 4 })}
                </span>
                <span className={`text-[10px] ${hintCls}`}>{t('state.configuredCount', { count: cloudSummary.configuredCount })}</span>
              </span>
              <span className={`flex items-center gap-1 text-[11px] ${hintCls}`}>
                {cloudUploadOpen ? t('state.collapse') : t('state.expand')}
                {cloudUploadOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>
            {!cloudUploadOpen && (
              <div className={`text-[11px] mt-2 ${hintCls}`}>
                {t('cloud.collapsedHelp')}
              </div>
            )}
            {cloudUploadOpen && (
              <div className="mt-3 space-y-3">
                <div className={`text-[11px] leading-relaxed ${hintCls}`}>
                  {t('cloud.expandedHelp')}
                  {cloudSummary.defaultLabel ? ` ${t('cloud.defaultTarget', { label: cloudSummary.defaultLabel })}` : ''}
                </div>
                {cloudUploadTargetsInput.length === 0 ? (
                  <div className={`text-xs ${hintCls}`}>{t('cloud.empty')}</div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)] gap-3 items-start">
                    <div className={`space-y-2 min-w-0 ${isPixel ? '' : 'lg:sticky lg:top-0'}`}>
                      {cloudUploadTargetsInput.map((target) => (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => setActiveCloudTargetId(target.id)}
                          data-active={activeCloudTarget?.id === target.id}
                          data-enabled={!!target.enabled}
                          className={
                            isPixel
                              ? 't8-api-settings-provider-card w-full !block text-left px-2 py-2 px-btn'
                              : 't8-api-settings-provider-card w-full block text-left px-2 py-2 rounded-md border text-xs transition'
                          }
                        >
                          <div className="flex items-center gap-2 min-w-0 w-full">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${target.enabled ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
                            <span className="font-bold min-w-0 truncate">{target.label || cloudProviderLabel(target.provider) || target.id}</span>
                            <span className={`ml-auto text-[10px] shrink-0 ${target.enabled ? 'text-emerald-500' : hintCls}`}>
                              {target.enabled ? t('state.enabled') : t('state.disabled')}
                            </span>
                          </div>
                          <div className={`mt-1 text-[10px] leading-snug ${hintCls}`}>
                            {cloudProviderLabel(target.provider)}
                            {target.isDefault ? ` · ${t('state.default')}` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="min-w-0">
                      {activeCloudTarget && renderCloudTargetForm(activeCloudTarget)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 任务完成提示音 */}
          <div className="t8-api-settings-divider pt-3 border-t">
            <label className={`text-sm font-medium flex items-center gap-2 flex-wrap ${labelCls}`}>
              <Volume2 size={14} className="t8-api-settings-icon" />
              {t('sound.title')}
              <span className={`text-[11px] font-normal ${hintCls}`}>{t('sound.hint')}</span>
            </label>
            <div
              className={
                isPixel
                  ? 't8-api-settings-section mt-2 p-3 space-y-3 border'
                  : 't8-api-settings-section mt-2 p-3 space-y-3 rounded-lg border'
              }
            >
              <div className="flex items-start gap-3 justify-between flex-wrap">
                <div className="min-w-0">
                  <div className={`text-xs font-black ${labelCls}`}>
                    {t('sound.current', { name: hasCustomTaskCompletionSound ? (taskCompletionSoundSettings.name || t('sound.customName')) : t('sound.defaultName') })}
                  </div>
                  <div className={`mt-1 text-[11px] leading-relaxed ${hintCls}`}>
                    {t('sound.supported')}
                    {hasCustomTaskCompletionSound && taskCompletionSoundSizeLabel ? ` ${t('sound.currentFile', { size: taskCompletionSoundSizeLabel })}` : ''}
                  </div>
                </div>
                <span
                  className="t8-api-settings-badge px-2 py-1 text-[10px] rounded border shrink-0"
                  data-tone={hasCustomTaskCompletionSound ? 'success' : 'muted'}
                >
                  {hasCustomTaskCompletionSound ? t('sound.custom') : t('sound.default')}
                </span>
              </div>
              <input
                ref={taskCompletionSoundFileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm"
                className="hidden"
                onChange={(e) => handleTaskCompletionSoundUpload(e.target.files?.[0] || null)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => taskCompletionSoundFileInputRef.current?.click()}
                  disabled={taskSoundBusy}
                  className={
                    isPixel
                      ? 't8-api-settings-secondary-btn px-btn flex items-center gap-2 disabled:opacity-50'
                      : 't8-api-settings-secondary-btn px-3 py-2 text-xs rounded-md border flex items-center gap-2 disabled:opacity-50'
                  }
                >
                  <FileUp size={13} />
                  {taskSoundBusy ? t('sound.processing') : t('sound.upload')}
                </button>
                <button
                  type="button"
                  onClick={handlePreviewTaskCompletionSound}
                  disabled={taskSoundBusy || taskSoundTesting}
                  className={
                    isPixel
                      ? 't8-api-settings-action-btn px-btn flex items-center gap-2 disabled:opacity-50'
                      : 't8-api-settings-action-btn px-3 py-2 text-xs rounded-md border flex items-center gap-2 disabled:opacity-50'
                  }
                >
                  <Volume2 size={13} />
                  {taskSoundTesting ? t('sound.testing') : t('sound.test')}
                </button>
                <button
                  type="button"
                  onClick={handleResetTaskCompletionSound}
                  disabled={taskSoundBusy || !hasCustomTaskCompletionSound}
                  className={
                    isPixel
                      ? 't8-api-settings-secondary-btn px-btn flex items-center gap-2 disabled:opacity-50'
                      : 't8-api-settings-secondary-btn px-3 py-2 text-xs rounded-md border flex items-center gap-2 disabled:opacity-50'
                  }
                >
                  <Trash2 size={13} />
                  {t('sound.restoreDefault')}
                </button>
              </div>
              {taskSoundMessage && (
                <div
                  className={
                    taskSoundMessage.tone === 'error'
                      ? 'text-[11px] text-red-400'
                      : 'text-[11px] text-emerald-500'
                  }
                >
                  {taskSoundMessage.text}
                </div>
              )}
            </div>
          </div>

          {/* v1.2.10.2: 文件自动保存路径 */}
          <div className="t8-api-settings-divider pt-3 border-t">
            <label className={`text-sm font-medium flex items-center gap-2 flex-wrap ${labelCls}`}>
              <FolderOpen size={14} className="t8-api-settings-icon" />
              {t('paths.file.title')}
              <span className={`text-[11px] font-normal ${hintCls}`}>{t('paths.file.hint')}</span>
            </label>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={fileSavePathInput}
                onChange={(e) => setFileSavePathInput(e.target.value)}
                placeholder={t('paths.file.placeholder')}
                className={inputCls}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className={`flex items-center gap-2 flex-wrap text-[11px] mt-1.5 ${hintCls}`}>
              <span className="flex items-center gap-1.5">
                <Lock size={11} /> {t('paths.file.note')}
              </span>
            </div>
          </div>

          {/* v1.3.1: 画布自动保存路径 */}
          <div className="t8-api-settings-divider pt-3 border-t">
            <label className={`text-sm font-medium flex items-center gap-2 flex-wrap ${labelCls}`}>
              <FolderOpen size={14} className="t8-api-settings-icon" />
              {t('paths.canvas.title')}
              <span className={`text-[11px] font-normal ${hintCls}`}>{t('paths.canvas.hint')}</span>
            </label>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={canvasAutoSavePathInput}
                onChange={(e) => setCanvasAutoSavePathInput(e.target.value)}
                placeholder={t('paths.canvas.placeholder')}
                className={inputCls}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className={`flex items-center gap-2 flex-wrap text-[11px] mt-1.5 ${hintCls}`}>
              <span className="flex items-center gap-1.5">
                <Lock size={11} /> {t('paths.canvas.note')}
              </span>
            </div>
          </div>

          {/* v1.3.4: 资源库路径 */}
          <div className="t8-api-settings-divider pt-3 border-t">
            <label className={`text-sm font-medium flex items-center gap-2 flex-wrap ${labelCls}`}>
              <FolderOpen size={14} className="t8-api-settings-icon" />
              {t('paths.resources.title')}
              <span className={`text-[11px] font-normal ${hintCls}`}>{t('paths.resources.hint')}</span>
            </label>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={resourceLibraryPathInput}
                onChange={(e) => setResourceLibraryPathInput(e.target.value)}
                placeholder={t('paths.resources.placeholder')}
                className={inputCls}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className={`flex items-center gap-2 flex-wrap text-[11px] mt-1.5 ${hintCls}`}>
              <span className="flex items-center gap-1.5">
                <Lock size={11} /> {t('paths.resources.note')}
              </span>
            </div>
          </div>

          {/* v1.3.6: 主题模板路径 */}
          <div className="t8-api-settings-divider pt-3 border-t">
            <label className={`text-sm font-medium flex items-center gap-2 flex-wrap ${labelCls}`}>
              <FolderOpen size={14} className="t8-api-settings-icon" />
              {t('paths.themes.title')}
              <span className={`text-[11px] font-normal ${hintCls}`}>{t('paths.themes.hint')}</span>
            </label>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={themeTemplatePathInput}
                onChange={(e) => setThemeTemplatePathInput(e.target.value)}
                placeholder={t('paths.themes.placeholder')}
                className={inputCls}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className={`flex items-center gap-2 flex-wrap text-[11px] mt-1.5 ${hintCls}`}>
              <span className="flex items-center gap-1.5">
                <Lock size={11} /> {t('paths.themes.note')}
              </span>
            </div>
          </div>

          {/* 本地 Eagle API */}
          <div className="t8-api-settings-divider pt-3 border-t">
            <label className={`text-sm font-medium flex items-center gap-2 flex-wrap ${labelCls}`}>
              <ExternalLink size={14} className="t8-api-settings-icon" />
              {t('paths.eagle.title')}
              <span className={`text-[11px] font-normal ${hintCls}`}>{t('paths.eagle.hint')}</span>
            </label>
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={eagleApiBaseInput}
                onChange={(e) => setEagleApiBaseInput(e.target.value)}
                placeholder="http://127.0.0.1:41595"
                className={inputCls}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className={`flex items-center gap-2 flex-wrap text-[11px] mt-1.5 ${hintCls}`}>
              <span className="flex items-center gap-1.5">
                <Lock size={11} /> {t('paths.eagle.note')}
              </span>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              ❌ {error}
            </div>
          )}
          {backupMessage && (
            <div
              className={
                isPixel
                  ? 'text-xs px-3 py-2 border border-[var(--px-ink)] bg-[var(--px-yellow)] text-[var(--px-ink)]'
                  : `text-xs rounded-md px-3 py-2 border ${
                      backupMessage.tone === 'error'
                        ? 'text-red-300 bg-red-500/10 border-red-500/25'
                        : isDark
                          ? 'text-amber-100 bg-amber-500/10 border-amber-500/25'
                          : 'text-amber-800 bg-amber-50 border-amber-200'
                    }`
              }
            >
              {backupMessage.text}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          className={`t8-api-settings-footer flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0 ${
            isPixel
              ? 'border-[var(--px-ink)]'
              : ''
          }`}
        >
          <input
            ref={backupFileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => handleImportFile(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            onClick={() => backupFileInputRef.current?.click()}
            className={
              isPixel
                ? 't8-api-settings-secondary-btn px-btn flex items-center gap-2'
                : 't8-api-settings-secondary-btn px-3 py-2 text-sm rounded-md border flex items-center gap-2'
            }
            title={t('backup.importTitle')}
          >
            <FileUp size={14} />
            {t('backup.import')}
          </button>
          <button
            type="button"
            onClick={handleExportSettings}
            className={
              isPixel
                ? 't8-api-settings-secondary-btn px-btn flex items-center gap-2'
                : 't8-api-settings-secondary-btn px-3 py-2 text-sm rounded-md border flex items-center gap-2'
            }
            title={t('backup.exportTitle')}
          >
            <Download size={14} />
            {t('backup.export')}
          </button>
          <button
            onClick={onClose}
            className={
              isPixel
                ? 't8-api-settings-secondary-btn px-btn'
                : 't8-api-settings-secondary-btn px-4 py-2 text-sm rounded-md border'
            }
          >
            {t('common:actions.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className={
              isPixel
                ? 't8-api-settings-primary-btn px-btn px-btn--mint disabled:opacity-50 flex items-center gap-2'
                : 't8-api-settings-primary-btn px-4 py-2 text-sm rounded-md flex items-center gap-2 disabled:opacity-50'
            }
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saved ? (
              <span>✓ {t('save.saved')}</span>
            ) : (
              <Save size={14} />
            )}
            {!loading && !saved && t('common:actions.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
