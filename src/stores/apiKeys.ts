import { create } from 'zustand';
import type { ApiSettings } from '../types/canvas';
import * as api from '../services/api';

// 主 Key 的固定 base URL
export const FIXED_ZHENZHEN_BASE = 'https://ai.t8star.org';
// 沿用历史字段名，实际承载贞贞平价 AI 小屋的 LLM / 视频 / 图片 / 音频接口。
export const FIXED_ZHENZHEN_SD2_BASE = 'https://api.seedance.nz';
export const RH_BASE = 'https://www.runninghub.cn';
export const RH_INTL_BASE = 'https://www.runninghub.ai';

interface ApiKeysState {
  settings: ApiSettings;
  loading: boolean;
  error: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  save: (patch: Partial<ApiSettings>) => Promise<void>;
}

const DEFAULT: ApiSettings = {
  zhenzhenApiKey: '',
  zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE,
  zhenzhenSd2ApiKey: '',
  zhenzhenSd2BaseUrl: FIXED_ZHENZHEN_SD2_BASE,
  rhApiKey: '',
  rhBaseUrl: RH_BASE,
  rhIntlApiKey: '',
  rhIntlBaseUrl: RH_INTL_BASE,
  llmApiKey: '',
  llmBaseUrl: FIXED_ZHENZHEN_BASE,
  // 分类独立 Key（留空时 fallback 到 zhenzhenApiKey）
  gptImageApiKey: '',
  nanoBananaApiKey: '',
  mjApiKey: '',
  veoApiKey: '',
  soraApiKey: '',
  grokApiKey: '',
  seedanceApiKey: '',
  sunoApiKey: '',
  // 路径默认值由后端按平台计算并通过 /api/settings 返回，前端不硬编码 D 盘。
  fileSavePath: '',
  canvasAutoSavePath: '',
  resourceLibraryPath: '',
  themeTemplatePath: '',
  eagleApiBase: '',
  advancedProviders: [],
  advancedProviderSummary: {
    enabledCount: 0,
    configuredKeyCount: 0,
    comfyuiConfigured: false,
    jimengConfigured: false,
  },
  cloudUploadTargets: [],
  cloudUploadSummary: {
    totalCount: 0,
    enabledCount: 0,
    configuredCount: 0,
    supportedUploadCount: 0,
    defaultTargetId: '',
    defaultLabel: '',
  },
  taskCompletionSound: { mode: 'default', url: '' },
  preferences: { theme: 'dark', uiLocale: 'zh-CN', language: 'zh-CN' },
};

export const useApiKeysStore = create<ApiKeysState>((set) => ({
  settings: DEFAULT,
  loading: false,
  error: null,
  loaded: false,

  async load() {
    set({ loading: true, error: null });
    try {
      const data = await api.getSettings();
      set({
        settings: {
          ...DEFAULT,
          ...data,
          zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE,
          zhenzhenSd2BaseUrl: FIXED_ZHENZHEN_SD2_BASE,
          rhBaseUrl: RH_BASE,
          rhIntlBaseUrl: RH_INTL_BASE,
          llmBaseUrl: FIXED_ZHENZHEN_BASE,
        },
        loading: false,
        loaded: true,
      });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '加载设置失败' });
    }
  },

  async save(patch) {
    set({ loading: true, error: null });
    try {
      await api.updateSettings(patch);
      // 重新拉取(后端会返回脱敏后的 Key)
      const data = await api.getSettings();
      set({
        settings: {
          ...DEFAULT,
          ...data,
          zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE,
          zhenzhenSd2BaseUrl: FIXED_ZHENZHEN_SD2_BASE,
          rhBaseUrl: RH_BASE,
          rhIntlBaseUrl: RH_INTL_BASE,
          llmBaseUrl: FIXED_ZHENZHEN_BASE,
        },
        loading: false,
      });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '保存失败' });
    }
  },
}));
