import compatibility from '../../backend/src/shared/jimengCliCompatibility.json';

export const JIMENG_CLI_SUPPORTED_VERSION = compatibility.supportedVersion;
export const JIMENG_CLI_RELEASE_DATE = compatibility.releaseDate;
export const JIMENG_CLI_INSTALL_UPDATE_COMMAND = compatibility.installUpdateCommand;
export const JIMENG_CLI_OFFICIAL_GUIDE_URL = compatibility.officialGuideUrl;

export const JIMENG_CLI_SEEDREAM50_PRO_RESOLUTIONS = compatibility.seedream50Pro.resolutions;
export const JIMENG_CLI_SEEDANCE25_MODEL = compatibility.seedance25.modelVersion;
export const JIMENG_CLI_SEEDANCE25_RESOLUTIONS = compatibility.seedance25.resolutions;
export const JIMENG_CLI_SEEDANCE25_LIMITS = compatibility.seedance25.multimodal;
export const JIMENG_CLI_SEEDANCE20_LIMITS = compatibility.seedance20Multimodal;
export const JIMENG_CLI_MULTIFRAME = compatibility.intelligentMultiframe;

export const isJimengSeedance25Model = (model: unknown): boolean =>
  String(model || '').trim().toLowerCase().replace(/[\s_-]+/g, '') === 'seedance2.5'.replace(/[\s_-]+/g, '');

export const jimengImageResolutionOptions = (model: unknown): string[] => {
  const normalized = String(model || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized.includes('seedream5.0pro')) return [...compatibility.seedream50Pro.resolutions];
  if (normalized.includes('seedream3.0') || normalized.includes('seedream3.1')) return ['1k', '2k'];
  return ['2k', '4k'];
};

export const jimengSeedanceDurationOptions = (model: unknown): number[] => {
  const normalized = String(model || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized.includes('seedance2.5')) return Array.from({ length: 27 }, (_, index) => index + 4);
  if (normalized.includes('seedance1.5pro')) return Array.from({ length: 8 }, (_, index) => index + 5);
  if (normalized.includes('seedance1.0')) return Array.from({ length: 6 }, (_, index) => index + 5);
  return Array.from({ length: 12 }, (_, index) => index + 4);
};

export const jimengSeedanceResolutionOptions = (model: unknown, multiframe = false): string[] => {
  if (multiframe) return [...compatibility.intelligentMultiframe.resolutions];
  if (isJimengSeedance25Model(model)) return [...compatibility.seedance25.resolutions];
  if (String(model || '').trim().toLowerCase() === 'seedance2.0_vip') return ['720p', '1080p', '4k'];
  return ['720p'];
};

export const JIMENG_CLI_LOGIN_COMMANDS = {
  login: 'dreamina login',
  headless: 'dreamina login --headless',
  checkLogin: 'dreamina login checklogin --device_code=<设备码> --poll=30',
  verify: 'dreamina user_credit',
  relogin: 'dreamina relogin',
  logout: 'dreamina logout',
} as const;
