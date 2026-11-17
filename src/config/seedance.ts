import flashContract from '../../backend/src/shared/seedance25FlashContract.json';
export const LEGACY_SEEDANCE_MODEL_OPTIONS = [
  { value: 'doubao-seedance-2-0-fast-260128', label: 'seedance-2-0-fast' },
  { value: 'doubao-seedance-2-0-260128', label: 'seedance-2-0' },
  { value: 'doubao-seedance-2.0-mini', label: 'seedance-2.0-mini' },
] as const;

export const SEEDANCE_NZ_MODEL_OPTIONS = [
  { value: 'standard', label: '国内 Standard' },
  { value: 'fast', label: '国内 Fast' },
  { value: 'mini', label: '国内 Mini' },
  { value: 'global-standard', label: '全球 Standard' },
  { value: 'global-fast', label: '全球 Fast' },
  { value: 'global-mini', label: '全球 Mini' },
] as const;

export const LEGACY_SEEDANCE_RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', 'adaptive'] as const;
export const SEEDANCE_NZ_RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'] as const;
export const LEGACY_SEEDANCE_RESOLUTION_OPTIONS = ['480p', '720p', 'native1080p', 'native4K', '1080p', '2k', '4k'] as const;
export const SEEDANCE_NZ_RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '2k', '4k'] as const;
export const SEEDANCE_NZ_NATIVE_RESOLUTION_OPTIONS = [...SEEDANCE_NZ_RESOLUTION_OPTIONS, 'native1080p', 'native4k'] as const;
export const SEEDANCE_DURATION_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const SEEDANCE_NZ_DURATION_OPTIONS = [-1, ...SEEDANCE_DURATION_OPTIONS] as const;

export const SEEDANCE25_MODEL_OPTIONS = [
  { value: 'seedance-2.5-global-standard-i2v', label: '全球 Standard · 图生视频' },
  { value: 'seedance-2.5-global-standard-multi', label: '全球 Standard · 多模态参考' },
  { value: 'seedance-2.5-global-standard-t2v', label: '全球 Standard · 文生视频' },
  { value: 'seedance-2.5-standard-i2v', label: '国内 Standard · 图生视频' },
  { value: 'seedance-2.5-standard-multi', label: '国内 Standard · 多模态参考' },
  { value: 'seedance-2.5-standard-t2v', label: '国内 Standard · 文生视频' },
  ...flashContract.models.map(value => ({value, label:value})),
] as const;
export const SEEDANCE25_DURATION_OPTIONS = [-1, ...Array.from({ length: 27 }, (_, index) => index + 4)] as const;
export const SEEDANCE25_RATIO_OPTIONS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
export const SEEDANCE25_RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '2k', '4k', 'native1080p'] as const;
export const SEEDANCE25_DEFAULT_DURATION = 5;
export const SEEDANCE25_DEFAULT_RESOLUTION = '720p';
export const SEEDANCE25_REFERENCE_MIN_SECONDS = 2;
export const SEEDANCE25_REFERENCE_MAX_SECONDS = 30;
export const SEEDANCE25_REFERENCE_TOTAL_SECONDS = 30;
export const SEEDANCE25_MULTI_MAX_IMAGES = 30;
export const SEEDANCE25_MULTI_MAX_VIDEOS = 10;
export const SEEDANCE25_MULTI_MAX_AUDIOS = 10;
export const SEEDANCE25_MULTI_MAX_TOTAL = 50;
export type Seedance25TaskType = 't2v' | 'i2v' | 'multi';

export function seedance25TaskType(model: unknown): Seedance25TaskType | null {
  const value = String(model || '').trim();
  if (!SEEDANCE25_MODEL_OPTIONS.some((item) => item.value === value)) return null;
  if (value.endsWith('-t2v')) return 't2v';
  if (value.endsWith('-i2v')) return 'i2v';
  return 'multi';
}

export type SeedanceBuiltinSource = 'auto' | 'seedance-nz' | 'zhenzhen-legacy';

export function isSeedanceBuiltinSource(value: unknown): value is SeedanceBuiltinSource {
  return value === 'auto' || value === 'seedance-nz' || value === 'zhenzhen-legacy';
}

export function isSeedanceNzStandardModel(value: unknown): boolean {
  return /(^|-)standard$/.test(String(value || ''));
}
