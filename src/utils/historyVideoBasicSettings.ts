import contract from '../../backend/src/shared/generationHistoryInputContract.json';
import topazContract from '../../backend/src/shared/topazVideoContract.json';

const requiredStrings = ['mainId', 'model', 'videoBuiltinSource', 'ratio', 'resolution',
  'providerSource', 'providerId', 'providerModel'] as const;
const requiredNumbers = ['duration', 'seed'] as const;
export const VIDEO_HISTORY_EXTRA_FIELDS: Record<string, { label: string; type: 'boolean' | 'string' | 'number' | 'number-or-api-default' }> = {
  topazQuality: { label: 'Topaz 修复模型', type: 'string' },
  viduQ4IsRec: { label: 'Vidu Q4 is_rec', type: 'boolean' },
  viduQ4Watermark: { label: 'Vidu Q4 watermark', type: 'boolean' },
  soraPrivate: { label: 'Sora 私密模式', type: 'boolean' },
  enhancePrompt: { label: '提示词增强', type: 'boolean' },
  enableUpsample: { label: '视频超采样', type: 'boolean' },
  vfRatio: { label: 'FAL Veo 比例', type: 'string' }, vfDuration: { label: 'FAL Veo 时长', type: 'string' },
  vfResolution: { label: 'FAL Veo 分辨率', type: 'string' }, vfAudio: { label: 'FAL Veo 生成声音', type: 'boolean' },
  vfSafety: { label: 'FAL Veo 安全容忍度', type: 'number' },
  gkfMode: { label: 'FAL Grok 生成模式', type: 'string' }, gkfRatio: { label: 'FAL Grok 比例', type: 'string' },
  gkfDuration: { label: 'FAL Grok 时长', type: 'number' }, gkfResolution: { label: 'FAL Grok 分辨率', type: 'string' },
  soraMode: { label: 'FAL Sora 生成模式', type: 'string' }, soraRatio: { label: 'FAL Sora 比例', type: 'string' },
  soraDuration: { label: 'FAL Sora 时长', type: 'number' }, soraResolution: { label: 'FAL Sora 分辨率', type: 'string' },
  soraDeleteVideo: { label: 'FAL Sora Delete Video', type: 'boolean' }, soraBlockIp: { label: 'FAL Sora Block IP', type: 'boolean' },
  apimartOmniLowpriceMode: { label: '平价 Omni 生成模式', type: 'string' },
  apimartOmniLowpriceNsfwCheck: { label: '平价 Omni 内容检查', type: 'boolean' },
  generateAudio: { label: '生成声音', type: 'boolean' }, returnLastFrame: { label: '返回尾帧', type: 'boolean' },
  klingNegativePrompt: { label: 'Kling 负面提示词', type: 'string' },
  viduSeed: { label: 'Vidu 种子设置', type: 'number' }, viduScriptName: { label: 'Vidu 剧本名称', type: 'string' },
  viduStyle: { label: 'Vidu 风格', type: 'string' }, viduAssetType: { label: 'Vidu 资产类型', type: 'string' },
  viduAssetNamePrefix: { label: 'Vidu 资产名称前缀', type: 'string' }, viduAssetDescription: { label: 'Vidu 资产描述', type: 'string' },
  flux3Draft: { label: 'FLUX 草稿模式', type: 'boolean' }, flux3AudioMode: { label: 'FLUX 声音模式', type: 'string' },
  flux3SafetyTolerance: { label: 'FLUX 安全容忍度', type: 'number-or-api-default' },
  wanNegativePrompt: { label: 'Wan 负面提示词', type: 'string' }, wanPromptExtend: { label: 'Wan 提示词扩展', type: 'boolean' },
  wanSeed: { label: 'Wan 2.7 种子设置', type: 'number' }, wan30Seed: { label: 'Wan 3.0 种子设置', type: 'number' },
  wan30EnableThinking: { label: 'Wan 3.0 思考模式', type: 'boolean' },
  minimaxH3FirstFrameEnabled: { label: 'H3 使用首帧', type: 'boolean' }, minimaxH3LastFrameEnabled: { label: 'H3 使用尾帧', type: 'boolean' },
  minimaxH3DriveAudioEnabled: { label: 'H3 使用驱动音频', type: 'boolean' }, minimaxH3AudioMode: { label: 'H3 音频模式', type: 'string' },
  minimaxH3DenoiseStrength: { label: 'H3 降噪强度', type: 'number' }, minimaxH3AddDriveAsReference: { label: 'H3 驱动音频同时作为参考', type: 'string' },
};
const allowed = new Set<string>([...requiredStrings, ...requiredNumbers, 'size', ...Object.keys(VIDEO_HISTORY_EXTRA_FIELDS)]);
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));

// In-place parameter restoration only: keep the raw local prompt and current
// reference bindings. Common context does not prove all branch-specific inputs.
export function historyVideoBasicSettings(data: Record<string, unknown>): Record<string, string | number | boolean> | undefined {
  const input = data.historyResolvedInput;
  if (input === undefined) return undefined;
  const invalid = () => new Error('历史实际输入版本或字段不完整，未套用当前默认值');
  if (!plain(input) || input.schema !== contract.videoInputContextSchema || input.origin !== 'frontend-common-context'
    || typeof input.prompt !== 'string' || !plain(input.basicSettings)
    || ['localRefImages', 'localRefVideos', 'localRefAudios'].some(key => !Array.isArray(input[key])
      || (input[key] as unknown[]).some(value => typeof value !== 'string'))) throw invalid();
  const settings = input.basicSettings;
  if (requiredStrings.some(key => !Object.hasOwn(settings, key) || typeof settings[key] !== 'string')
    || requiredNumbers.some(key => !Object.hasOwn(settings, key) || typeof settings[key] !== 'number' || !Number.isFinite(settings[key]))
    || Object.keys(settings).some(key => !allowed.has(key)
      || (Object.hasOwn(VIDEO_HISTORY_EXTRA_FIELDS, key) && (VIDEO_HISTORY_EXTRA_FIELDS[key].type === 'number-or-api-default'
        ? settings[key] !== 'api_default' && (typeof settings[key] !== 'number' || ![0, 1, 2, 3, 4].includes(settings[key] as number))
        : typeof settings[key] !== VIDEO_HISTORY_EXTRA_FIELDS[key].type))
      || (typeof settings[key] === 'number' && !Number.isFinite(settings[key])))
    || !['zhenzhen', 'seedance-nz'].includes(settings.videoBuiltinSource as string)
    || (Object.hasOwn(settings, 'topazQuality') && !topazContract.qualities.includes(settings.topazQuality as string))
    // Only the standard Grok New branch currently captures this optional field.
    // An absent legacy value stays absent; never derive it from today's ratio.
    || (Object.hasOwn(settings, 'size') && !['1280x720', '720x1280'].includes(settings.size as string))
    || (Object.hasOwn(settings, 'minimaxH3DenoiseStrength') && ((settings.minimaxH3DenoiseStrength as number) < 0 || (settings.minimaxH3DenoiseStrength as number) > 1))
    || (Object.hasOwn(settings, 'minimaxH3AudioMode') && !['api_default', 'lock_source', 'remix_source', 'reference_only', 'native'].includes(settings.minimaxH3AudioMode as string))
    || (Object.hasOwn(settings, 'minimaxH3AddDriveAsReference') && !['api_default', 'true', 'false'].includes(settings.minimaxH3AddDriveAsReference as string))
    || (settings.providerSource !== 'zhenzhen' && (!settings.providerSource || !settings.providerId || !settings.providerModel))) throw invalid();
  return { ...settings } as Record<string, string | number | boolean>;
}
