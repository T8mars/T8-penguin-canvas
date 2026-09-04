const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('node:net');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const tls = require('tls');
const { Agent, fetch: undiciFetch } = require('undici');
const config = require('../config');
const {
  isT8LocalMediaPath,
  mimeFromPath,
  normalizeT8LocalMediaRef,
  resolveMediaRef,
} = require('./mediaResolver');
const { providerTrace } = require('./providerTrace');
const {
  resolveTunPublicDns,
  safeRemoteMediaFetch,
} = require('../utils/safeRemoteMediaFetch');
const { providerIdempotencyHeaders } = require('../services/providerSubmissionContext');
const { resolveBundledFfprobe } = require('./llmMedia');
const { withFfmpegProcessSlot } = require('../utils/ffmpegProcessQueue');

const PROVIDER_ID = 'seedance-nz';
const BASE_URL = config.ZHENZHEN_SD2_BASE_URL;
const TASK_TYPES = new Set(['t2v', 'i2v', 'multi']);
const TIERS = new Set(['standard', 'fast', 'mini']);
const RATIOS = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
const RESOLUTIONS = new Set(['480p', '720p', '1080p', '2k', '4k', 'native1080p', 'native4k']);
const SEEDANCE25_T2V_MODELS = new Set([
  'seedance-2.5-global-standard-t2v',
  'seedance-2.5-standard-t2v',
]);
const SEEDANCE25_I2V_MODELS = new Set([
  'seedance-2.5-global-standard-i2v',
  'seedance-2.5-standard-i2v',
]);
const SEEDANCE25_MULTI_MODELS = new Set([
  'seedance-2.5-global-standard-multi',
  'seedance-2.5-standard-multi',
]);
const SEEDANCE25_MODELS = new Set([
  ...SEEDANCE25_T2V_MODELS,
  ...SEEDANCE25_I2V_MODELS,
  ...SEEDANCE25_MULTI_MODELS,
]);
const SEEDANCE25_RESOLUTIONS = new Set(['480p', '720p', '1080p', '2k', '4k', 'native1080p']);
const SEEDANCE25_PROMPT_MAX_LENGTH = 20480;
const SEEDANCE25_DEFAULT_SECONDS = 5;
const SEEDANCE25_DEFAULT_RESOLUTION = '720p';
const SEEDANCE25_REFERENCE_MIN_SECONDS = 2;
const SEEDANCE25_REFERENCE_MAX_SECONDS = 30;
const SEEDANCE25_REFERENCE_TOTAL_SECONDS = 30;
const SEEDANCE25_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
const SEEDANCE25_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const SEEDANCE25_IMAGE_MIMES = Object.freeze(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const SEEDANCE25_VIDEO_MIMES = Object.freeze(['video/mp4']);
const SEEDANCE25_AUDIO_MIMES = Object.freeze(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave']);
const SEEDANCE25_MULTI_LIMITS = Object.freeze({
  images: 30,
  videos: 10,
  audios: 10,
  total: 50,
});
const IMAGE_MODEL_PAIRS = {
  domestic: ['seedream-v5-pro-t2i', 'seedream-v5-pro-i2i'],
  overseas: ['dola-seedream-5.0-pro-t2i', 'dola-seedream-5.0-pro-i2i'],
};
const ZHENZHEN_IMAGE_G2_T2I_MODEL = 'zhenzhen-image-g2-t2i';
const ZHENZHEN_IMAGE_G2_I2I_MODEL = 'zhenzhen-image-g2-i2i';
const ZHENZHEN_IMAGE_G2_MODELS = new Set([
  ZHENZHEN_IMAGE_G2_T2I_MODEL,
  ZHENZHEN_IMAGE_G2_I2I_MODEL,
]);
const ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL = 'zhenzhen-image-g-v2-lowprice';
const ZHENZHEN_IMAGE_GK_V2_MODEL = 'zhenzhen-image-gk-v2';
const ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL = 'zhenzhen-image-gk-v2-edit';
const ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL = 'zhenzhen-image-gk-v2-segment';
const ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL = 'zhenzhen-image-gk-v2-region-edit';
const ZHENZHEN_IMAGE_GK_V15_MODEL = 'zhenzhen-image-gk-v15';
const ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL = 'zhenzhen-image-gk-v15-edit';
const ZHENZHEN_IMAGE_NB_2_LITE_MODEL = 'zhenzhen-image-nb-2-lite';
const ZHENZHEN_IMAGE_NB_2_MODEL = 'zhenzhen-image-nb-2';
const ZHENZHEN_IMAGE_NB_PRO_MODEL = 'zhenzhen-image-nb-pro';
const ZHENZHEN_IMAGE_NB_MODELS = new Set([
  ZHENZHEN_IMAGE_NB_2_LITE_MODEL,
  ZHENZHEN_IMAGE_NB_2_MODEL,
  ZHENZHEN_IMAGE_NB_PRO_MODEL,
]);
const ZHENZHEN_APIMART_IMAGE_MODELS = new Set([
  ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL,
  ZHENZHEN_IMAGE_GK_V2_MODEL,
  ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL,
  ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V15_MODEL,
  ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL,
  ...ZHENZHEN_IMAGE_NB_MODELS,
]);
const QWEN_IMAGE_30_T2I_MODELS = new Set([
  'qwen-image-3.0-t2i',
  'qwen-image-3.0-pro-t2i',
  'qwen-image-3.0-global-t2i',
  'qwen-image-3.0-global-pro-t2i',
]);
const QWEN_IMAGE_30_I2I_MODELS = new Set([
  'qwen-image-3.0-i2i',
  'qwen-image-3.0-pro-i2i',
  'qwen-image-3.0-global-i2i',
  'qwen-image-3.0-global-pro-i2i',
]);
const QWEN_IMAGE_30_MODELS = new Set([
  'qwen-image-3.0-t2i',
  'qwen-image-3.0-i2i',
  'qwen-image-3.0-pro-t2i',
  'qwen-image-3.0-pro-i2i',
  'qwen-image-3.0-global-t2i',
  'qwen-image-3.0-global-i2i',
  'qwen-image-3.0-global-pro-t2i',
  'qwen-image-3.0-global-pro-i2i',
]);
const QWEN_IMAGE_30_SIZING_MODES = new Set(['auto', 'ratio', 'custom_size']);
const QWEN_IMAGE_30_RESOLUTIONS = new Set(['1k', '2k']);
const QWEN_IMAGE_30_RATIOS = new Set([
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
]);
const QWEN_IMAGE_30_PROMPT_MIN_LENGTH = 5;
const QWEN_IMAGE_30_PROMPT_MAX_LENGTH = 2000;
const QWEN_IMAGE_30_MAX_REFERENCE_IMAGES = 3;
const ZHENZHEN_IMAGE_GK_V2_EDIT_RATIOS = new Set([
  'auto', '16:9', '19.5:9', '1:1', '1:2', '20:9', '2:1',
  '2:3', '3:2', '3:4', '4:3', '9:16', '9:19.5', '9:20',
]);
const ZHENZHEN_IMAGE_GK_V2_EDIT_RESOLUTIONS = new Set(['1k', '2k']);
const ZHENZHEN_IMAGE_GK_V2_EDIT_MAX_IMAGES = 3;
const WAN27_GLOBAL_T2I_MODEL = 'wan-2.7-global-t2i';
const WAN27_GLOBAL_I2I_MODEL = 'wan-2.7-global-i2i';
const WAN27_GLOBAL_I2I_PRO_MODEL = 'wan-2.7-global-i2i-pro';
const WAN27_GLOBAL_I2I_MODELS = new Set([WAN27_GLOBAL_I2I_MODEL, WAN27_GLOBAL_I2I_PRO_MODEL]);
const WAN27_GLOBAL_IMAGE_MODELS = new Set([
  WAN27_GLOBAL_T2I_MODEL,
  ...WAN27_GLOBAL_I2I_MODELS,
]);
const WAN27_GLOBAL_T2I_PROMPT_MAX_LENGTH = 5000;
const WAN27_GLOBAL_I2I_PROMPT_MAX_LENGTH = 2048;
const WAN27_GLOBAL_MAX_REFERENCE_IMAGES = 9;
const SEEDREAM_LAYER_DECOMPOSITION_MODEL = 'seedream-v5-pro-layer-decomposition';
const DOLA_SEEDREAM_LAYER_DECOMPOSITION_MODEL = 'dola-seedream-5.0-pro-layer-decomposition';
const SEEDREAM_LAYER_DECOMPOSITION_MODELS = new Set([
  SEEDREAM_LAYER_DECOMPOSITION_MODEL,
  DOLA_SEEDREAM_LAYER_DECOMPOSITION_MODEL,
]);
const SEEDREAM_LAYER_RESOLUTIONS = new Set(['auto', '1k', '1.5k', '2k']);
const SEEDREAM_LAYER_OUTPUT_FORMATS = new Set(['jpeg', 'png']);
const SEEDREAM_LAYER_PROMPT_MAX_LENGTH = 2000;
const SEEDREAM_LAYER_SOURCE_MAX_BYTES = 30 * 1024 * 1024;
const ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL = 'zhenzhen-video-g-omni-flash';
const ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL = 'zhenzhen-video-g-omni-flash-lowprice';
const ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL = 'zhenzhen-video-g-omni-1.1-flash-lowprice';
const ZHENZHEN_VIDEO_GK_V15_MODEL = 'zhenzhen-video-gk-v15';
const ZHENZHEN_VIDEO_V31_FAST_MODEL = 'zhenzhen-video-v31-fast';
const ZHENZHEN_VIDEO_V31_QUALITY_MODEL = 'zhenzhen-video-v31-quality';
const ZHENZHEN_VIDEO_V31_LITE_MODEL = 'zhenzhen-video-v31-lite';
const ZHENZHEN_APIMART_VIDEO_MODELS = new Set([
  ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL,
  ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL,
  ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL,
  ZHENZHEN_VIDEO_GK_V15_MODEL,
  ZHENZHEN_VIDEO_V31_FAST_MODEL,
  ZHENZHEN_VIDEO_V31_QUALITY_MODEL,
  ZHENZHEN_VIDEO_V31_LITE_MODEL,
]);
const ZHENZHEN_APIMART_GK_RATIOS = new Set(['1:1', '16:9', '9:16', '3:2', '2:3']);
const ZHENZHEN_IMAGE_NB_STANDARD_RATIOS = new Set([
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
]);
const ZHENZHEN_IMAGE_NB_EXTREME_RATIOS = new Set([
  '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1',
  '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9',
]);
const ZHENZHEN_APIMART_VEO_RATIOS = new Set(['16:9', '9:16']);
const ZHENZHEN_APIMART_VEO_RESOLUTIONS = new Set(['720p', '1080p', '4k']);
const HUNYUAN3D_TEXT_MODEL = 'hunyuan3d-v3.1-text-to-3d';
const HUNYUAN3D_IMAGE_MODEL = 'hunyuan3d-v3.1-image-to-3d';
const HUNYUAN3D_MODELS = new Set([HUNYUAN3D_TEXT_MODEL, HUNYUAN3D_IMAGE_MODEL]);
const HUNYUAN3D_GENERATE_TYPES = new Set(['Normal', 'Geometry', 'Sketch']);
const WHISPER_MODEL = 'whisper-1';
const WHISPER_RESPONSE_FORMATS = new Set(['json', 'verbose_json', 'srt', 'text', 'vtt']);
const WHISPER_FILE_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.mp4', '.ogg', '.opus', '.aac', '.aiff', '.aif']);
const WHISPER_MAX_SEGMENTS = 2000;
const WHISPER_MAX_SEGMENT_TEXT_LENGTH = 4000;
const WHISPER_MAX_SEGMENT_TEXT_TOTAL = 1_000_000;
const ZHENZHEN_IMAGE_G2_RATIOS = new Set(RATIOS);
const IMAGE_MODELS = new Set([
  ...Object.values(IMAGE_MODEL_PAIRS).flat(),
  ...ZHENZHEN_IMAGE_G2_MODELS,
  ...ZHENZHEN_APIMART_IMAGE_MODELS,
  ...QWEN_IMAGE_30_MODELS,
  ...WAN27_GLOBAL_IMAGE_MODELS,
  ...SEEDREAM_LAYER_DECOMPOSITION_MODELS,
]);
const IMAGE_RESOLUTIONS = new Set(['1k', '2k']);
const IMAGE_OUTPUT_FORMATS = new Set(['jpeg', 'png']);
const HAPPYHORSE_MODELS = new Set([
  'happyhorse-1.1-t2v',
  'happyhorse-1.1-i2v',
  'happyhorse-1.1-r2v',
]);
const HAPPYHORSE_RESOLUTIONS = new Set(['720p', '1080p']);
const WAN27_SPICY_MODEL = 'wan-2.7-spicy-i2v';
const WAN27_SPICY_RESOLUTIONS = new Set(['720p', '1080p']);
const WAN30_I2V_MODELS = new Set([
  'wan-3.0-i2v',
  'wan-3.0-global-i2v',
  'wan-3.0-prime-i2v',
  'wan-3.0-global-prime-i2v',
]);
const WAN30_R2V_MODELS = new Set([
  'wan-3.0-r2v',
  'wan-3.0-global-r2v',
  'wan-3.0-prime-r2v',
  'wan-3.0-global-prime-r2v',
]);
const WAN30_MODELS = new Set([...WAN30_I2V_MODELS, ...WAN30_R2V_MODELS]);
const WAN30_THINKING_MODELS = new Set(['wan-3.0-global-i2v', 'wan-3.0-global-r2v']);
const WAN30_SECONDS = new Set(['auto', ...Array.from({ length: 29 }, (_, index) => String(index + 2))]);
const WAN30_RESOLUTIONS = new Set(['480P', '720P', '1080P']);
const WAN30_RATIOS = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']);
const WAN30_PROMPT_MAX_LENGTH = 20000;
const WAN30_MAX_IMAGES = 10;
const WAN30_MAX_VIDEOS = 5;
const WAN30_MAX_AUDIOS = 5;
const KLING_T2V_MODELS = new Set([
  'kling-v3.0-std-t2v',
  'kling-v3.0-pro-t2v',
  'kling-v3-turbo-std-t2v',
  'kling-v3-turbo-pro-t2v',
  'kling-v3-4k-t2v',
  'kling-o3-std-t2v',
  'kling-o3-pro-t2v',
  'kling-o3-4k-t2v',
]);
const KLING_I2V_MODELS = new Set([
  'kling-v3.0-std-i2v',
  'kling-v3.0-pro-i2v',
  'kling-v3-turbo-std-i2v',
  'kling-v3-turbo-pro-i2v',
  'kling-v3-4k-i2v',
  'kling-o3-std-i2v',
  'kling-o3-pro-i2v',
  'kling-o3-4k-i2v',
]);
const KLING_R2V_MODELS = new Set([
  'kling-o3-std-r2v',
  'kling-o3-pro-r2v',
  'kling-o3-4k-r2v',
]);
const KLING_EDIT_MODELS = new Set([
  'kling-o3-std-edit',
  'kling-o3-pro-edit',
]);
const KLING_VIDEO_MODELS = new Set([...KLING_T2V_MODELS, ...KLING_I2V_MODELS, ...KLING_R2V_MODELS]);
const KLING_MODELS = new Set([...KLING_VIDEO_MODELS, ...KLING_EDIT_MODELS]);
const KLING_SECONDS = new Set(['5', '10']);
const KLING_PROMPT_MAX_LENGTH = 20480;
const KLING_MAX_REFERENCE_IMAGES = 4;
const ZHENZHEN_UPSCALER_MODEL = 'zhenzhen-upscaler';
const ZHENZHEN_UPSCALER_RESOLUTIONS = new Set(['720p', '1080p', '2k', '4k']);
const FASHVSR_VIDEO_UPSCALE_MODEL = 'FlashVSR_video_upscale';
const LEGACY_FASHVSR_VIDEO_UPSCALE_MODEL = 'FashVSR_video_upscale';
const FASHVSR_MIN_SECONDS = 3;
const FASHVSR_MAX_SECONDS = 15;
const HAILUO23_T2V_MODELS = new Set([
  'hailuo-2.3-t2v-standard',
  'hailuo-2.3-t2v-pro',
]);
const HAILUO23_I2V_MODELS = new Set([
  'hailuo-2.3-i2v-standard',
  'hailuo-2.3-i2v-pro',
  'hailuo-2.3-fast-i2v',
  'hailuo-2.3-fast-pro-i2v',
]);
const HAILUO23_MODELS = new Set([...HAILUO23_T2V_MODELS, ...HAILUO23_I2V_MODELS]);
const HAILUO23_RESOLUTIONS = new Set(['768p', '1080p']);
const HAILUO23_SECONDS = new Set(['6', '10']);
const HAILUO23_PROMPT_MAX_LENGTH = 2000;
const HAILUO23_MIN_IMAGE_SHORT_EDGE = 301;
const HAILUO23_MIN_ASPECT_RATIO = 2 / 5;
const HAILUO23_MAX_ASPECT_RATIO = 5 / 2;
const HAILUO_H3_T2V_MODEL = 'hailuo-h3-t2v';
const HAILUO_H3_I2V_MODEL = 'hailuo-h3-i2v';
const HAILUO_H3_MULTI_MODEL = 'hailuo-h3-multi';
const HAILUO_H3_GLOBAL_T2V_MODEL = 'hailuo-h3-global-t2v';
const HAILUO_H3_GLOBAL_I2V_MODEL = 'hailuo-h3-global-i2v';
const HAILUO_H3_GLOBAL_MULTI_MODEL = 'hailuo-h3-global-multi';
const HAILUO_H3_MAX_T2V_MODEL = 'hailuo-h3-max-t2v';
const HAILUO_H3_MAX_I2V_MODEL = 'hailuo-h3-max-i2v';
const HAILUO_H3_MAX_TURBO_T2V_MODEL = 'hailuo-h3-max-turbo-t2v';
const HAILUO_H3_MAX_TURBO_I2V_MODEL = 'hailuo-h3-max-turbo-i2v';
const HAILUO_H3_MAX_T2V_MODELS = new Set([
  HAILUO_H3_MAX_T2V_MODEL,
  HAILUO_H3_MAX_TURBO_T2V_MODEL,
]);
const HAILUO_H3_MAX_I2V_MODELS = new Set([
  HAILUO_H3_MAX_I2V_MODEL,
  HAILUO_H3_MAX_TURBO_I2V_MODEL,
]);
const HAILUO_H3_MAX_TURBO_MODELS = new Set([
  HAILUO_H3_MAX_TURBO_T2V_MODEL,
  HAILUO_H3_MAX_TURBO_I2V_MODEL,
]);
const HAILUO_H3_MAX_MODELS = new Set([
  ...HAILUO_H3_MAX_T2V_MODELS,
  ...HAILUO_H3_MAX_I2V_MODELS,
]);
const HAILUO_H3_T2V_MODELS = new Set([HAILUO_H3_T2V_MODEL, HAILUO_H3_GLOBAL_T2V_MODEL]);
const HAILUO_H3_I2V_MODELS = new Set([HAILUO_H3_I2V_MODEL, HAILUO_H3_GLOBAL_I2V_MODEL]);
const HAILUO_H3_MULTI_MODELS = new Set([HAILUO_H3_MULTI_MODEL, HAILUO_H3_GLOBAL_MULTI_MODEL]);
const HAILUO_H3_MODELS = new Set([
  ...HAILUO_H3_T2V_MODELS,
  ...HAILUO_H3_I2V_MODELS,
  ...HAILUO_H3_MULTI_MODELS,
]);
const MINMAX_H3_CONTEXT_IR_TEXT_MODEL = 'minmax-h3-context-ir-text';
const MINMAX_H3_CONTEXT_IR_IMAGE_MODEL = 'minmax-h3-context-ir-image';
const MINMAX_H3_CONTEXT_IR_MULTIMODAL_MODEL = 'minmax-h3-context-ir-multimodal';
const MINMAX_H3_CONTEXT_IR_MODELS = new Set([
  MINMAX_H3_CONTEXT_IR_TEXT_MODEL,
  MINMAX_H3_CONTEXT_IR_IMAGE_MODEL,
  MINMAX_H3_CONTEXT_IR_MULTIMODAL_MODEL,
]);
const MINMAX_H3_CONTEXT_IR_SECONDS = new Set(
  Array.from({ length: 12 }, (_, index) => String(index + 4)),
);
const MINMAX_H3_CONTEXT_IR_TEXT_RATIOS = new Set([
  '21:9', '16:9', '4:3', '1:1', '3:4', '9:16',
]);
const MINMAX_H3_CONTEXT_IR_MULTIMODAL_RATIOS = new Set([
  'adaptive', ...MINMAX_H3_CONTEXT_IR_TEXT_RATIOS,
]);
const MINMAX_H3_CONTEXT_IR_PROMPT_MAX_LENGTH = 7000;
const MINMAX_H3_CONTEXT_IR_MAX_IMAGES = 9;
const MINMAX_H3_CONTEXT_IR_MAX_VIDEOS = 3;
const MINMAX_H3_CONTEXT_IR_MAX_AUDIOS = 3;
const MINIMAX_H3_OW_T2V_MODEL = 'minimax-h3-ow-t2v';
const MINIMAX_H3_OW_R2V_MODEL = 'minimax-h3-ow-r2v';
const MINIMAX_H3_OW_I2V_MODEL = 'minimax-h3-ow-i2v';
const MINIMAX_H3_OW_FAST_I2V_MODEL = 'minimax-h3-ow-i2v-fast';
const MINIMAX_H3_OW_FAST_R2V_MODEL = 'minimax-h3-ow-r2v-fast';
const MINIMAX_H3_OW_FAST_REF2VA_AUDIO_MODEL = 'minimax-h3-ow-ref2va-audio-drive-fast';
const MINIMAX_H3_OW_FAST_FL2VA_AUDIO_MODEL = 'minimax-h3-ow-fl2va-audio-drive-fast';
const MINIMAX_H3_OW_FAST_T2V_MODEL = 'minimax-h3-ow-t2v-fast';
const MINIMAX_H3_OW_T2V_MODELS = new Set([
  MINIMAX_H3_OW_T2V_MODEL,
  MINIMAX_H3_OW_FAST_T2V_MODEL,
]);
const MINIMAX_H3_OW_AUDIO_DRIVE_MODELS = new Set([
  MINIMAX_H3_OW_FAST_REF2VA_AUDIO_MODEL,
  MINIMAX_H3_OW_FAST_FL2VA_AUDIO_MODEL,
]);
const MINIMAX_H3_OW_R2V_MODELS = new Set([
  MINIMAX_H3_OW_R2V_MODEL,
  MINIMAX_H3_OW_FAST_R2V_MODEL,
]);
const MINIMAX_H3_OW_I2V_MODELS = new Set([
  MINIMAX_H3_OW_I2V_MODEL,
  MINIMAX_H3_OW_FAST_I2V_MODEL,
]);
const MINIMAX_H3_OW_FAST_MODELS = new Set([
  MINIMAX_H3_OW_FAST_I2V_MODEL,
  MINIMAX_H3_OW_FAST_R2V_MODEL,
  MINIMAX_H3_OW_FAST_REF2VA_AUDIO_MODEL,
  MINIMAX_H3_OW_FAST_FL2VA_AUDIO_MODEL,
  MINIMAX_H3_OW_FAST_T2V_MODEL,
]);
const MINIMAX_H3_OW_MODELS = new Set([
  MINIMAX_H3_OW_T2V_MODEL,
  MINIMAX_H3_OW_R2V_MODEL,
  MINIMAX_H3_OW_I2V_MODEL,
  MINIMAX_H3_OW_FAST_I2V_MODEL,
  MINIMAX_H3_OW_FAST_R2V_MODEL,
  MINIMAX_H3_OW_FAST_REF2VA_AUDIO_MODEL,
  MINIMAX_H3_OW_FAST_FL2VA_AUDIO_MODEL,
  MINIMAX_H3_OW_FAST_T2V_MODEL,
]);
const MINIMAX_H3_OW_SECONDS = new Set(['5', '10', '15']);
const MINIMAX_H3_OW_RESOLUTIONS = new Set(['480p', '720p']);
const MINIMAX_H3_OW_RATIOS = new Set([
  '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9',
]);
const HAILUO_MODELS = new Set([
  ...HAILUO23_MODELS,
  ...HAILUO_H3_MODELS,
  ...HAILUO_H3_MAX_MODELS,
  ...MINIMAX_H3_OW_MODELS,
]);
const HAILUO_H3_SECONDS = new Set(Array.from({ length: 11 }, (_, index) => String(index + 5)));
const HAILUO_H3_RESOLUTIONS = new Set(['768P', '2K']);
const HAILUO_H3_MAX_STANDARD_RESOLUTIONS = new Set(['480P', '768P']);
const HAILUO_H3_MAX_TURBO_RESOLUTIONS = new Set(['480p', '768p']);
const HAILUO_H3_MAX_RESOLUTIONS = new Set([
  ...HAILUO_H3_MAX_STANDARD_RESOLUTIONS,
  ...HAILUO_H3_MAX_TURBO_RESOLUTIONS,
]);
const HAILUO_H3_MAX_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
const HAILUO_H3_PROMPT_MAX_LENGTH = 20480;
const HAILUO_H3_MAX_REFERENCE_IMAGES = 9;
const HAILUO_H3_MAX_REFERENCE_VIDEOS = 3;
const HAILUO_H3_MAX_REFERENCE_AUDIOS = 3;
const FLUX3_T2V_MODELS = new Set(['flux-3-video-t2v', 'flux-3-video-global-t2v']);
const FLUX3_I2V_MODELS = new Set(['flux-3-video-i2v', 'flux-3-video-global-i2v']);
const FLUX3_V2V_MODELS = new Set(['flux-3-video-v2v', 'flux-3-video-global-v2v']);
const FLUX3_DRAFT_ENHANCE_MODELS = new Set([
  'flux-3-video-draft-enhance',
  'flux-3-video-global-draft-enhance',
]);
const FLUX3_VIDEO_MODELS = new Set([
  ...FLUX3_T2V_MODELS,
  ...FLUX3_I2V_MODELS,
  ...FLUX3_V2V_MODELS,
  ...FLUX3_DRAFT_ENHANCE_MODELS,
]);
const FLUX3_SECONDS = new Set(Array.from({ length: 16 }, (_, index) => String(index + 5)));
const FLUX3_RESOLUTIONS = new Set(['hd', 'fhd']);
const FLUX3_RATIOS = new Set(['auto', '21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16']);
const FLUX3_MAX_REFERENCE_IMAGES = 10;
const FLUX3_PROMPT_MAX_LENGTH = 20480;
const FLUX3_DRAFT_CACHE_MAX_LENGTH = 262144;
const VIDU_Q3_T2V_MODELS = new Set([
  'vidu-q3-pro-t2v',
  'vidu-q3-turbo-t2v',
  'vidu-q3-pro-fast-t2v',
]);
const VIDU_Q3_I2V_MODELS = new Set([
  'vidu-q3-pro-i2v',
  'vidu-q3-turbo-i2v',
  'vidu-q3-pro-fast-i2v',
]);
const VIDU_Q3_START_END_MODELS = new Set([
  'vidu-q3-pro-start-end',
  'vidu-q3-turbo-start-end',
  'vidu-q3-pro-fast-start-end',
]);
const VIDU_Q3_R2V_MODELS = new Set([
  'vidu-q3-r2v',
  'vidu-q3-mix-r2v',
  'vidu-q3-ad-r2v',
  'vidu-q3-drama-r2v',
]);
const VIDU_Q3_SHORT_PLAY_MODELS = new Set([
  'vidu-q3-drama-short-play',
  'vidu-q3-ad-short-play',
]);
const VIDU_Q3_VIDEO_MODELS = new Set([
  ...VIDU_Q3_T2V_MODELS,
  ...VIDU_Q3_I2V_MODELS,
  ...VIDU_Q3_START_END_MODELS,
  ...VIDU_Q3_R2V_MODELS,
]);
const VIDU_Q3_MODELS = new Set([...VIDU_Q3_VIDEO_MODELS, ...VIDU_Q3_SHORT_PLAY_MODELS]);
const VIDU_Q3_SECONDS = new Set(Array.from({ length: 12 }, (_, index) => String(index + 4)));
const VIDU_Q3_RESOLUTIONS = new Set(['default', '720p', '1080p']);
const VIDU_Q3_SHORT_PLAY_DURATIONS = new Set(['8', '9', '10', '11', '12']);
const VIDU_Q3_SHORT_PLAY_ASPECT_RATIOS = new Set(['9:16', '16:9']);
const VIDU_Q3_SHORT_PLAY_ASSET_TYPES = new Set(['character', 'scene', 'prop']);
const VIDU_Q3_PROMPT_MAX_LENGTH = 20480;
const VIDU_Q3_MAX_REFERENCE_IMAGES = 9;
const VIDU_Q3_MAX_SHORT_PLAY_ASSETS = 14;
const SEED_AUDIO_MODEL = 'doubao-seed-audio-1.0';
const SEED_AUDIO_FORMATS = new Set(['wav', 'mp3', 'pcm', 'ogg_opus']);
const SEED_AUDIO_SAMPLE_RATES = new Set(['8000', '16000', '24000', '32000', '44100']);
const QWEN3_TTS_FLASH_MODEL = 'qwen3-tts-flash';
const QWEN3_TTS_INSTRUCT_FLASH_MODEL = 'qwen3-tts-instruct-flash';
const QWEN3_TTS_MODELS = new Set([QWEN3_TTS_FLASH_MODEL, QWEN3_TTS_INSTRUCT_FLASH_MODEL]);
const QWEN3_TTS_LANGUAGE_TYPES = new Set([
  'Chinese', 'English', 'Japanese', 'Korean', 'German',
  'French', 'Russian', 'Portuguese', 'Spanish', 'Italian',
]);
const MINIMAX_MUSIC_MODEL = 'minimax-music-2.6';
const MINIMAX_SPEECH_HD_MODEL = 'minimax-speech-2.8-hd';
const MINIMAX_SPEECH_TURBO_MODEL = 'minimax-speech-2.8-turbo';
const MINIMAX_VOICE_CLONE_MODEL = 'minimax-voice-clone';
const MINIMAX_SPEECH_MODELS = new Set([MINIMAX_SPEECH_HD_MODEL, MINIMAX_SPEECH_TURBO_MODEL]);
const MINIMAX_AUDIO_MODELS = new Set([
  MINIMAX_MUSIC_MODEL,
  ...MINIMAX_SPEECH_MODELS,
  MINIMAX_VOICE_CLONE_MODEL,
]);
const MINIMAX_AUDIO_FORMATS = new Set(['mp3', 'wav', 'flac']);
const MINIMAX_SAMPLE_RATES = new Set(['16000', '24000', '32000', '44100']);
const MINIMAX_BITRATES = new Set(['32000', '64000', '128000', '256000']);
const MINIMAX_LANGUAGE_BOOSTS = new Set([
  'auto', 'Chinese', 'Chinese,Yue', 'English', 'Japanese', 'Korean',
  'French', 'German', 'Spanish', 'Portuguese', 'Russian',
]);
const MUREKA_BGM_MODELS = new Set(['mureka-v8-bgm', 'mureka-v9-bgm']);
const FLOWMUSIC_MODEL = 'flowmusic';
const FLOWMUSIC_VERSIONS = new Set(['default', 'lyria-3.5']);
const FLOWMUSIC_FORMATS = new Set(['mp3', 'wav']);
const FLOWMUSIC_VIDEO_PRESETS = new Set(['simple', 'modern', 'player']);
const flowMusicActionSpec = (action, allowedFields, requiredFields, resultFamily, supportsLyria35 = false) => Object.freeze({
  action,
  allowedFields: Object.freeze(allowedFields),
  requiredFields: Object.freeze(requiredFields),
  resultFamily,
  supportsLyria35,
});
const FLOWMUSIC_ACTION_SPECS = Object.freeze({
  'flowmusic-generation': flowMusicActionSpec('', ['version', 'sound_prompt', 'lyrics', 'title', 'bpm', 'length', 'seed'], [], 'audio', true),
  'flowmusic-lyrics': flowMusicActionSpec('lyrics', ['prompt'], ['prompt'], 'text'),
  'flowmusic-upload-audio': flowMusicActionSpec('upload-audio', ['audio_url'], ['audio_url'], 'audio'),
  'flowmusic-extend': flowMusicActionSpec('extend', ['version', 'clip_id', 'extend_from_s', 'extend_s', 'instruction', 'title', 'seed'], ['clip_id', 'extend_from_s', 'extend_s', 'instruction'], 'audio', true),
  'flowmusic-replace': flowMusicActionSpec('replace', ['version', 'clip_id', 'start_s', 'end_s', 'instruction', 'title', 'seed'], ['clip_id', 'start_s', 'end_s', 'instruction'], 'audio', true),
  'flowmusic-cover': flowMusicActionSpec('cover', ['version', 'clip_id', 'instruction', 'strength', 'title', 'seed'], ['clip_id', 'instruction', 'strength'], 'audio', true),
  'flowmusic-stems': flowMusicActionSpec('stems', ['clip_id'], ['clip_id'], 'file'),
  'flowmusic-download-audio': flowMusicActionSpec('download-audio', ['clip_id', 'format'], ['clip_id', 'format'], 'audio'),
  'flowmusic-video-clip': flowMusicActionSpec('video-clip', ['clip_id', 'preset'], ['clip_id', 'preset'], 'video'),
});
const SEEDANCE_NZ_AUDIO_MODELS = new Set([
  SEED_AUDIO_MODEL,
  ...QWEN3_TTS_MODELS,
  ...MINIMAX_AUDIO_MODELS,
  ...MUREKA_BGM_MODELS,
]);
const SUNO_VERSIONS = Object.freeze(['v3.5', 'v4', 'v4.5', 'v4.5+', 'v4.5-all', 'v5', 'v5.5']);
const SUNO_INSPO_VERSIONS = Object.freeze(['v4', 'v4.5', 'v4.5+', 'v4.5-all', 'v5', 'v5.5']);
const SUNO_REPLACE_VERSIONS = Object.freeze(['v4', 'v4.5+', 'v5', 'v5.5']);
const SUNO_REMASTER_VERSIONS = Object.freeze(['v4.5+', 'v5', 'v5.5']);
const SUNO_V5_VERSIONS = Object.freeze(['v5', 'v5.5']);
const SUNO_MAX_REFERENCE_AUDIOS = 4;
const MIDJOURNEY_SPEEDS = new Set(['relax', 'fast', 'turbo']);
const MIDJOURNEY_VERSIONS = new Set(['5', '5.1', '5.2', '6', '6.1', '7', '8.1', '8.2']);
const MIDJOURNEY_DIMENSIONS = new Set(['SQUARE', 'PORTRAIT', 'LANDSCAPE']);
const MIDJOURNEY_QUALITIES = new Set(['0.25', '0.5', '1', '2']);
const MIDJOURNEY_DIRECTIONS = new Set(['left', 'right', 'up', 'down']);
const MIDJOURNEY_VIDEO_TYPES = new Set([
  'vid_1.1_i2v_480',
  'vid_1.1_i2v_720',
  'vid_1.1_i2v_start_end_480',
  'vid_1.1_i2v_start_end_720',
]);
const MIDJOURNEY_ANIMATE_MODES = new Set(['manual', 'auto']);
const MIDJOURNEY_MOTIONS = new Set(['low', 'high']);
const MIDJOURNEY_BATCH_SIZES = new Set([1, 2, 4]);
const MIDJOURNEY_STRUCTURED_FIELDS = Object.freeze([
  'size',
  'quality',
  'style',
  'version',
  'seed',
  'negative_prompt',
  'stylize',
  'chaos',
  'weird',
  'tile',
  'niji',
  'iw',
  'cw',
  'sw',
  'cref',
  'sref',
  'dref',
  'dw',
  'repeat',
  'raw',
  'draft',
  'hd',
  'stop',
  'extra',
]);
const midjourneyActionSpec = (
  action,
  executionMode,
  requiredFields,
  requiredOneOf,
  allowedFields,
  resultFamily,
) => Object.freeze({
  action,
  executionMode,
  requiredFields: Object.freeze(requiredFields),
  requiredOneOf: Object.freeze(requiredOneOf.map((group) => Object.freeze(group))),
  allowedFields: Object.freeze(allowedFields),
  resultFamily,
});
const MIDJOURNEY_ACTION_SPECS = Object.freeze({
  'midjourney-imagine': midjourneyActionSpec(
    'imagine',
    'async',
    ['prompt'],
    [],
    ['prompt', 'image_urls', 'speed', 'metadata', ...MIDJOURNEY_STRUCTURED_FIELDS],
    'image',
  ),
  'midjourney-blend': midjourneyActionSpec(
    'blend',
    'async',
    ['image_urls'],
    [],
    ['image_urls', 'dimensions', 'size', 'speed', 'metadata'],
    'image',
  ),
  'midjourney-describe': midjourneyActionSpec(
    'describe',
    'sync_or_async',
    ['image_urls'],
    [],
    ['image_urls', 'speed', 'metadata'],
    'text',
  ),
  'midjourney-edits': midjourneyActionSpec(
    'edits',
    'async',
    ['prompt', 'image_urls'],
    [],
    ['prompt', 'image_urls', 'speed', 'metadata', ...MIDJOURNEY_STRUCTURED_FIELDS],
    'image',
  ),
  'midjourney-upscale': midjourneyActionSpec(
    'upscale',
    'async',
    ['task_id'],
    [['index', 'custom_id']],
    ['task_id', 'index', 'custom_id', 'speed', 'metadata'],
    'image',
  ),
  'midjourney-variation': midjourneyActionSpec(
    'variation',
    'async',
    ['task_id'],
    [['index', 'custom_id']],
    ['task_id', 'index', 'custom_id', 'speed', 'metadata'],
    'image',
  ),
  'midjourney-high-variation': midjourneyActionSpec(
    'high-variation',
    'async',
    ['task_id'],
    [['index', 'custom_id']],
    ['task_id', 'index', 'custom_id', 'speed', 'metadata'],
    'image',
  ),
  'midjourney-low-variation': midjourneyActionSpec(
    'low-variation',
    'async',
    ['task_id'],
    [['index', 'custom_id']],
    ['task_id', 'index', 'custom_id', 'speed', 'metadata'],
    'image',
  ),
  'midjourney-reroll': midjourneyActionSpec(
    'reroll',
    'async',
    ['task_id'],
    [],
    ['task_id', 'custom_id', 'speed', 'metadata'],
    'image',
  ),
  'midjourney-zoom': midjourneyActionSpec(
    'zoom',
    'async',
    ['task_id'],
    [],
    ['task_id', 'index', 'custom_id', 'zoom_ratio', 'speed', 'metadata'],
    'image',
  ),
  'midjourney-pan': midjourneyActionSpec(
    'pan',
    'async',
    ['task_id'],
    [['direction', 'custom_id']],
    ['task_id', 'index', 'direction', 'custom_id', 'speed', 'metadata'],
    'image',
  ),
  'midjourney-inpaint': midjourneyActionSpec(
    'inpaint',
    'modal_stage',
    ['task_id'],
    [],
    ['task_id', 'index', 'custom_id', 'speed', 'metadata'],
    'modal',
  ),
  'midjourney-modal': midjourneyActionSpec(
    'modal',
    'async',
    ['task_id'],
    [],
    ['task_id', 'prompt', 'mask_url', 'speed', 'metadata'],
    'image',
  ),
  'midjourney-video': midjourneyActionSpec(
    'video',
    'async',
    [],
    [['image_urls', 'task_id']],
    ['prompt', 'image_urls', 'task_id', 'index', 'video_type', 'animate_mode', 'motion', 'batch_size', 'end_url'],
    'video',
  ),
  'midjourney-remix-strong': midjourneyActionSpec(
    'remix-strong',
    'async',
    ['task_id', 'index'],
    [],
    ['task_id', 'index', 'prompt', 'speed'],
    'image',
  ),
  'midjourney-remix-subtle': midjourneyActionSpec(
    'remix-subtle',
    'async',
    ['task_id', 'index'],
    [],
    ['task_id', 'index', 'prompt', 'speed'],
    'image',
  ),
});
const sunoActionSpec = (
  action,
  requiredFields,
  allowedFields,
  resultFamily,
  referenceType = 'none',
  allowedVersions = [],
  defaultVersion = '',
  sync = false,
) => Object.freeze({
  action,
  requiredFields: Object.freeze(requiredFields),
  allowedFields: Object.freeze(allowedFields),
  resultFamily,
  referenceType,
  allowedVersions: Object.freeze(allowedVersions),
  defaultVersion,
  sync,
});
const SUNO_ACTION_SPECS = Object.freeze({
  'suno-generation': sunoActionSpec('', ['version', 'prompt'], ['version', 'prompt', 'custom', 'instrumental', 'title', 'style', 'vocal_gender'], 'audio', 'none', SUNO_VERSIONS),
  'suno-lyrics': sunoActionSpec('lyrics', ['prompt'], ['prompt'], 'text'),
  'suno-upload': sunoActionSpec('upload', ['audioFilePath'], ['audioFilePath'], 'audio', 'url'),
  'suno-extend': sunoActionSpec('extend', ['task_id', 'continue_at'], ['task_id', 'audio_index', 'continue_at', 'version'], 'audio', 'task_audio', SUNO_VERSIONS, 'v5.5'),
  'suno-cover-song': sunoActionSpec('cover-song', ['task_id', 'prompt'], ['task_id', 'audio_index', 'prompt', 'version'], 'audio', 'task_audio', SUNO_VERSIONS, 'v5.5'),
  'suno-inspo': sunoActionSpec('inspo', ['audio_urls'], ['audio_urls', 'version'], 'audio', 'url', SUNO_INSPO_VERSIONS, 'v5.5'),
  'suno-mashup': sunoActionSpec('mashup', ['task_ids', 'prompt'], ['task_ids', 'prompt', 'version'], 'audio', 'mashup', SUNO_VERSIONS, 'v5.5'),
  'suno-upsample-tags': sunoActionSpec('upsample-tags', ['tags'], ['tags'], 'text', 'none', [], '', true),
  'suno-sounds': sunoActionSpec('sounds', ['prompt'], ['prompt', 'version'], 'audio', 'none', SUNO_V5_VERSIONS, 'v5.5'),
  'suno-create-voice': sunoActionSpec('create-voice', ['audio_url'], ['audio_url'], 'text', 'url'),
  'suno-stems': sunoActionSpec('stems', ['task_id'], ['task_id', 'audio_index'], 'audio', 'task_audio'),
  'suno-stems-all': sunoActionSpec('stems-all', ['task_id'], ['task_id', 'audio_index'], 'audio', 'task_audio'),
  'suno-wav': sunoActionSpec('wav', ['task_id'], ['task_id', 'audio_index'], 'audio', 'task_audio'),
  'suno-generate-mp4': sunoActionSpec('generate-mp4', ['task_id'], ['task_id', 'audio_index'], 'video', 'task_audio'),
  'suno-concat': sunoActionSpec('concat', ['task_id'], ['task_id', 'audio_index'], 'audio', 'task_audio'),
  'suno-crop': sunoActionSpec('crop', ['task_id', 'start_s', 'end_s'], ['task_id', 'audio_index', 'start_s', 'end_s'], 'audio', 'task_audio'),
  'suno-fade-in': sunoActionSpec('fade-in', ['task_id', 'duration_s'], ['task_id', 'audio_index', 'duration_s'], 'audio', 'task_audio'),
  'suno-fade-out': sunoActionSpec('fade-out', ['task_id', 'duration_s'], ['task_id', 'audio_index', 'duration_s'], 'audio', 'task_audio'),
  'suno-remove-section': sunoActionSpec('remove-section', ['task_id', 'start_s', 'end_s'], ['task_id', 'audio_index', 'start_s', 'end_s'], 'audio', 'task_audio'),
  'suno-replace-music': sunoActionSpec('replace-music', ['task_id', 'start_s', 'end_s'], ['task_id', 'audio_index', 'start_s', 'end_s', 'version'], 'audio', 'task_audio', SUNO_REPLACE_VERSIONS, 'v5.5'),
  'suno-adjust-speed': sunoActionSpec('adjust-speed', ['task_id', 'speed'], ['task_id', 'audio_index', 'speed'], 'audio', 'task_audio'),
  'suno-remaster': sunoActionSpec('remaster', ['task_id'], ['task_id', 'audio_index', 'version'], 'audio', 'task_audio', SUNO_REMASTER_VERSIONS, 'v5.5'),
  'suno-midi': sunoActionSpec('midi', ['task_id'], ['task_id', 'audio_index'], 'file', 'task_audio'),
  'suno-bpm': sunoActionSpec('bpm', ['task_id'], ['task_id', 'audio_index'], 'text', 'task_audio'),
  'suno-aligned-lyrics': sunoActionSpec('aligned-lyrics', ['task_id'], ['task_id', 'audio_index'], 'text', 'task_audio'),
  'suno-persona': sunoActionSpec('persona', ['task_id', 'name'], ['task_id', 'audio_index', 'name'], 'text', 'task_audio'),
  'suno-vox': sunoActionSpec('vox', ['task_id'], ['task_id', 'audio_index'], 'audio', 'task_audio'),
  'suno-sample': sunoActionSpec('sample', ['task_id', 'start_s', 'end_s', 'prompt'], ['task_id', 'audio_index', 'prompt', 'start_s', 'end_s', 'version'], 'audio', 'task_audio', SUNO_VERSIONS, 'v5.5'),
  'suno-add-vocals': sunoActionSpec('add-vocals', ['task_id', 'prompt'], ['task_id', 'audio_index', 'prompt', 'version'], 'audio', 'task_audio', SUNO_V5_VERSIONS, 'v5.5'),
  'suno-add-instrumental': sunoActionSpec('add-instrumental', ['task_id', 'prompt'], ['task_id', 'audio_index', 'prompt', 'version'], 'audio', 'task_audio', SUNO_V5_VERSIONS, 'v5.5'),
  'suno-add-stem': sunoActionSpec('add-stem', ['task_id', 'prompt'], ['task_id', 'audio_index', 'prompt', 'version'], 'audio', 'task_audio', ['v5.5'], 'v5.5'),
});
const IMAGE_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_UPLOAD_INTERVAL_MS = 6100;
const DEFAULT_UPLOAD_CACHE_TTL_MS = 20 * 60 * 60 * 1000;
const DEFAULT_PROVIDER_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_PROVIDER_DEADLINE_MS = 30 * 1000;
const DEFAULT_PROVIDER_IDLE_TIMEOUT_MS = 10 * 1000;
const DEFAULT_PROVIDER_UPLOAD_DEADLINE_MS = 120 * 1000;
const DEFAULT_PROVIDER_UPLOAD_IDLE_TIMEOUT_MS = 30 * 1000;
const SAFE_DIAGNOSTIC_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,159}$/;
const SENSITIVE_DIAGNOSTIC_TOKEN = /(?:api[-_]?key|authorization|cookie|token|secret|password|credential)/i;

// api.seedance.nz currently serves the new Let's Encrypt Generation Y chain.
// Electron's Node 20 CA bundle predates Root YR, so trust the official pinned
// root for this provider only while retaining normal hostname/signature checks.
// Source: https://letsencrypt.org/certs/gen-y/root-yr.pem
const LETS_ENCRYPT_ROOT_YR = `-----BEGIN CERTIFICATE-----
MIIFKTCCAxGgAwIBAgIRAOxGNJNgz0sP+KmC2Tqpyj0wDQYJKoZIhvcNAQELBQAw
LjELMAkGA1UEBhMCVVMxDTALBgNVBAoTBElTUkcxEDAOBgNVBAMTB1Jvb3QgWVIw
HhcNMjUwOTAzMDAwMDAwWhcNNDUwOTAyMjM1OTU5WjAuMQswCQYDVQQGEwJVUzEN
MAsGA1UEChMESVNSRzEQMA4GA1UEAxMHUm9vdCBZUjCCAiIwDQYJKoZIhvcNAQEB
BQADggIPADCCAgoCggIBANvGJnN78CTJdWL3+eGfsLN5TrNBJs+VH9hRXqRbwxu9
sGNiB0BD1fcOxbSUQCJIM1xE13Db+5Cw1w0s0EBYsvuIP/6joF0w8cuImbgR1OGg
YbSQ4OpzI+DG8SGuTlcE873OCS+kh3srlo6vl43M5OJg4Aeo1sfHp6kTJDoIiFBN
JAY+OKfX/FUvYKuhjT+no49lmqmupSBI5PkBQiqrEGtWU5uxU/cQWHGu8jSjFBzn
ZqvbNPLMXMLFxCb3WTfrJBXXjqvWG+v4bjzxjjeAtOlU7qarRDvNOyAuQYLln904
M+faKx8hnLCpJ15ZqaEgcNlY+9MMWcC5yvL2A2j3l9+2buggZX+dOE91zYmIdawT
vSZuVvlbRrAlLxIB6pwMBjneXCjYQ8+3BCCjssbSNpZU3hTcBDdhfAlEDlYr6pEa
tnMdmDT5BqnKC92bd0EhM1fbLHioLccLCuievT8ZkPhZrq7Mii7gNXAcUEAR8+lz
Yal+9zTg7C5DALyVOeG/CqfRAMn1KSHCR0NSA6P8tn/mGRlnCct5rtVCLnVySVpU
6H1qGg3DgTOuskf8eahTMiYbI5ezPJmO5ertalskQ1utp74+eDy92PI4ftHKTbq9
IWhH4YZKh3WnJEIt+oQvlYZbY8tpEroKrFB6PFGzrJIDRyts4HqvuH52RFj2zv/B
AgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1Ud
DgQWBBTe51tg0CJtQCh9Pw0B/qS1UrRRlDANBgkqhkiG9w0BAQsFAAOCAgEAWHnf
713Bdkq7t5yN2dNIgQakUb94X9WuyhMEHHkgx4oDpSUlnG0w4g94MoqaEUE31ZjR
LU7L5LD1g9ujFHTQu8AD215AHMVQFbm6j8hQxdXHAzDajFNQnOlDJrLjzIx176oy
AjvUtejZx2NNmdb5fd0WGVGsCdoAJ3N8ozo7ajE8t6vfxStZb4BQ9WYJGHUDrv2N
i5tJF6CNiPnlzs3BUfECRbE4JSk+jvy8+VoGiFE8qsH/j78x2fjgQhAQFV7P7Zxy
dBTZ1wEkNpZNW2qnaK1SKBLa+xf6E06YRIq5uaI+HWH8SY1y5VbRgzq40EKg3yxP
06fz+uYAUIFJoLNfhwRCc3Q6pQVuMX3yAjHAes4gk4moGcLQ5p7HAh39yeylZc1J
41sx/jKwLIkPE6Rr1Nf4pxdsxf9SA4yOEiAkDgq04DVxn8hgYFdUtBCuiuVC2heA
EiqVEa+8QZjuw8Gj0EbHXcRd1nInvGqRS1o9Is7YBdQN57X1AYveGBNNqjICSb7c
awuw1EawTDrs13VUlJVEsbQ0/O/1aaV73mCdOQ8azqL2KTv1Ewu1xbquE2S+kdQU
To9TUwat3wUA6cwXh1EfpS/3fJ0aGah5hdpRyoCLDlsSn8tkrjMfFFX0viC+GxHc
sI1ANRYvqSFC2X1VRZfDg+wD6E21BccmifG4yWc=
-----END CERTIFICATE-----`;
const seedanceDispatcher = new Agent({
  // Never carry an API socket across TUN/VPN route changes.
  pipelining: 0,
  connectTimeout: 15_000,
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 250,
  connect: {
    ca: [...tls.rootCertificates, LETS_ENCRYPT_ROOT_YR],
    rejectUnauthorized: true,
  },
});
function seedancePublicDnsLookup(
  hostname,
  options,
  callback,
  resolvePublicDns = resolveTunPublicDns,
) {
  const literalFamily = net.isIP(String(hostname || ''));
  if (literalFamily) {
    if (options?.all === true) {
      callback(null, [{ address: String(hostname), family: literalFamily }]);
    } else {
      callback(null, String(hostname), literalFamily);
    }
    return;
  }
  resolvePublicDns(hostname)
    .then((records) => {
      const candidates = [...records].sort((left, right) => {
        if (Number(left?.family) === Number(right?.family)) return 0;
        return Number(left?.family) === 4 ? -1 : 1;
      });
      if (!candidates.length) {
        callback(Object.assign(new Error('公共 DNS 未返回可用地址'), {
          code: 'TUN_DNS_FALLBACK_FAILED',
        }));
        return;
      }
      if (options?.all === true) {
        callback(null, candidates);
        return;
      }
      callback(null, candidates[0].address, candidates[0].family);
    })
    .catch((error) => callback(error));
}
const seedancePublicDnsDispatcher = new Agent({
  pipelining: 0,
  connectTimeout: 15_000,
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 250,
  connect: {
    ca: [...tls.rootCertificates, LETS_ENCRYPT_ROOT_YR],
    rejectUnauthorized: true,
    lookup: seedancePublicDnsLookup,
  },
});

const uploadCache = new Map();
const uploadQueues = new Map();
const responseBoundaries = new WeakMap();

function seedanceNetworkCause(error) {
  let current = error;
  let depth = 0;
  while (current?.cause && current.cause !== current && depth < 8) {
    current = current.cause;
    depth += 1;
  }
  return current || error;
}

function seedanceRetryIsKnownPreRequestFailure(error) {
  const cause = seedanceNetworkCause(error);
  const code = String(cause?.code || error?.code || '').trim().toUpperCase();
  const message = String(cause?.message || error?.message || '');
  return [
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ].includes(code) || /certificate|self signed|unable to verify|issuer cert/i.test(message);
}

async function secureFetch(url, init = {}) {
  const method = String(init?.method || 'GET').toUpperCase();
  const request = {
    ...init,
    headers: providerIdempotencyHeaders(init?.headers, method),
  };
  try {
    // Preserve the runtime/system network path first. This is the behavior
    // users had before Provider-specific dispatchers were introduced and it
    // keeps transparent TUN/VPN routing, system DNS and working IPv6 intact.
    return await fetch(url, request);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    const safeRead = ['GET', 'HEAD'].includes(method);
    const stableSubmission = Boolean(headerValue(request.headers, 'idempotency-key'));
    // TLS trust can fail before an HTTP request exists on older Electron CA
    // bundles. That case is safe to retry with the provider-pinned CA even
    // when a legacy caller has no submission key.
    if (!safeRead && !stableSubmission && !seedanceRetryIsKnownPreRequestFailure(error)) {
      throw error;
    }
    try {
      return await undiciFetch(url, {
        ...request,
        dispatcher: seedanceDispatcher,
      });
    } catch (recoveryError) {
      if (!safeRead || init?.signal?.aborted) throw recoveryError;
      // Public DNS is the final read-only fallback only. Generation writes
      // never bypass the active system/TUN resolver and are never duplicated.
      return undiciFetch(url, {
        ...request,
        dispatcher: seedancePublicDnsDispatcher,
      });
    }
  }
}

function getFetchImpl(options = {}) {
  return options.fetchImpl || secureFetch;
}

function cleanBaseUrl(value) {
  return String(value || BASE_URL).trim().replace(/\/+$/, '');
}

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
}

function boundedPositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}

function providerBoundaryOptions(options = {}) {
  return {
    maxResponseBytes: boundedPositiveInteger(
      options.providerMaxResponseBytes ?? options.maxResponseBytes,
      DEFAULT_PROVIDER_RESPONSE_MAX_BYTES,
      64 * 1024 * 1024,
    ),
    deadlineMs: boundedPositiveInteger(
      options.providerDeadlineMs ?? options.deadlineMs,
      DEFAULT_PROVIDER_DEADLINE_MS,
      10 * 60 * 1000,
    ),
    idleTimeoutMs: boundedPositiveInteger(
      options.providerIdleTimeoutMs ?? options.idleTimeoutMs,
      DEFAULT_PROVIDER_IDLE_TIMEOUT_MS,
      10 * 60 * 1000,
    ),
  };
}

function providerUploadBoundaryOptions(options = {}) {
  return {
    ...options,
    providerDeadlineMs: boundedPositiveInteger(
      options.providerUploadDeadlineMs ?? options.providerDeadlineMs ?? options.deadlineMs,
      DEFAULT_PROVIDER_UPLOAD_DEADLINE_MS,
      10 * 60 * 1000,
    ),
    providerIdleTimeoutMs: boundedPositiveInteger(
      options.providerUploadIdleTimeoutMs ?? options.providerIdleTimeoutMs ?? options.idleTimeoutMs,
      DEFAULT_PROVIDER_UPLOAD_IDLE_TIMEOUT_MS,
      10 * 60 * 1000,
    ),
  };
}

function retryableProviderUploadError(error) {
  // A timeout, abort, unavailable connection, or 5xx response can occur after
  // the Provider has accepted the multipart body. Replaying such an ambiguous
  // upload risks creating duplicate remote files. Only an explicit 429 is a
  // safe, response-confirmed instruction to retry the upload.
  return error?.code === 'SEEDANCE_UPSTREAM_ERROR' && Number(error?.status) === 429;
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '').trim();
  const normalized = String(name).toLowerCase();
  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => String(key).toLowerCase() === normalized);
    return String(entry?.[1] || '').trim();
  }
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === normalized);
  return String(entry?.[1] || '').trim();
}

function sensitiveValuesFromInit(init = {}) {
  const values = [];
  for (const name of ['authorization', 'x-api-key', 'api-key']) {
    const value = headerValue(init.headers, name);
    if (!value) continue;
    values.push(value);
    const withoutScheme = value.replace(/^(?:bearer|basic)\s+/i, '').trim();
    if (withoutScheme) values.push(withoutScheme);
  }
  return [...new Set(values.filter((value) => value.length >= 4))];
}

function containsSensitiveValue(value, sensitiveValues = []) {
  const text = String(value || '');
  return sensitiveValues.some((sensitive) => sensitive && text.includes(sensitive));
}

function safeDiagnosticToken(value, sensitiveValues = []) {
  const text = String(value || '').trim();
  if (!SAFE_DIAGNOSTIC_TOKEN.test(text)) return '';
  if (SENSITIVE_DIAGNOSTIC_TOKEN.test(text)) return '';
  if (containsSensitiveValue(text, sensitiveValues)) return '';
  return text;
}

function safeUsageValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key) || SENSITIVE_DIAGNOSTIC_TOKEN.test(key)) continue;
    const safeValue = safeUsageValue(item, depth + 1);
    if (safeValue !== undefined) output[key] = safeValue;
  }
  return Object.keys(output).length ? output : undefined;
}

function safeProviderTrace(response, data, extra = {}) {
  const unsafe = providerTrace(response, data, extra);
  const boundary = responseBoundaries.get(response);
  const sensitiveValues = boundary?.sensitiveValues || [];
  const requestId = safeDiagnosticToken(unsafe.requestId, sensitiveValues);
  const usage = safeUsageValue(unsafe.usage);
  return {
    ...(unsafe.upstreamHttpStatus ? { upstreamHttpStatus: unsafe.upstreamHttpStatus } : {}),
    ...(requestId ? { requestId } : {}),
    ...(usage ? { usage } : {}),
    ...(unsafe.pollCount !== undefined ? { pollCount: unsafe.pollCount } : {}),
  };
}

function safeUpstreamCode(data, sensitiveValues = []) {
  const candidates = [data?.error?.code, data?.code, data?.error_code, data?.errorCode];
  for (const candidate of candidates) {
    const code = safeDiagnosticToken(candidate, sensitiveValues);
    if (code) return code;
  }
  return '';
}

function boundaryError(message, code, status, trace = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, trace);
  return error;
}

function upstreamTimeoutError(label, response) {
  return boundaryError(
    `${label}上游响应超时`,
    'SEEDANCE_UPSTREAM_TIMEOUT',
    504,
    response ? safeProviderTrace(response, {}) : {},
  );
}

function upstreamUnavailableError(label, response) {
  return boundaryError(
    `${label}上游暂时不可用`,
    'SEEDANCE_UPSTREAM_UNAVAILABLE',
    502,
    response ? safeProviderTrace(response, {}) : {},
  );
}

function responseTooLargeError(label, response, maxBytes) {
  const error = boundaryError(
    `${label}响应超过大小上限`,
    'SEEDANCE_RESPONSE_TOO_LARGE',
    502,
    response ? safeProviderTrace(response, {}) : {},
  );
  error.maxBytes = maxBytes;
  return error;
}

function invalidResponseError(label, response, body) {
  const error = boundaryError(
    `${label}返回无效响应`,
    'SEEDANCE_INVALID_RESPONSE',
    502,
    response ? safeProviderTrace(response, {}) : {},
  );
  if (body) error.bodyDigest = `sha256:${crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)}`;
  return error;
}

function cancelBodyReader(reader, reason) {
  try {
    const cancellation = reader?.cancel?.(reason);
    Promise.resolve(cancellation).catch(() => {});
  } catch {}
}

function finishResponseBoundary(boundary) {
  if (!boundary || boundary.finished) return;
  boundary.finished = true;
  boundary.cleanup?.();
}

async function fetchProviderResponse(fetchImpl, url, init = {}, options = {}, label = 'seedance.nz 请求') {
  const limits = providerBoundaryOptions(options);
  const controller = new AbortController();
  const externalSignal = init?.signal || options?.signal;
  let externalAborted = externalSignal?.aborted === true;
  const forwardAbort = () => {
    externalAborted = true;
    controller.abort();
  };
  if (externalSignal?.addEventListener) {
    if (externalAborted) controller.abort();
    else externalSignal.addEventListener('abort', forwardAbort, { once: true });
  }

  const boundary = {
    controller,
    deadlineAt: Date.now() + limits.deadlineMs,
    idleTimeoutMs: limits.idleTimeoutMs,
    maxResponseBytes: limits.maxResponseBytes,
    sensitiveValues: sensitiveValuesFromInit(init),
    cleanup: () => externalSignal?.removeEventListener?.('abort', forwardAbort),
    finished: false,
  };
  let timer;
  let timedOut = false;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(upstreamTimeoutError(label));
      }, limits.deadlineMs);
    });
    const response = await Promise.race([
      Promise.resolve().then(() => fetchImpl(url, { ...init, signal: controller.signal })),
      timeout,
    ]);
    if (!response || typeof response !== 'object') {
      finishResponseBoundary(boundary);
      throw invalidResponseError(label);
    }
    responseBoundaries.set(response, boundary);
    return response;
  } catch (error) {
    finishResponseBoundary(boundary);
    if (timedOut || error?.code === 'SEEDANCE_UPSTREAM_TIMEOUT') throw upstreamTimeoutError(label);
    if (error?.code?.startsWith?.('SEEDANCE_')) throw error;
    if (externalAborted) {
      throw boundaryError(`${label}已取消`, 'SEEDANCE_REQUEST_ABORTED', 499);
    }
    throw upstreamUnavailableError(label);
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedResponse(response, label, maxBytesOverride) {
  const boundary = responseBoundaries.get(response) || {
    deadlineAt: Date.now() + DEFAULT_PROVIDER_DEADLINE_MS,
    idleTimeoutMs: DEFAULT_PROVIDER_IDLE_TIMEOUT_MS,
    maxResponseBytes: DEFAULT_PROVIDER_RESPONSE_MAX_BYTES,
    sensitiveValues: [],
    finished: false,
  };
  const maxBytes = boundedPositiveInteger(maxBytesOverride, boundary.maxResponseBytes, 64 * 1024 * 1024);
  const rawAdvertisedLength = response?.headers?.get?.('content-length');
  const advertisedLength = rawAdvertisedLength === null || rawAdvertisedLength === undefined || rawAdvertisedLength === ''
    ? null
    : Number(rawAdvertisedLength);
  const contentEncoding = String(response?.headers?.get?.('content-encoding') || '').trim().toLowerCase();
  const identityEncoded = !contentEncoding || contentEncoding === 'identity';
  const reader = response?.body?.getReader?.();

  if (advertisedLength !== null && (!Number.isSafeInteger(advertisedLength) || advertisedLength < 0)) {
    cancelBodyReader(reader, 'invalid content length');
    boundary.controller?.abort();
    finishResponseBoundary(boundary);
    throw invalidResponseError(label, response);
  }
  if (identityEncoded && Number.isFinite(advertisedLength) && advertisedLength >= 0 && advertisedLength > maxBytes) {
    cancelBodyReader(reader, 'response too large');
    boundary.controller?.abort();
    finishResponseBoundary(boundary);
    throw responseTooLargeError(label, response, maxBytes);
  }
  if (!reader) {
    finishResponseBoundary(boundary);
    if (advertisedLength > 0) throw invalidResponseError(label, response);
    return Buffer.alloc(0);
  }

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const remainingMs = boundary.deadlineAt - Date.now();
      if (remainingMs <= 0) throw upstreamTimeoutError(label, response);
      const waitMs = Math.max(1, Math.min(boundary.idleTimeoutMs, remainingMs));
      let timer;
      let timedOut = false;
      let result;
      try {
        result = await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              boundary.controller?.abort();
              reject(upstreamTimeoutError(label, response));
            }, waitMs);
          }),
        ]);
      } catch (error) {
        if (timedOut || error?.code === 'SEEDANCE_UPSTREAM_TIMEOUT') throw upstreamTimeoutError(label, response);
        if (error?.code?.startsWith?.('SEEDANCE_')) throw error;
        throw upstreamUnavailableError(label, response);
      } finally {
        clearTimeout(timer);
      }
      if (result.done) break;
      const chunk = result.value;
      if (!ArrayBuffer.isView(chunk)) throw invalidResponseError(label, response);
      const byteLength = Number(chunk?.byteLength ?? chunk?.length ?? 0);
      if (!Number.isFinite(byteLength) || byteLength < 0) throw invalidResponseError(label, response);
      if (totalBytes + byteLength > maxBytes) throw responseTooLargeError(label, response, maxBytes);
      if (byteLength > 0) {
        chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset || 0, byteLength));
        totalBytes += byteLength;
      }
    }
    // Chromium/system proxies may legally normalize transfer encodings while
    // preserving an upstream Content-Length that no longer matches the
    // decoded body. The byte ceiling above remains authoritative; JSON callers
    // still reject truncated bodies during parsing, so an exact equality check
    // here only creates false negatives for otherwise complete responses.
    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    cancelBodyReader(reader, error?.code || 'response rejected');
    boundary.controller?.abort();
    throw error;
  } finally {
    finishResponseBoundary(boundary);
  }
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function normalizeResolution(value) {
  const raw = String(value || '720p').trim();
  const normalized = raw.toLowerCase() === 'native4k' ? 'native4k' : raw;
  if (!RESOLUTIONS.has(normalized)) {
    throw new Error(`seedance.nz 不支持分辨率 ${raw}`);
  }
  return normalized;
}

function normalizeRatio(value) {
  const ratio = String(value || '16:9').trim();
  if (!RATIOS.has(ratio)) throw new Error(`seedance.nz 不支持比例 ${ratio}`);
  return ratio;
}

function normalizeSeconds(value) {
  const raw = String(value ?? '5').trim();
  const seconds = Number(raw);
  if (raw === '-1') return '-1';
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > 15) {
    throw new Error('seedance.nz 时长只支持 4-15 秒或 -1 自动时长');
  }
  return String(seconds);
}

function normalizeSeedance25Seconds(value) {
  const raw = String(value ?? SEEDANCE25_DEFAULT_SECONDS).trim();
  if (raw === '-1') return -1;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > 30) {
    throw new Error('Seedance 2.5 时长只支持 4-30 秒或 -1 自动时长');
  }
  return seconds;
}

function normalizeHappyHorseSeconds(value) {
  const seconds = Number(String(value ?? '4').trim());
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) {
    throw new Error('Happy Horse 时长只支持 3-15 秒');
  }
  return String(seconds);
}

function normalizeWanSeconds(value) {
  const seconds = Number(String(value ?? '2').trim());
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 15) {
    throw new Error('Wan 2.7 Spicy 时长只支持 2-15 秒');
  }
  return String(seconds);
}

function normalizeBoundedInteger(value, name, min, max, fallback = 0) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 的整数`);
  }
  return parsed;
}

function normalizePromptMentions(prompt) {
  return String(prompt || '').replace(
    /@(image|video|audio)[_\s-]*(\d+)/gi,
    (_match, type, index) => `@${String(type).charAt(0).toUpperCase()}${String(type).slice(1).toLowerCase()} ${index}`,
  );
}

function parseModelFamily(selection) {
  const raw = String(selection || '').trim().toLowerCase();
  const exact = raw.match(/^seedance-2\.0-(global-)?(standard|fast|mini)(?:-(t2v|i2v|multi))?$/);
  if (exact) return { global: !!exact[1], tier: exact[2] };
  const global = raw.includes('global');
  const tier = raw.includes('mini') ? 'mini' : (raw.includes('fast') ? 'fast' : 'standard');
  return { global, tier };
}

function resolveModel(selection, taskType) {
  if (!TASK_TYPES.has(taskType)) throw new Error(`未知 Seedance 任务类型：${taskType}`);
  const family = parseModelFamily(selection);
  if (!TIERS.has(family.tier)) throw new Error(`未知 Seedance 模型档位：${family.tier}`);
  return `seedance-2.0-${family.global ? 'global-' : ''}${family.tier}-${taskType}`;
}

function deriveTaskType(request) {
  const hasFirst = !!String(request.firstFrame || '').trim();
  const hasLast = !!String(request.lastFrame || '').trim();
  const images = normalizeList(request.refImages);
  const videos = normalizeList(request.videos);
  const audios = normalizeList(request.audios);
  const hasExtraRefs = images.length > 0 || videos.length > 0 || audios.length > 0;

  if (hasLast && !hasFirst) throw new Error('末帧模式必须同时提供首帧');
  if ((hasFirst || hasLast) && hasExtraRefs) {
    throw new Error('首帧/首尾帧任务不能同时混入参考图、视频或音频；请切换“自动/多参”模式');
  }
  if (hasFirst) return 'i2v';
  if (hasExtraRefs) return 'multi';
  return 't2v';
}

function ensureMediaLimits(taskType, request) {
  if (taskType === 'i2v') {
    const count = [request.firstFrame, request.lastFrame].filter((item) => !!String(item || '').trim()).length;
    if (count < 1 || count > 2) throw new Error('i2v 任务只支持 1-2 张首尾帧图片');
    return;
  }
  if (taskType !== 'multi') return;
  const imageCount = normalizeList(request.refImages).length;
  const videoCount = normalizeList(request.videos).length;
  const audioCount = normalizeList(request.audios).length;
  if (imageCount > 9) throw new Error('multi 任务最多支持 9 张图片');
  if (videoCount > 3) throw new Error('multi 任务最多支持 3 个视频');
  if (audioCount > 3) throw new Error('multi 任务最多支持 3 个音频');
}

function defaultMime(kind) {
  if (kind === 'image') return 'image/png';
  if (kind === 'video') return 'video/mp4';
  if (kind === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

function extensionFromMime(mime, kind) {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/mp4': '.m4a',
  };
  return map[mime] || (kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : '.bin');
}

function maxBytesForKind(kind) {
  return (kind === 'image' ? 30 : 50) * 1024 * 1024;
}

function ensureSize(buffer, kind, maxBytes) {
  const max = Number(maxBytes) || maxBytesForKind(kind);
  if (buffer.length > max) {
    throw mediaTooLargeError(kind, max);
  }
}

function mediaTooLargeError(kind, maxBytes) {
  const error = new Error(`${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}超过 seedance.nz ${maxBytes / 1024 / 1024}MB 上限`);
  error.code = 'SEEDANCE_MEDIA_TOO_LARGE';
  error.status = 413;
  error.maxBytes = maxBytes;
  return error;
}

function readBoundedLocalFile(filePath, kind, maxBytes) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(descriptor).size;
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) throw mediaTooLargeError(kind, maxBytes);
    const buffer = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const bytesRead = fs.readSync(descriptor, buffer, offset, size - offset, offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;
    }
    const probe = Buffer.allocUnsafe(1);
    if (fs.readSync(descriptor, probe, 0, 1, offset) > 0) throw mediaTooLargeError(kind, maxBytes);
    return offset === size ? buffer : buffer.subarray(0, offset);
  } finally {
    fs.closeSync(descriptor);
  }
}

function mediaKindLabel(kind) {
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  if (kind === 'audio') return '音频';
  return '素材';
}

function localMediaUnavailableError(kind) {
  const label = mediaKindLabel(kind);
  return boundaryError(
    `参考${label}的本地文件不存在或无法读取。请删除失效素材后重新上传原${label}（错误码：SEEDANCE_MEDIA_REFERENCE_UNAVAILABLE）`,
    'SEEDANCE_MEDIA_REFERENCE_UNAVAILABLE',
    400,
  );
}

function normalizeRemoteMediaError(error, kind, maxBytes) {
  const label = mediaKindLabel(kind);
  if (error?.code === 'item_too_large') return mediaTooLargeError(kind, maxBytes);
  if (error?.code === 'fetch_timeout') {
    return boundaryError(
      `下载参考${label}超时。请检查网络和素材链接是否仍有效，或重新上传原${label}后重试（错误码：SEEDANCE_UPSTREAM_TIMEOUT）`,
      'SEEDANCE_UPSTREAM_TIMEOUT',
      504,
    );
  }
  if (error?.code === 'private_address') {
    return boundaryError(
      `参考${label}地址指向本机、局域网或受保护网络，已被安全校验拦截。请重新上传原${label}，或改用无需登录、可公开访问的 HTTPS ${label}直链（错误码：SEEDANCE_REMOTE_MEDIA_BLOCKED）`,
      'SEEDANCE_REMOTE_MEDIA_BLOCKED',
      400,
    );
  }
  if (error?.code === 'url_credentials_forbidden') {
    return boundaryError(
      `参考${label}网址包含账号或密码，已被安全校验拦截。请重新上传原${label}，或改用不含登录信息的公开 HTTPS ${label}直链（错误码：SEEDANCE_REMOTE_MEDIA_BLOCKED）`,
      'SEEDANCE_REMOTE_MEDIA_BLOCKED',
      400,
    );
  }
  if (error?.code === 'invalid_url' || error?.code === 'invalid_protocol') {
    return boundaryError(
      `参考${label}地址无效或不是 HTTP/HTTPS 链接。请重新上传原${label}，或改用可公开访问的 HTTPS ${label}直链（错误码：SEEDANCE_REMOTE_MEDIA_INVALID）`,
      'SEEDANCE_REMOTE_MEDIA_INVALID',
      400,
    );
  }
  const remoteStatus = Number(error?.status);
  if (error?.code === 'remote_http_error' && Number.isInteger(remoteStatus)) {
    return boundaryError(
      `下载参考${label}失败：素材服务器返回 HTTP ${remoteStatus}。链接可能已过期、需要登录或禁止外部访问；请重新上传原${label}后重试（错误码：SEEDANCE_REMOTE_MEDIA_HTTP_ERROR）`,
      'SEEDANCE_REMOTE_MEDIA_HTTP_ERROR',
      remoteStatus,
    );
  }
  return boundaryError(
    `下载参考${label}失败，远程地址当前无法访问。请检查网络和链接有效期，或重新上传原${label}后重试（错误码：SEEDANCE_REMOTE_MEDIA_UNAVAILABLE）`,
    'SEEDANCE_REMOTE_MEDIA_UNAVAILABLE',
    502,
  );
}

async function responseJson(response, label) {
  const body = await readBoundedResponse(response, label);
  const text = body.toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    // Gateways and CDN edges sometimes return branded HTML for a real 4xx/5xx.
    // Preserve the HTTP status without reflecting the untrusted body; callers
    // will normalize it through createUpstreamError immediately afterwards.
    if (response && response.ok === false) {
      return {
        __t8BodyDigest: `sha256:${crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)}`,
      };
    }
    throw invalidResponseError(label, response, body);
  }
}

function createUpstreamError(data, responseOrStatus) {
  const response = responseOrStatus && typeof responseOrStatus === 'object' ? responseOrStatus : null;
  const rawStatus = Number(response?.status ?? responseOrStatus);
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 502;
  const trace = response ? safeProviderTrace(response, data) : {};
  const sensitiveValues = responseBoundaries.get(response)?.sensitiveValues || [];
  const upstreamCode = safeUpstreamCode(data, sensitiveValues);
  const error = boundaryError(
    `seedance.nz 上游请求失败（HTTP ${status}）`,
    'SEEDANCE_UPSTREAM_ERROR',
    status,
    trace,
  );
  if (upstreamCode) error.upstreamCode = upstreamCode;
  if (/^sha256:[a-f0-9]{16}$/.test(String(data?.__t8BodyDigest || ''))) {
    error.bodyDigest = data.__t8BodyDigest;
  }
  return error;
}

function safeProgress(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  const text = String(value ?? '').trim();
  return /^\d{1,3}%?$/.test(text) ? text.slice(0, 4) : '';
}

function requiredTaskId(value, label, response) {
  const taskId = String(value || '').trim();
  const sensitiveValues = responseBoundaries.get(response)?.sensitiveValues || [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\-]{0,255}$/.test(taskId) || containsSensitiveValue(taskId, sensitiveValues)) {
    throw invalidResponseError(label, response);
  }
  return taskId;
}

function uploadUrlFromResponse(data) {
  return String(
    data?.url
    || data?.file_url
    || data?.fileUrl
    || data?.data?.url
    || data?.data?.file_url
    || data?.data?.fileUrl
    || data?.file?.url
    || '',
  ).trim();
}

async function sleep(ms, signal) {
  if (signal?.aborted) throw boundaryError('seedance.nz 请求已取消', 'SEEDANCE_REQUEST_ABORTED', 499);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      reject(boundaryError('seedance.nz 请求已取消', 'SEEDANCE_REQUEST_ABORTED', 499));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function withUploadQueue(apiKey, intervalMs, task, signal) {
  const queueKey = hashKey(apiKey);
  const state = uploadQueues.get(queueKey) || { tail: Promise.resolve(), lastAt: 0 };
  let release;
  const slot = new Promise((resolve) => { release = resolve; });
  const previous = state.tail.catch(() => {});
  state.tail = previous.then(() => slot);
  uploadQueues.set(queueKey, state);
  await previous;
  try {
    const waitMs = Math.max(0, Number(intervalMs || 0) - (Date.now() - state.lastAt));
    if (waitMs > 0) await sleep(waitMs, signal);
    return await task();
  } finally {
    state.lastAt = Date.now();
    release();
  }
}

async function mediaBuffer(source, kind, maxBytes, options = {}) {
  const text = normalizeT8LocalMediaRef(source);
  const dataMatch = text.match(/^data:([^;,]+);base64,(.+)$/i);
  if (dataMatch) {
    const max = Number(maxBytes) || maxBytesForKind(kind);
    const encoded = dataMatch[2].replace(/\s+/g, '');
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    const decodedBytes = Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
    if (decodedBytes > max) throw mediaTooLargeError(kind, max);
    const buffer = Buffer.from(encoded, 'base64');
    ensureSize(buffer, kind, maxBytes);
    return {
      buffer,
      mime: dataMatch[1] || defaultMime(kind),
      fileName: `seedance-${kind}${extensionFromMime(dataMatch[1], kind)}`,
    };
  }

  let resolved = null;
  try {
    resolved = await resolveMediaRef(text, { target: 'local-path' });
  } catch {
    // Remote references are resolved below. Controlled T8 mounts must be tried
    // locally first so /files/* never becomes an SSRF-prone loopback fetch.
    if (isT8LocalMediaPath(text)) throw localMediaUnavailableError(kind);
  }
  if (!resolved) {
    try {
      resolved = await resolveMediaRef(text, { target: 'url' });
    } catch {
      const label = mediaKindLabel(kind);
      throw boundaryError(
        `参考${label}引用无效。请删除该素材后重新上传原${label}（错误码：SEEDANCE_MEDIA_REFERENCE_INVALID）`,
        'SEEDANCE_MEDIA_REFERENCE_INVALID',
        400,
      );
    }
  }
  if (resolved.kind === 'local-path') {
    const max = Number(maxBytes) || maxBytesForKind(kind);
    let buffer;
    try {
      buffer = readBoundedLocalFile(resolved.path, kind, max);
    } catch (error) {
      if (error?.code === 'SEEDANCE_MEDIA_TOO_LARGE') throw error;
      throw localMediaUnavailableError(kind);
    }
    return {
      buffer,
      mime: resolved.mime || mimeFromPath(resolved.path, defaultMime(kind)),
      fileName: path.basename(resolved.name || resolved.path),
    };
  }

  const max = Number(maxBytes) || maxBytesForKind(kind);
  const limits = providerBoundaryOptions(options);
  let remote;
  try {
    remote = await safeRemoteMediaFetch(resolved.url, {
      protocols: ['http:', 'https:'],
      maxBytes: max,
      deadlineMs: limits.deadlineMs,
      idleTimeoutMs: limits.idleTimeoutMs,
      maxRedirects: options.remoteMaxRedirects,
      lookupImpl: options.lookupImpl,
      allowPrivateForTests: options.allowPrivateForTests,
      signal: options.signal,
    });
  } catch (error) {
    throw normalizeRemoteMediaError(error, kind, max);
  }
  const buffer = remote.buffer;
  const rawMime = String(remote.contentType || defaultMime(kind)).split(';')[0].trim().toLowerCase();
  const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(rawMime) ? rawMime : 'application/octet-stream';
  let fileName = `seedance-${kind}${extensionFromMime(mime, kind)}`;
  try {
    const remoteName = path.basename(new URL(remote.finalUrl).pathname).slice(0, 180);
    if (remoteName) fileName = remoteName;
  } catch {}
  return { buffer, mime, fileName };
}

async function uploadMedia(source, kind, apiKey, options = {}) {
  const text = normalizeT8LocalMediaRef(source);
  if (!text) throw new Error(`未收到参考${mediaKindLabel(kind)}，请重新选择或上传素材`);

  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const intervalMs = options.uploadIntervalMs ?? DEFAULT_UPLOAD_INTERVAL_MS;
  const ttlMs = options.uploadCacheTtlMs ?? DEFAULT_UPLOAD_CACHE_TTL_MS;
  const cacheEnabled = Number(ttlMs) > 0;
  const cacheKey = `${hashKey(apiKey)}:${kind}:${Number(options.maxBytes) || 0}:${String(options.cacheVariant || '')}:${hashKey(text)}`;
  const cached = cacheEnabled ? uploadCache.get(cacheKey) : null;
  if (cached && Date.now() - cached.createdAt < ttlMs) return cached.promise;

  const promise = withUploadQueue(apiKey, intervalMs, async () => {
    let file = await mediaBuffer(text, kind, options.maxBytes, options);
    if (kind === 'image' && options.normalizeImagePng === true) {
      const buffer = await sharp(file.buffer).png().toBuffer();
      ensureSize(buffer, kind, options.maxBytes);
      file = {
        ...file,
        buffer,
        mime: 'image/png',
        fileName: String(options.fileName || 'picture.png'),
      };
    }
    if (Array.isArray(options.allowedMimes) && !options.allowedMimes.includes(String(file.mime || '').toLowerCase())) {
      throw new Error(`seedance.nz 不支持该${kind}格式`);
    }
    if (typeof options.validateBuffer === 'function') {
      await options.validateBuffer(file.buffer, file);
    }
    const uploadBoundaryOptions = providerUploadBoundaryOptions(options);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const form = new FormData();
        form.append('file', new Blob([file.buffer], { type: file.mime }), file.fileName);
        const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/files/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        }, { ...uploadBoundaryOptions, signal: options.signal }, 'seedance.nz 文件上传');
        const data = await responseJson(response, 'seedance.nz 文件上传');
        if (!response.ok) {
          throw createUpstreamError(data, response);
        }
        const url = uploadUrlFromResponse(data);
        if (!url) throw new Error('seedance.nz 文件上传成功但未返回 URL');
        return url;
      } catch (error) {
        lastError = error;
        const retryable = retryableProviderUploadError(error);
        if (!retryable || attempt === 2) break;
        await sleep(1000 * (2 ** attempt), options.signal);
      }
    }
    throw lastError || new Error('seedance.nz 文件上传失败');
  }, options.signal);

  if (cacheEnabled) uploadCache.set(cacheKey, { createdAt: Date.now(), promise });
  try {
    return await promise;
  } catch (error) {
    if (cacheEnabled) uploadCache.delete(cacheKey);
    throw error;
  }
}

function midjourneyText(value) {
  return String(value ?? '').trim();
}

function midjourneyInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function midjourneyNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function midjourneyRequiredValuePresent(value) {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
}

function midjourneyMetadata(value) {
  if (value === undefined || value === null || value === '') return undefined;
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('Midjourney metadata 必须是有效的 JSON 对象');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Midjourney metadata 必须是 JSON 对象');
  }
  return parsed;
}

function validateMidjourneyStructuredCompatibility(payload) {
  const version = midjourneyText(payload.version);
  const niji = payload.niji === true;
  if (niji && version && !new Set(['5', '6', '7']).has(version)) {
    throw new Error('启用 niji 时，Midjourney version 只能为 5、6 或 7');
  }
  if (payload.raw && version === '5') {
    throw new Error('Midjourney raw 需要 version 5.1 或更高');
  }
  if (payload.draft && version && !new Set(['7', '8.1', '8.2']).has(version)) {
    throw new Error('Midjourney draft 只支持 version 7、8.1 或 8.2');
  }
  if (payload.hd && version && !new Set(['8.1', '8.2']).has(version)) {
    throw new Error('Midjourney hd 只支持 version 8.1 或 8.2');
  }
  if (payload.stop !== undefined && version) {
    const supported = niji
      ? new Set(['5', '6'])
      : new Set(['5', '5.1', '5.2', '6', '6.1']);
    if (!supported.has(version)) {
      throw new Error(`Midjourney ${niji ? 'Niji' : '主模型'} version ${version} 不支持 stop`);
    }
  }
}

async function buildMidjourneyPayload(request, apiKey, options = {}) {
  const operation = midjourneyText(request.operation || request.model).toLowerCase();
  const spec = MIDJOURNEY_ACTION_SPECS[operation];
  if (!spec) throw new Error(`不支持的 Midjourney 功能：${operation || '(空)'}`);
  const allowed = new Set(spec.allowedFields);
  const payload = {};

  const prompt = midjourneyText(request.prompt);
  if (allowed.has('prompt') && prompt) payload.prompt = prompt;

  const imageSources = normalizeList(request.image_urls || request.imageUrls || request.images);
  if (operation === 'midjourney-blend' && (imageSources.length < 2 || imageSources.length > 4)) {
    throw new Error('midjourney-blend 必须提供 2–4 张图片');
  }
  if (operation === 'midjourney-describe' && imageSources.length !== 1) {
    throw new Error('midjourney-describe 必须且只能提供 1 张图片');
  }
  if (operation === 'midjourney-imagine' && imageSources.length > 4) {
    throw new Error('midjourney-imagine 最多支持 4 张图片');
  }
  if (operation === 'midjourney-edits' && (imageSources.length < 1 || imageSources.length > 4)) {
    throw new Error('midjourney-edits 必须提供 1–4 张图片');
  }
  if (operation === 'midjourney-video' && imageSources.length > 1) {
    throw new Error('midjourney-video 直接图片模式必须且只能提供 1 张首帧');
  }
  if (allowed.has('image_urls') && imageSources.length) {
    payload.image_urls = [];
    for (const source of imageSources) {
      payload.image_urls.push(await uploadMedia(source, 'image', apiKey, options));
    }
  }

  const taskId = midjourneyText(request.task_id || request.taskId);
  if (allowed.has('task_id') && taskId) payload.task_id = taskId;
  const customId = midjourneyText(request.custom_id || request.customId);
  if (allowed.has('custom_id') && customId) payload.custom_id = customId;

  const rawIndex = request.index;
  const index = midjourneyInteger(rawIndex, -1);
  if (allowed.has('index') && index >= 0 && !customId) payload.index = index;

  const speed = midjourneyText(request.speed).toLowerCase();
  if (allowed.has('speed') && speed && speed !== 'unset') {
    if (!MIDJOURNEY_SPEEDS.has(speed)) throw new Error('Midjourney speed 只支持 relax、fast 或 turbo');
    payload.speed = speed;
  }

  const size = midjourneyText(request.size);
  if (allowed.has('size') && size) payload.size = size;
  const dimensions = midjourneyText(request.dimensions).toUpperCase();
  if (allowed.has('dimensions') && dimensions && dimensions !== 'UNSET' && !size) {
    if (!MIDJOURNEY_DIMENSIONS.has(dimensions)) {
      throw new Error('Midjourney blend dimensions 只支持 SQUARE、PORTRAIT 或 LANDSCAPE');
    }
    payload.dimensions = dimensions;
  }

  if (allowed.has('direction') && !customId) {
    const direction = midjourneyText(request.direction).toLowerCase();
    if (direction && direction !== 'unset') {
      if (!MIDJOURNEY_DIRECTIONS.has(direction)) {
        throw new Error('Midjourney pan direction 只支持 left、right、up 或 down');
      }
      payload.direction = direction;
    }
  }
  if (allowed.has('zoom_ratio') && !customId) {
    const zoomRatio = midjourneyNumber(request.zoom_ratio ?? request.zoomRatio, 2);
    if (zoomRatio < 1 || zoomRatio > 2) throw new Error('Midjourney zoom_ratio 必须在 1.0–2.0 之间');
    payload.zoom_ratio = zoomRatio;
  }

  if (allowed.has('mask_url')) {
    const maskSource = midjourneyText(request.mask_url || request.maskUrl);
    if (maskSource) {
      payload.mask_url = await uploadMedia(maskSource, 'image', apiKey, {
        ...options,
        cacheVariant: 'midjourney-mask',
        allowedMimes: ['image/png'],
      });
    }
  }
  if (allowed.has('end_url')) {
    const endSource = midjourneyText(request.end_url || request.endUrl);
    if (endSource) payload.end_url = await uploadMedia(endSource, 'image', apiKey, options);
  }

  if (operation === 'midjourney-video') {
    const videoType = midjourneyText(request.video_type || request.videoType || 'vid_1.1_i2v_480').toLowerCase();
    const animateMode = midjourneyText(request.animate_mode || request.animateMode || 'manual').toLowerCase();
    const motion = midjourneyText(request.motion || 'low').toLowerCase();
    const batchSize = midjourneyInteger(request.batch_size ?? request.batchSize, 1);
    if (!MIDJOURNEY_VIDEO_TYPES.has(videoType)) throw new Error('Midjourney video_type 不受支持');
    if (!MIDJOURNEY_ANIMATE_MODES.has(animateMode)) throw new Error('Midjourney animate_mode 只支持 manual 或 auto');
    if (!MIDJOURNEY_MOTIONS.has(motion)) throw new Error('Midjourney motion 只支持 low 或 high');
    if (!MIDJOURNEY_BATCH_SIZES.has(batchSize)) throw new Error('Midjourney batch_size 只支持 1、2 或 4');
    payload.video_type = videoType;
    payload.animate_mode = animateMode;
    payload.motion = motion;
    payload.batch_size = batchSize;
  }

  const quality = midjourneyText(request.quality);
  if (allowed.has('quality') && quality && quality !== 'unset') {
    if (!MIDJOURNEY_QUALITIES.has(quality)) throw new Error('Midjourney quality 只支持 0.25、0.5、1 或 2');
    payload.quality = quality;
  }
  const version = midjourneyText(request.version);
  if (allowed.has('version') && version && version !== 'unset') {
    if (!MIDJOURNEY_VERSIONS.has(version)) throw new Error('Midjourney version 不受支持');
    payload.version = version;
  }

  for (const field of ['style', 'negative_prompt', 'extra']) {
    const value = midjourneyText(request[field]);
    if (allowed.has(field) && value) payload[field] = value;
  }
  for (const field of ['cref', 'sref', 'dref']) {
    const value = midjourneyText(request[field]);
    if (allowed.has(field) && value) payload[field] = await uploadMedia(value, 'image', apiKey, options);
  }

  const sentinelIntegers = {
    seed: -1,
    stylize: -1,
    chaos: -1,
    weird: -1,
    cw: -1,
    sw: -1,
    repeat: 0,
    stop: 0,
  };
  for (const [field, sentinel] of Object.entries(sentinelIntegers)) {
    if (!allowed.has(field)) continue;
    const value = midjourneyInteger(request[field], sentinel);
    if (value > sentinel) payload[field] = value;
  }
  if (payload.repeat === 1 || (payload.repeat !== undefined && (payload.repeat < 2 || payload.repeat > 40))) {
    throw new Error('Midjourney repeat 必须为 0（不传）或 2–40');
  }
  if (payload.stop !== undefined && (payload.stop < 10 || payload.stop > 100)) {
    throw new Error('Midjourney stop 必须为 0（不传）或 10–100');
  }

  for (const field of ['iw', 'dw']) {
    if (!allowed.has(field)) continue;
    const value = midjourneyNumber(request[field], -1);
    if (value >= 0) payload[field] = value;
  }
  for (const field of ['tile', 'niji', 'raw', 'draft', 'hd']) {
    if (allowed.has(field) && request[field] === true) payload[field] = true;
  }
  validateMidjourneyStructuredCompatibility(payload);

  if (allowed.has('metadata')) {
    const metadata = midjourneyMetadata(request.metadata ?? request.metadata_json);
    if (metadata !== undefined) payload.metadata = metadata;
  }

  const imageCount = Array.isArray(payload.image_urls) ? payload.image_urls.length : 0;

  const oneBasedActions = new Set([
    'midjourney-upscale',
    'midjourney-variation',
    'midjourney-high-variation',
    'midjourney-low-variation',
    'midjourney-remix-strong',
    'midjourney-remix-subtle',
  ]);
  if (oneBasedActions.has(operation) && !customId && (payload.index < 1 || payload.index > 4)) {
    throw new Error(`${operation} 的 index 必须为 1–4`);
  }
  if (
    new Set(['midjourney-zoom', 'midjourney-pan', 'midjourney-inpaint']).has(operation)
    && payload.index !== undefined
    && (payload.index < 1 || payload.index > 4)
  ) {
    throw new Error(`${operation} 的 index 必须为 1–4`);
  }

  if (operation === 'midjourney-modal') {
    const mode = midjourneyText(request.modal_mode || request.modalMode || 'region').toLowerCase();
    if (!new Set(['region', 'outpaint']).has(mode)) throw new Error('Midjourney modal_mode 只支持 region 或 outpaint');
    if (mode === 'region' && !payload.mask_url) throw new Error('midjourney-modal 局部重绘必须提供 PNG 遮罩图');
    if (mode === 'outpaint') delete payload.mask_url;
  }

  if (operation === 'midjourney-video') {
    const hasImages = imageCount > 0;
    const hasTask = !!payload.task_id;
    if (hasImages === hasTask) throw new Error('midjourney-video 必须且只能选择首帧图片或任务 ID');
    if (hasImages && imageCount !== 1) throw new Error('midjourney-video 直接图片模式必须且只能提供 1 张首帧');
    if (hasImages && !prompt) throw new Error('midjourney-video 直接图片模式必须填写 Prompt');
    if (payload.animate_mode === 'auto' && (!hasTask || payload.index === undefined)) {
      throw new Error('midjourney-video 自动动画模式必须提供任务 ID 和 0–3 索引');
    }
    if (hasImages && payload.index !== undefined) throw new Error('midjourney-video 的 index 仅适用于任务 ID 模式');
    if (hasTask && payload.index !== undefined && (payload.index < 0 || payload.index > 3)) {
      throw new Error('midjourney-video 任务索引必须为 0–3');
    }
    const hasEnd = !!payload.end_url;
    const isStartEnd = payload.video_type.includes('_start_end_');
    if (hasEnd && !isStartEnd) {
      const resolution = payload.video_type.includes('720') ? '720' : '480';
      payload.video_type = `vid_1.1_i2v_start_end_${resolution}`;
    } else if (isStartEnd && !hasEnd) {
      throw new Error('Midjourney 首尾帧视频模式必须提供尾帧图片');
    }
  }

  for (const field of spec.requiredFields) {
    if (!midjourneyRequiredValuePresent(payload[field])) throw new Error(`${operation} 缺少必填参数：${field}`);
  }
  for (const group of spec.requiredOneOf) {
    if (!group.some((field) => midjourneyRequiredValuePresent(payload[field]))) {
      throw new Error(`${operation} 必须提供 ${group.join(' 或 ')}`);
    }
  }

  return {
    operation,
    action: spec.action,
    executionMode: spec.executionMode,
    resultFamily: spec.resultFamily,
    payload: Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.has(key))),
  };
}

const MIDJOURNEY_ENVELOPE_KEYS = Object.freeze(['data', 'result', 'task', 'output']);
const MIDJOURNEY_TASK_KEYS = new Set([
  'status',
  'task_id',
  'image_urls',
  'images',
  'video_urls',
  'videos',
  'grid_image_url',
  'description',
  'prompt',
  'text',
  'buttons',
]);

function midjourneyTaskId(value, depth = 0) {
  if (depth > 8 || value == null) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const taskId = midjourneyTaskId(item, depth + 1);
      if (taskId) return taskId;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of ['task_id', 'id']) {
    const candidate = midjourneyText(value[key]);
    if (/^[A-Za-z0-9][A-Za-z0-9._:\-]{0,255}$/.test(candidate)) return candidate;
  }
  for (const key of MIDJOURNEY_ENVELOPE_KEYS) {
    const taskId = midjourneyTaskId(value[key], depth + 1);
    if (taskId) return taskId;
  }
  return '';
}

function midjourneyTaskData(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 8) return null;
  const data = value.data;
  const candidates = Array.isArray(data) ? data : [data];
  for (const candidate of candidates) {
    const unwrapped = midjourneyTaskData(candidate, depth + 1);
    if (unwrapped) return unwrapped;
  }
  if (Object.keys(value).some((key) => MIDJOURNEY_TASK_KEYS.has(key))) return value;
  for (const key of ['result', 'task', 'output']) {
    const nested = midjourneyTaskData(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function midjourneyContainers(value) {
  const containers = [];
  const queue = [value];
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (Array.isArray(item)) {
      queue.push(...item.filter((child) => child && typeof child === 'object'));
      continue;
    }
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    containers.push(item);
    for (const key of MIDJOURNEY_ENVELOPE_KEYS) {
      const nested = item[key];
      if (nested && typeof nested === 'object') queue.push(nested);
    }
  }
  return containers;
}

function appendMidjourneyUrl(target, value) {
  const url = midjourneyText(value);
  if (/^https?:\/\//i.test(url) && !target.includes(url)) target.push(url);
}

function collectMidjourneyUrls(target, value, keys) {
  if (typeof value === 'string') {
    appendMidjourneyUrl(target, value);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === 'string') appendMidjourneyUrl(target, item);
    else if (item && typeof item === 'object') {
      for (const key of keys) appendMidjourneyUrl(target, item[key]);
    }
  }
}

function sanitizeMidjourneyButtons(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).map((item) => {
    if (typeof item === 'string') return { label: item.slice(0, 160), customId: item.slice(0, 512) };
    if (!item || typeof item !== 'object') return null;
    const customId = midjourneyText(item.custom_id || item.customId || item.id).slice(0, 512);
    const label = midjourneyText(item.label || item.name || item.emoji || item.text).slice(0, 160);
    return customId || label ? { customId, label: label || customId } : null;
  }).filter(Boolean);
}

function normalizeMidjourneyResponse(data) {
  const task = midjourneyTaskData(data);
  const containers = midjourneyContainers(data);
  if (task) containers.unshift(task);
  const imageUrls = [];
  const videoUrls = [];
  let gridImageUrl = '';
  let text = '';
  let status = '';
  let progress = '';
  let buttons = [];

  for (const container of containers) {
    if (!status && container.status !== undefined) status = midjourneyText(container.status).toUpperCase();
    if (!progress && container.progress !== undefined) progress = safeProgress(container.progress);
    if (!gridImageUrl) {
      const candidate = midjourneyText(container.grid_image_url || container.gridImageUrl);
      if (/^https?:\/\//i.test(candidate)) gridImageUrl = candidate;
    }
    collectMidjourneyUrls(imageUrls, container.image_urls || container.imageUrls, ['url', 'image_url', 'imageUrl']);
    collectMidjourneyUrls(imageUrls, container.images, ['url', 'image_url', 'imageUrl']);
    appendMidjourneyUrl(imageUrls, container.image_url || container.imageUrl);
    collectMidjourneyUrls(videoUrls, container.video_urls || container.videoUrls, ['url', 'video_url', 'videoUrl']);
    collectMidjourneyUrls(videoUrls, container.videos, ['url', 'video_url', 'videoUrl']);
    appendMidjourneyUrl(videoUrls, container.video_url || container.videoUrl);
    if (!buttons.length) buttons = sanitizeMidjourneyButtons(container.buttons);
  }
  for (const key of ['description', 'text', 'prompt']) {
    for (const container of containers) {
      const candidate = midjourneyText(container[key]);
      if (candidate && !/^https?:\/\//i.test(candidate)) {
        text = candidate;
        break;
      }
    }
    if (text) break;
  }
  if (gridImageUrl) {
    const index = imageUrls.indexOf(gridImageUrl);
    if (index >= 0) imageUrls.splice(index, 1);
  }
  return {
    taskId: midjourneyTaskId(data),
    status,
    progress,
    imageUrls,
    gridImageUrl,
    videoUrls,
    text,
    buttons,
  };
}

function normalizeMidjourneyStatus(value) {
  const status = midjourneyText(value).toUpperCase();
  if (new Set(['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'COMPLETE']).has(status)) return 'succeeded';
  if (status === 'MODAL') return 'modal';
  if (new Set(['CANCEL', 'FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'CANCELED']).has(status)) return 'failed';
  if (new Set(['IN_PROGRESS', 'PROCESSING', 'RUNNING']).has(status)) return 'running';
  return 'pending';
}

async function submitMidjourneyAction(request, apiKey, options = {}) {
  if (!midjourneyText(apiKey)) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const built = await buildMidjourneyPayload(request, apiKey, options);
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/midjourney/generations/${built.action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, `seedance.nz Midjourney ${built.action} 提交`);
  const data = await responseJson(response, `seedance.nz Midjourney ${built.action} 提交`);
  if (!response.ok) throw createUpstreamError(data, response);
  const normalized = normalizeMidjourneyResponse(data);
  if (!normalized.taskId && !normalized.text && !normalized.imageUrls.length && !normalized.videoUrls.length && !normalized.gridImageUrl) {
    throw invalidResponseError(`seedance.nz Midjourney ${built.action} 提交`, response);
  }
  return {
    operation: built.operation,
    action: built.action,
    executionMode: built.executionMode,
    resultFamily: built.resultFamily,
    sync: !normalized.taskId,
    ...normalized,
    ...safeProviderTrace(response, data, { pollCount: 0 }),
  };
}

async function queryMidjourneyTask(taskId, apiKey, options = {}) {
  if (!midjourneyText(apiKey)) throw new Error('缺少贞贞的平价AI小屋 API Key');
  const safeTaskId = requiredTaskId(taskId, 'seedance.nz Midjourney 任务查询');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(
    fetchImpl,
    `${baseUrl}/v1/midjourney/tasks/${encodeURIComponent(safeTaskId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    options,
    'seedance.nz Midjourney 任务查询',
  );
  const data = await responseJson(response, 'seedance.nz Midjourney 任务查询');
  if (!response.ok) throw createUpstreamError(data, response);
  const normalized = normalizeMidjourneyResponse(data);
  const status = normalizeMidjourneyStatus(normalized.status);
  return {
    ...normalized,
    taskId: normalized.taskId || safeTaskId,
    status,
    failReason: status === 'failed' ? 'Midjourney 任务失败' : '',
    ...safeProviderTrace(response, data),
  };
}

function seedance25TaskTypeFromModel(model) {
  if (SEEDANCE25_T2V_MODELS.has(model)) return 't2v';
  if (SEEDANCE25_I2V_MODELS.has(model)) return 'i2v';
  if (SEEDANCE25_MULTI_MODELS.has(model)) return 'multi';
  throw new Error(`未知 Seedance 2.5 模型：${model || '(空)'}`);
}

function seedance25ProbeExtension(file, kind) {
  const fromName = path.extname(String(file?.fileName || '')).replace(/^\./, '').toLowerCase();
  if (/^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return String(extensionFromMime(file?.mime, kind) || `.${kind === 'audio' ? 'mp3' : 'mp4'}`).replace(/^\./, '');
}

async function probeSeedance25ReferenceDuration(buffer, file, kind, options = {}) {
  if (typeof options.seedance25DurationProbe === 'function') {
    const injected = Number(await options.seedance25DurationProbe(buffer, file, kind));
    if (!Number.isFinite(injected) || injected <= 0) {
      throw new Error(`无法读取 Seedance 2.5 参考${mediaKindLabel(kind)}时长`);
    }
    return injected;
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 't8-seedance25-probe-'));
  const inputPath = path.join(tempDir, `reference.${seedance25ProbeExtension(file, kind)}`);
  const ffprobe = options.ffprobePath || resolveBundledFfprobe();
  const timeoutMs = Math.max(5_000, Math.min(60_000, Number(options.ffprobeTimeoutMs) || 30_000));
  try {
    await fs.promises.writeFile(inputPath, buffer);
    return await withFfmpegProcessSlot(() => new Promise((resolve, reject) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      const child = spawn(ffprobe, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'json',
        inputPath,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener?.('abort', onAbort);
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => {
        try { child.kill('SIGKILL'); } catch {}
        finish(new Error('任务已取消'));
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        finish(new Error(`读取 Seedance 2.5 参考${mediaKindLabel(kind)}时长超时`));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        if (stdout.length < 64 * 1024) stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 8 * 1024) stderr += chunk.toString('utf8');
      });
      child.once('error', () => finish(new Error(`无法读取 Seedance 2.5 参考${mediaKindLabel(kind)}时长`)));
      child.once('close', (code) => {
        if (code !== 0) {
          finish(new Error(`无法读取 Seedance 2.5 参考${mediaKindLabel(kind)}时长${stderr ? '，请检查文件是否完整' : ''}`));
          return;
        }
        try {
          const duration = Number(JSON.parse(stdout)?.format?.duration);
          if (!Number.isFinite(duration) || duration <= 0) throw new Error('invalid duration');
          finish(null, duration);
        } catch {
          finish(new Error(`无法读取 Seedance 2.5 参考${mediaKindLabel(kind)}时长`));
        }
      });
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener?.('abort', onAbort, { once: true });
    }), { isCancelled: () => options.signal?.aborted === true });
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function validateSeedance25ReferenceDuration(buffer, file, kind, durationState, options = {}) {
  const duration = await probeSeedance25ReferenceDuration(buffer, file, kind, options);
  if (duration < SEEDANCE25_REFERENCE_MIN_SECONDS || duration > SEEDANCE25_REFERENCE_MAX_SECONDS) {
    throw new Error(
      `Seedance 2.5 单个参考${mediaKindLabel(kind)}时长必须为 ${SEEDANCE25_REFERENCE_MIN_SECONDS}-${SEEDANCE25_REFERENCE_MAX_SECONDS} 秒`,
    );
  }
  durationState.total += duration;
  if (durationState.total > SEEDANCE25_REFERENCE_TOTAL_SECONDS + 0.001) {
    throw new Error(`Seedance 2.5 参考视频与音频总时长不得超过 ${SEEDANCE25_REFERENCE_TOTAL_SECONDS} 秒`);
  }
}

async function buildSeedance25Payload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim().toLowerCase();
  const taskType = seedance25TaskTypeFromModel(model);
  const prompt = normalizePromptMentions(request.prompt).trim();
  if (prompt.length > SEEDANCE25_PROMPT_MAX_LENGTH) {
    throw new Error(`Seedance 2.5 prompt 最多 ${SEEDANCE25_PROMPT_MAX_LENGTH} 字符`);
  }
  if ((taskType === 't2v' || taskType === 'multi') && !prompt) {
    throw new Error(`${taskType} 任务的 prompt 不得为空`);
  }

  const firstFrame = String(request.firstFrame || '').trim();
  const lastFrame = String(request.lastFrame || '').trim();
  const refImages = normalizeList(request.refImages);
  const videos = normalizeList(request.videos);
  const audios = normalizeList(request.audios);
  const allImages = [firstFrame, lastFrame, ...refImages].filter(Boolean);
  const mediaCount = allImages.length + videos.length + audios.length;

  if (taskType === 't2v' && mediaCount > 0) {
    throw new Error('Seedance 2.5 t2v 不接受图片、视频或音频素材');
  }
  if (taskType === 'i2v') {
    if (allImages.length < 1 || allImages.length > 2) {
      throw new Error('Seedance 2.5 i2v 只支持 1-2 张首尾帧图片');
    }
    if (videos.length > 0 || audios.length > 0) {
      throw new Error('Seedance 2.5 i2v 不接受视频或音频素材');
    }
  }
  if (taskType === 'multi') {
    if (mediaCount < 1) throw new Error('Seedance 2.5 multi 至少需要 1 个参考素材');
    if (allImages.length > SEEDANCE25_MULTI_LIMITS.images) {
      throw new Error(`Seedance 2.5 multi 最多支持 ${SEEDANCE25_MULTI_LIMITS.images} 张图片`);
    }
    if (videos.length > SEEDANCE25_MULTI_LIMITS.videos) {
      throw new Error(`Seedance 2.5 multi 最多支持 ${SEEDANCE25_MULTI_LIMITS.videos} 个视频`);
    }
    if (audios.length > SEEDANCE25_MULTI_LIMITS.audios) {
      throw new Error(`Seedance 2.5 multi 最多支持 ${SEEDANCE25_MULTI_LIMITS.audios} 个音频`);
    }
    if (mediaCount > SEEDANCE25_MULTI_LIMITS.total) {
      throw new Error(`Seedance 2.5 multi 参考素材合计最多 ${SEEDANCE25_MULTI_LIMITS.total} 个`);
    }
  }

  const resolution = String(request.resolution || SEEDANCE25_DEFAULT_RESOLUTION).trim().toLowerCase();
  if (!SEEDANCE25_RESOLUTIONS.has(resolution)) {
    throw new Error(`Seedance 2.5 不支持分辨率 ${request.resolution || '(空)'}`);
  }
  const seconds = normalizeSeedance25Seconds(request.duration);
  const payload = {
    model,
    metadata: {
      resolution,
      ratio: normalizeRatio(request.ratio),
      generate_audio: request.generate_audio !== false,
      return_last_frame: request.return_last_frame === true,
    },
  };
  if (seconds === -1) payload.metadata.duration = -1;
  else payload.seconds = String(seconds);
  if (prompt) payload.prompt = prompt;
  if (Number.isFinite(Number(request.seed)) && Number(request.seed) >= 0) {
    payload.metadata.seed = Number(request.seed);
  }

  if (taskType === 'i2v') {
    payload.images = [];
    for (const source of allImages) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: SEEDANCE25_IMAGE_MAX_BYTES,
        allowedMimes: SEEDANCE25_IMAGE_MIMES,
        cacheVariant: 'seedance25-image-v2',
      }));
    }
  } else if (taskType === 'multi') {
    payload.metadata.content = [];
    const durationState = { total: 0 };
    for (const source of allImages) {
      const url = await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: SEEDANCE25_IMAGE_MAX_BYTES,
        allowedMimes: SEEDANCE25_IMAGE_MIMES,
        cacheVariant: 'seedance25-image-v2',
      });
      payload.metadata.content.push({ type: 'image_url', image_url: { url } });
    }
    for (const source of videos) {
      const url = await uploadMedia(source, 'video', apiKey, {
        ...options,
        maxBytes: SEEDANCE25_MEDIA_MAX_BYTES,
        allowedMimes: SEEDANCE25_VIDEO_MIMES,
        uploadCacheTtlMs: 0,
        validateBuffer: (buffer, file) => validateSeedance25ReferenceDuration(
          buffer,
          file,
          'video',
          durationState,
          options,
        ),
      });
      payload.metadata.content.push({ type: 'video_url', video_url: { url } });
    }
    for (const source of audios) {
      const url = await uploadMedia(source, 'audio', apiKey, {
        ...options,
        maxBytes: SEEDANCE25_MEDIA_MAX_BYTES,
        allowedMimes: SEEDANCE25_AUDIO_MIMES,
        uploadCacheTtlMs: 0,
        validateBuffer: (buffer, file) => validateSeedance25ReferenceDuration(
          buffer,
          file,
          'audio',
          durationState,
          options,
        ),
      });
      payload.metadata.content.push({ type: 'audio_url', audio_url: { url } });
    }
  }

  return { payload, taskType, model };
}

async function buildPayload(request, apiKey, options = {}) {
  const requestedModel = String(request.model || '').trim().toLowerCase();
  if (ZHENZHEN_APIMART_VIDEO_MODELS.has(requestedModel)) {
    return buildApimartVideoPayload(request, apiKey, options);
  }
  if (SEEDANCE25_MODELS.has(requestedModel)) {
    return buildSeedance25Payload(request, apiKey, options);
  }
  const taskType = deriveTaskType(request);
  ensureMediaLimits(taskType, request);
  const model = resolveModel(request.model, taskType);
  const family = parseModelFamily(model);
  const resolution = normalizeResolution(request.resolution);
  if (resolution.startsWith('native') && family.tier !== 'standard') {
    throw new Error('native1080p/native4k 只支持 Standard 模型');
  }

  const prompt = normalizePromptMentions(request.prompt).trim();
  if ((taskType === 't2v' || taskType === 'multi') && !prompt) {
    throw new Error(`${taskType} 任务的 prompt 不得为空`);
  }

  const payload = {
    model,
    seconds: normalizeSeconds(request.duration),
    metadata: {
      resolution,
      ratio: normalizeRatio(request.ratio),
      generate_audio: request.generate_audio !== false,
      return_last_frame: request.return_last_frame === true,
    },
  };
  if (prompt) payload.prompt = prompt;
  if (Number.isFinite(Number(request.seed)) && Number(request.seed) !== -1) {
    payload.metadata.seed = Number(request.seed);
  }

  if (taskType === 'i2v') {
    const frameSources = [request.firstFrame, request.lastFrame].filter((item) => !!String(item || '').trim());
    payload.images = [];
    for (const source of frameSources) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, options));
    }
  }

  if (taskType === 'multi') {
    payload.metadata.content = [];
    for (const source of normalizeList(request.refImages)) {
      const url = await uploadMedia(source, 'image', apiKey, options);
      payload.metadata.content.push({ type: 'image_url', image_url: { url } });
    }
    for (const source of normalizeList(request.videos)) {
      const url = await uploadMedia(source, 'video', apiKey, options);
      payload.metadata.content.push({ type: 'video_url', video_url: { url } });
    }
    for (const source of normalizeList(request.audios)) {
      const url = await uploadMedia(source, 'audio', apiKey, options);
      payload.metadata.content.push({ type: 'audio_url', audio_url: { url } });
    }
  }

  return { payload, taskType, model };
}

function normalizeImagePrompt(value) {
  const prompt = String(value || '').trim();
  if (prompt.length < 5 || prompt.length > 2000) {
    throw new Error('seedance.nz Seedream 提示词长度必须为 5-2000 字符');
  }
  return prompt;
}

function normalizeImageMetadata(request = {}) {
  const outputFormat = String(request.output_format || request.outputFormat || 'png').trim().toLowerCase();
  if (!IMAGE_OUTPUT_FORMATS.has(outputFormat)) {
    throw new Error('seedance.nz Seedream 输出格式只支持 png 或 jpeg');
  }
  const metadata = { output_format: outputFormat };
  const resolution = String(request.resolution || '').trim().toLowerCase();
  if (resolution) {
    if (!IMAGE_RESOLUTIONS.has(resolution)) {
      throw new Error('seedance.nz Seedream 分辨率只支持 1k 或 2k');
    }
    metadata.resolution = resolution;
    return metadata;
  }

  const size = String(request.size || '').trim().replace(/\s+/g, '').replace(/[X×]/g, 'x');
  const sizeMatch = size.match(/^(\d+)x(\d+)$/);
  const width = Number(request.width ?? sizeMatch?.[1]);
  const height = Number(request.height ?? sizeMatch?.[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 240 || width > 8192 || height < 240 || height > 8192) {
    throw new Error('seedance.nz Seedream 自定义宽高必须为 240-8192 的整数');
  }
  metadata.width = width;
  metadata.height = height;
  return metadata;
}

async function uploadApimartImages(sources, apiKey, options = {}) {
  const images = [];
  for (const source of sources) {
    images.push(await uploadMedia(source, 'image', apiKey, {
      ...options,
      maxBytes: IMAGE_REFERENCE_MAX_BYTES,
      allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
    }));
  }
  return images;
}

function normalizePositiveInteger(value, fallback, min, max, label) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label}必须是 ${min}-${max} 的整数`);
  }
  return number;
}

function normalizeApimartPrompt(value, label) {
  const prompt = String(value || '').trim();
  if (!prompt) throw new Error(`${label}必须填写提示词`);
  return prompt;
}

async function buildApimartImagePayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim().toLowerCase();
  if (!ZHENZHEN_APIMART_IMAGE_MODELS.has(model)) {
    throw new Error(`未知 APIMart 图像模型：${model || '(空)'}`);
  }
  if (model === ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL) {
    const sourceTaskId = String(request.source_task_id || request.sourceTaskId || '').trim();
    if (!sourceTaskId) throw new Error(`${model} 必须提供已完成单图任务的 source_task_id`);
    return {
      payload: {
        model,
        operation: 'segment',
        source_task_id: sourceTaskId,
        include_mask_rle: request.include_mask_rle === true || request.includeMaskRle === true,
      },
      model,
      taskType: 'segment',
    };
  }
  if (model === ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL) {
    const imageId = String(request.image_id || request.imageId || '').trim();
    if (!imageId) throw new Error(`${model} 必须提供分割结果 image_id`);
    const prompt = normalizeApimartPrompt(request.prompt, model);
    const selectionKeys = ['object_indices', 'boxes', 'selection_regions'];
    const supplied = selectionKeys.filter((key) => Array.isArray(request[key]) && request[key].length > 0);
    if (supplied.length !== 1) throw new Error(`${model} 必须且只能提供 object_indices、boxes、selection_regions 之一`);
    const selection = request[supplied[0]];
    if (supplied[0] === 'object_indices' && selection.some((item) => !Number.isInteger(item) || item < 0)) {
      throw new Error('object_indices 必须是非负整数数组');
    }
    if (supplied[0] === 'boxes' && selection.some((item) => !Array.isArray(item) || !item.length || item.some((value) => !Number.isFinite(Number(value))))) {
      throw new Error('boxes 必须是非空数值数组组成的数组');
    }
    if (supplied[0] === 'selection_regions' && selection.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new Error('selection_regions 必须是对象数组');
    }
    return {
      payload: { model, operation: 'region_edit', image_id: imageId, prompt, [supplied[0]]: selection },
      model,
      taskType: 'region_edit',
    };
  }
  const prompt = normalizeApimartPrompt(request.prompt, model);
  if (model === ZHENZHEN_IMAGE_GK_V2_MODEL && prompt.length > 20000) {
    throw new Error(`${model} 提示词最多 20000 字符`);
  }
  const refs = normalizeList(request.images || request.refImages);
  const maxOutputs = model === ZHENZHEN_IMAGE_GK_V2_MODEL ? 12 : 10;
  const n = normalizePositiveInteger(request.n, 1, 1, maxOutputs, 'APIMart 图片生成数量 n ');
  const payload = { model, prompt, n };

  if (model === ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL) {
    if (refs.length < 1 || refs.length > ZHENZHEN_IMAGE_GK_V2_EDIT_MAX_IMAGES) {
      throw new Error(`${model} 必须按顺序提供 1-${ZHENZHEN_IMAGE_GK_V2_EDIT_MAX_IMAGES} 张参考图`);
    }
    const aspectRatio = String(request.aspect_ratio || request.aspectRatio || request.ratio || 'auto').trim().toLowerCase();
    if (!ZHENZHEN_IMAGE_GK_V2_EDIT_RATIOS.has(aspectRatio)) {
      throw new Error(`${model} 不支持比例 ${aspectRatio || '(空)'}`);
    }
    const resolution = String(request.resolution || '1k').trim().toLowerCase();
    if (!ZHENZHEN_IMAGE_GK_V2_EDIT_RESOLUTIONS.has(resolution)) {
      throw new Error(`${model} 分辨率只支持 1k 或 2k`);
    }
    payload.images = await uploadApimartImages(refs, apiKey, options);
    payload.aspect_ratio = aspectRatio;
    payload.resolution = resolution;
    payload.nsfw_check = normalizeAudioBoolean(request.nsfw_check ?? request.nsfwCheck, false);
    return { payload, model, taskType: 'i2i' };
  }

  if (model === ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL) {
    if (refs.length > 16) throw new Error(`${model} 最多支持 16 张参考图`);
    const resolution = String(request.resolution || '1k').trim().toLowerCase();
    if (!['1k', '2k', '4k'].includes(resolution)) {
      throw new Error(`${model} 分辨率只支持 1k、2k 或 4k`);
    }
    const size = String(request.size || request.ratio || '1:1').trim().toLowerCase();
    if (!size || (!/^\d+:\d+$/.test(size) && !/^\d+x\d+$/.test(size))) {
      throw new Error(`${model} size 必须是宽高比（如 16:9）或 WxH`);
    }
    payload.size = size;
    payload.metadata = { resolution };
    if (refs.length) payload.images = await uploadApimartImages(refs, apiKey, options);
    return { payload, model, taskType: refs.length ? 'i2i' : 't2i' };
  }

  const size = String(request.size || request.ratio || '1:1').trim().toLowerCase();
  if (ZHENZHEN_IMAGE_NB_MODELS.has(model)) {
    if (refs.length > 14) throw new Error(`${model} 最多支持 14 张参考图`);
    const resolution = String(request.resolution || '1k').trim().toLowerCase();
    const allowedResolutions = model === ZHENZHEN_IMAGE_NB_2_MODEL
      ? new Set(['0.5k', '1k', '2k', '4k'])
      : model === ZHENZHEN_IMAGE_NB_2_LITE_MODEL
        ? new Set(['1k'])
        : new Set(['1k', '2k', '4k']);
    if (!allowedResolutions.has(resolution)) {
      throw new Error(`${model} 不支持分辨率 ${resolution || '(空)'}`);
    }
    const allowedRatios = model === ZHENZHEN_IMAGE_NB_PRO_MODEL
      ? ZHENZHEN_IMAGE_NB_STANDARD_RATIOS
      : ZHENZHEN_IMAGE_NB_EXTREME_RATIOS;
    if (!allowedRatios.has(size)) {
      throw new Error(`${model} 不支持比例 ${size || '(空)'}`);
    }
    if (model === ZHENZHEN_IMAGE_NB_2_LITE_MODEL) {
      if (n < 1 || n > 4) throw new Error(`${model} 图片数量 n 只支持 1-4`);
    } else if (n !== 1) {
      throw new Error(`${model} 图片数量 n 固定为 1`);
    }
    payload.size = size;
    payload.metadata = { resolution };
    if (refs.length) payload.images = await uploadApimartImages(refs, apiKey, options);
    return { payload, model, taskType: refs.length ? 'i2i' : 't2i' };
  }

  if (!ZHENZHEN_APIMART_GK_RATIOS.has(size)) {
    throw new Error(`${model} size 只支持 1:1、16:9、9:16、3:2 或 2:3`);
  }
  payload.size = size;
  if (model === ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL) {
    if (refs.length === 0) throw new Error(`${model} 必须提供 1 张参考图`);
    payload.images = await uploadApimartImages(refs.slice(0, 1), apiKey, options);
    return { payload, model, taskType: 'i2i' };
  }
  if (refs.length) {
    const editModel = model === ZHENZHEN_IMAGE_GK_V2_MODEL
      ? ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL
      : ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL;
    throw new Error(`${model} 是文生图模型，不接受参考图；需要编辑图片请使用 ${editModel}`);
  }
  return { payload, model, taskType: 't2i' };
}

async function buildWan27GlobalImagePayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim().toLowerCase();
  if (!WAN27_GLOBAL_IMAGE_MODELS.has(model)) {
    throw new Error(`未知 Wan 2.7 Global 图像模型：${model || '(空)'}`);
  }
  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error(`${model} 必须填写提示词`);
  const refs = normalizeList(request.images || request.refImages);

  if (model === WAN27_GLOBAL_T2I_MODEL) {
    if (prompt.length > WAN27_GLOBAL_T2I_PROMPT_MAX_LENGTH) {
      throw new Error(`${model} 提示词最多 ${WAN27_GLOBAL_T2I_PROMPT_MAX_LENGTH} 字符`);
    }
    if (refs.length) throw new Error(`${model} 是文生图模型，不接受参考图`);
    const width = normalizePositiveInteger(request.width, 1024, 512, 4096, `${model} 宽度 `);
    const height = normalizePositiveInteger(request.height, 1024, 512, 4096, `${model} 高度 `);
    const thinkingMode = request.thinking_mode === undefined && request.thinkingMode === undefined
      ? true
      : Boolean(request.thinking_mode ?? request.thinkingMode);
    return {
      payload: {
        model,
        prompt,
        metadata: { width, height, thinking_mode: thinkingMode },
      },
      model,
      taskType: 't2i',
    };
  }

  if (prompt.length > WAN27_GLOBAL_I2I_PROMPT_MAX_LENGTH) {
    throw new Error(`${model} 提示词最多 ${WAN27_GLOBAL_I2I_PROMPT_MAX_LENGTH} 字符`);
  }
  if (refs.length < 1 || refs.length > WAN27_GLOBAL_MAX_REFERENCE_IMAGES) {
    throw new Error(`${model} 必须提供 1-${WAN27_GLOBAL_MAX_REFERENCE_IMAGES} 张参考图`);
  }
  const images = [];
  for (const source of refs) {
    images.push(await uploadMedia(source, 'image', apiKey, {
      ...options,
      maxBytes: IMAGE_REFERENCE_MAX_BYTES,
      allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
    }));
  }
  return { payload: { model, prompt, images }, model, taskType: 'i2i' };
}

async function buildApimartVideoPayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim().toLowerCase();
  if (!ZHENZHEN_APIMART_VIDEO_MODELS.has(model)) {
    throw new Error(`未知 APIMart 视频模型：${model || '(空)'}`);
  }
  const refs = normalizeList(request.images || request.refImages);
  const videoSources = normalizeList(request.videos);
  const prompt = String(request.prompt || '').trim();
  const payload = { model, metadata: {} };
  if (prompt) payload.prompt = prompt;

  if (model === ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL) {
    if (refs.length > 16) throw new Error(`${model} 最多支持 16 张参考图`);
    if (videoSources.length > 1) throw new Error(`${model} 最多支持 1 个参考视频`);
    const extendFromTaskId = String(request.extend_from_task_id || request.extendFromTaskId || '').trim();
    if (videoSources.length && extendFromTaskId) {
      throw new Error(`${model} 的 video_url 与 extend_from_task_id 不能同时使用`);
    }
    if (!prompt && refs.length === 0 && videoSources.length === 0 && !extendFromTaskId) {
      throw new Error(`${model} 至少需要 prompt、参考图、参考视频或续作任务 ID 之一`);
    }
    payload.metadata.resolution = '720p';
    payload.metadata.ratio = String(request.ratio || '16:9').trim();
    if (refs.length) payload.images = await uploadApimartImages(refs, apiKey, options);
    if (videoSources.length) {
      payload.metadata.video_url = await uploadMedia(videoSources[0], 'video', apiKey, options);
    }
    if (extendFromTaskId) payload.metadata.extend_from_task_id = extendFromTaskId;
    return { payload, model, taskType: refs.length || videoSources.length ? 'multi' : 't2v' };
  }

  if (model === ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL || model === ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL) {
    if (!prompt) throw new Error(`${model} 必须填写提示词`);
    const mode = String(request.mode || 'text').trim().toLowerCase();
    if (!['text', 'frame', 'reference_images', 'reference_video'].includes(mode)) {
      throw new Error(`${model} 不支持模式 ${mode || '(空)'}`);
    }
    const seconds = normalizePositiveInteger(request.duration ?? request.seconds, 6, 4, 10, `${model} 时长 `);
    if (![4, 6, 8, 10].includes(seconds)) throw new Error(`${model} 时长只支持 4、6、8、10 秒`);
    const resolution = String(request.resolution || '720p').trim().toLowerCase();
    if (!['720p', '1080p', '4k'].includes(resolution)) throw new Error(`${model} 分辨率只支持 720p、1080p、4k`);
    const aspectRatio = String(request.aspect_ratio || request.aspectRatio || request.ratio || '16:9').trim();
    if (!['16:9', '9:16'].includes(aspectRatio)) throw new Error(`${model} 比例只支持 16:9 或 9:16`);
    const lowpricePayload = {
      model,
      prompt,
      resolution,
      aspect_ratio: aspectRatio,
      nsfw_check: request.nsfw_check === true || request.nsfwCheck === true,
    };
    if (mode === 'text') {
      if (refs.length || videoSources.length) throw new Error('text 模式不能连接参考素材');
      lowpricePayload.seconds = String(seconds);
      return { payload: lowpricePayload, model, taskType: 't2v' };
    }
    if (mode === 'frame') {
      if (refs.length !== 1 || videoSources.length) throw new Error('frame 模式必须且只能连接 1 张首帧图');
      lowpricePayload.seconds = String(seconds);
      lowpricePayload.generation_type = 'frame';
      lowpricePayload.images = await uploadApimartImages(refs, apiKey, options);
      return { payload: lowpricePayload, model, taskType: 'i2v' };
    }
    if (mode === 'reference_images') {
      if (![1, 3].includes(refs.length) || videoSources.length) throw new Error('reference_images 模式必须连接 1 或 3 张参考图');
      lowpricePayload.seconds = String(seconds);
      lowpricePayload.generation_type = 'reference';
      lowpricePayload.images = await uploadApimartImages(refs, apiKey, options);
      return { payload: lowpricePayload, model, taskType: 'i2v' };
    }
    if (refs.length || videoSources.length !== 1) throw new Error('reference_video 模式必须且只能连接 1 个参考视频');
    lowpricePayload.metadata = { video_url: await uploadMedia(videoSources[0], 'video', apiKey, options) };
    return { payload: lowpricePayload, model, taskType: 'v2v' };
  }

  const ratio = String(request.ratio || '16:9').trim().toLowerCase();
  if (model === ZHENZHEN_VIDEO_GK_V15_MODEL) {
    if (!prompt) throw new Error(`${model} 必须填写提示词`);
    if (!ZHENZHEN_APIMART_GK_RATIOS.has(ratio)) {
      throw new Error(`${model} 比例只支持 16:9、9:16、1:1、3:2 或 2:3`);
    }
    if (refs.length > 7) throw new Error(`${model} 最多支持 7 张参考图`);
    const seconds = normalizePositiveInteger(request.duration ?? request.seconds, 6, 6, 30, `${model} 时长 `);
    const resolution = String(request.resolution || '720p').trim().toLowerCase();
    if (!['480p', '720p'].includes(resolution)) throw new Error(`${model} 分辨率只支持 480p 或 720p`);
    payload.seconds = String(seconds);
    payload.metadata = { resolution, ratio };
    if (refs.length) payload.images = await uploadApimartImages(refs, apiKey, options);
    return { payload, model, taskType: refs.length ? 'i2v' : 't2v' };
  }

  if (!prompt) throw new Error(`${model} 必须填写提示词`);
  if (!ZHENZHEN_APIMART_VEO_RATIOS.has(ratio)) {
    throw new Error(`${model} 比例只支持 16:9 或 9:16`);
  }
  const resolution = String(request.resolution || '720p').trim().toLowerCase();
  if (!ZHENZHEN_APIMART_VEO_RESOLUTIONS.has(resolution)) {
    throw new Error(`${model} 分辨率只支持 720p、1080p 或 4k`);
  }
  if (model === ZHENZHEN_VIDEO_V31_LITE_MODEL) {
    if (refs.length || videoSources.length) {
      throw new Error(`${model} 仅支持文生视频，不接受参考图或参考视频`);
    }
    payload.seconds = '8';
    payload.metadata = { resolution, ratio };
    return { payload, model, taskType: 't2v' };
  }
  const maxRefs = model === ZHENZHEN_VIDEO_V31_FAST_MODEL ? 3 : 2;
  if (refs.length > maxRefs) {
    throw new Error(`${model} 最多支持 ${maxRefs} 张参考图${model === ZHENZHEN_VIDEO_V31_QUALITY_MODEL ? '（quality 禁止 3 图 reference 模式）' : ''}`);
  }
  payload.seconds = '8';
  payload.metadata = { resolution, ratio };
  if (refs.length) payload.images = await uploadApimartImages(refs, apiKey, options);
  return { payload, model, taskType: refs.length ? 'i2v' : 't2v' };
}

function normalizeZhenzhenImageG2Prompt(value) {
  const prompt = String(value || '').trim();
  if (!prompt) throw new Error('Zhenzhen Image G-2 必须填写提示词');
  if (prompt.length > 20000) throw new Error('Zhenzhen Image G-2 提示词不能超过 20000 字符');
  return prompt;
}

function normalizeZhenzhenImageG2Metadata(request = {}) {
  const resolution = String(request.resolution || '1k').trim().toLowerCase();
  if (resolution !== '1k') throw new Error('Zhenzhen Image G-2 分辨率只能是 1k');
  if (request.output_format !== undefined || request.outputFormat !== undefined) {
    throw new Error('Zhenzhen Image G-2 不支持 output_format');
  }
  if (request.size !== undefined || request.width !== undefined || request.height !== undefined) {
    throw new Error('Zhenzhen Image G-2 不支持自定义宽高');
  }
  const ratio = String(request.ratio || 'adaptive').trim().toLowerCase();
  if (!ZHENZHEN_IMAGE_G2_RATIOS.has(ratio)) {
    throw new Error(`Zhenzhen Image G-2 不支持比例 ${ratio || '(空)'}`);
  }
  return ratio === 'adaptive' ? { resolution: '1k' } : { resolution: '1k', ratio };
}

async function buildZhenzhenImageG2Payload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim().toLowerCase();
  if (!ZHENZHEN_IMAGE_G2_MODELS.has(model)) {
    throw new Error(`未知 Zhenzhen Image G-2 模型：${model || '(空)'}`);
  }
  const refs = normalizeList(request.images || request.refImages);
  if (model === ZHENZHEN_IMAGE_G2_I2I_MODEL && refs.length === 0) {
    throw new Error('zhenzhen-image-g2-i2i 至少需要 1 张参考图');
  }
  if (model === ZHENZHEN_IMAGE_G2_I2I_MODEL && refs.length > 10) {
    throw new Error('Zhenzhen Image G-2 图生图最多支持 10 张参考图');
  }

  const payload = {
    model,
    prompt: normalizeZhenzhenImageG2Prompt(request.prompt),
    metadata: normalizeZhenzhenImageG2Metadata(request),
  };
  if (model === ZHENZHEN_IMAGE_G2_I2I_MODEL) {
    payload.images = [];
    for (const source of refs) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: IMAGE_REFERENCE_MAX_BYTES,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
      }));
    }
  }
  return {
    payload,
    model,
    taskType: model === ZHENZHEN_IMAGE_G2_I2I_MODEL ? 'i2i' : 't2i',
  };
}

async function buildImagePayload(request, apiKey, options = {}) {
  const requestedModel = String(request.model || '').trim().toLowerCase();
  if (SEEDREAM_LAYER_DECOMPOSITION_MODELS.has(requestedModel)) {
    return buildSeedreamLayerDecompositionPayload(request, apiKey, options);
  }
  if (QWEN_IMAGE_30_MODELS.has(requestedModel)) {
    return buildQwenImage30Payload(request, apiKey, options);
  }
  if (WAN27_GLOBAL_IMAGE_MODELS.has(requestedModel)) {
    return buildWan27GlobalImagePayload(request, apiKey, options);
  }
  if (ZHENZHEN_APIMART_IMAGE_MODELS.has(requestedModel)) {
    return buildApimartImagePayload(request, apiKey, options);
  }
  if (ZHENZHEN_IMAGE_G2_MODELS.has(requestedModel)) {
    return buildZhenzhenImageG2Payload(request, apiKey, options);
  }
  const refs = normalizeList(request.images || request.refImages);
  if (refs.length > 10) throw new Error('seedance.nz Seedream 最多支持 10 张参考图');
  const requestedFamily = String(
    request.modelFamily || request.model_family || request.model || 'domestic',
  ).trim().toLowerCase();
  const family = requestedFamily === 'overseas'
    || requestedFamily === 'dola'
    || requestedFamily.startsWith('dola-seedream-5.0-pro')
    ? 'overseas'
    : requestedFamily === 'domestic'
      || requestedFamily === 'seedream'
      || requestedFamily.startsWith('seedream-v5-pro')
      ? 'domestic'
      : '';
  if (!family) throw new Error(`未知 Seedream 模型系列：${requestedFamily || '(空)'}`);
  const modelPair = IMAGE_MODEL_PAIRS[family];
  const model = refs.length ? modelPair[1] : modelPair[0];
  if (!IMAGE_MODELS.has(model)) throw new Error(`未知 Seedream 模型：${model}`);
  const payload = {
    model,
    prompt: normalizeImagePrompt(request.prompt),
    metadata: normalizeImageMetadata(request),
  };
  if (refs.length) {
    payload.images = [];
    for (const source of refs) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: IMAGE_REFERENCE_MAX_BYTES,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
      }));
    }
  }
  return { payload, model, taskType: refs.length ? 'i2i' : 't2i' };
}

async function buildSeedreamLayerDecompositionPayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim().toLowerCase();
  if (!SEEDREAM_LAYER_DECOMPOSITION_MODELS.has(model)) {
    throw new Error(`未知 Seedream 分层模型：${model || '(空)'}`);
  }
  const refs = normalizeList(request.images || request.refImages);
  if (refs.length !== 1) throw new Error('Seedream 分层必须且只能提供 1 张源图');
  const prompt = String(request.prompt || '').trim();
  if (prompt.length > SEEDREAM_LAYER_PROMPT_MAX_LENGTH) {
    throw new Error(`Seedream 分层提示词最多 ${SEEDREAM_LAYER_PROMPT_MAX_LENGTH} 字符`);
  }
  const resolution = String(request.resolution || 'auto').trim().toLowerCase();
  if (!SEEDREAM_LAYER_RESOLUTIONS.has(resolution)) {
    throw new Error('Seedream 分层分辨率只支持 auto、1k、1.5k 或 2k');
  }
  const outputFormat = String(request.output_format || request.outputFormat || 'png').trim().toLowerCase();
  if (!SEEDREAM_LAYER_OUTPUT_FORMATS.has(outputFormat)) {
    throw new Error('Seedream 分层输出格式只支持 png 或 jpeg');
  }
  const sourceUrl = await uploadMedia(refs[0], 'image', apiKey, {
    ...options,
    maxBytes: SEEDREAM_LAYER_SOURCE_MAX_BYTES,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
    cacheVariant: `${model}-source-v1`,
  });
  const payload = {
    model,
    images: [sourceUrl],
    metadata: { resolution, output_format: outputFormat },
  };
  if (prompt) payload.prompt = prompt;
  return { payload, model, taskType: 'layer-decomposition' };
}

function normalizeQwenImage30CustomSize(value) {
  return String(value || '').trim().replace(/[xX×]/g, '*');
}

async function buildQwenImage30Payload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim().toLowerCase();
  if (!QWEN_IMAGE_30_MODELS.has(model)) {
    throw new Error(`未知 Qwen Image 3.0 模型：${model || '(空)'}`);
  }
  const prompt = String(request.prompt || '').trim();
  if (prompt.length < QWEN_IMAGE_30_PROMPT_MIN_LENGTH || prompt.length > QWEN_IMAGE_30_PROMPT_MAX_LENGTH) {
    throw new Error(`Qwen Image 3.0 提示词必须为 ${QWEN_IMAGE_30_PROMPT_MIN_LENGTH}-${QWEN_IMAGE_30_PROMPT_MAX_LENGTH} 字符`);
  }
  const sizingMode = String(request.sizingMode || request.sizing_mode || 'auto').trim().toLowerCase();
  if (!QWEN_IMAGE_30_SIZING_MODES.has(sizingMode)) {
    throw new Error(`Qwen Image 3.0 未知尺寸模式：${sizingMode || '(空)'}`);
  }
  const n = Number(request.n ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 6) throw new Error('Qwen Image 3.0 n 必须是 1-6 的整数');
  const seed = Number(request.seed ?? -1);
  if (!Number.isInteger(seed) || seed < -1 || seed > 2147483647) {
    throw new Error('Qwen Image 3.0 seed 必须是 -1 到 2147483647 的整数');
  }

  const payload = {
    model,
    prompt,
    n,
    prompt_extend: request.prompt_extend !== false && request.promptExtend !== false,
  };
  const negativePrompt = String(request.negative_prompt || request.negativePrompt || '').trim();
  if (negativePrompt) payload.negative_prompt = negativePrompt;

  const metadata = {};
  if (seed >= 0) metadata.seed = seed;
  if (sizingMode === 'ratio') {
    const ratio = String(request.ratio || '1:1').trim();
    const resolution = String(request.resolution || '1k').trim().toLowerCase();
    if (!QWEN_IMAGE_30_RATIOS.has(ratio)) throw new Error(`Qwen Image 3.0 不支持比例 ${ratio}`);
    if (!QWEN_IMAGE_30_RESOLUTIONS.has(resolution)) throw new Error('Qwen Image 3.0 分辨率只支持 1k 或 2k');
    metadata.ratio = ratio;
    metadata.resolution = resolution;
  } else if (sizingMode === 'custom_size') {
    const size = normalizeQwenImage30CustomSize(request.size || request.custom_size || request.customSize);
    if (!/^\d+\*\d+$/.test(size) || size.split('*').some((part) => Number(part) <= 0)) {
      throw new Error('Qwen Image 3.0 自定义尺寸必须为正整数 W*H，例如 1024*1024');
    }
    payload.size = size;
  }
  if (Object.keys(metadata).length > 0) payload.metadata = metadata;

  const refs = normalizeList(request.images || request.refImages);
  const taskType = QWEN_IMAGE_30_I2I_MODELS.has(model) ? 'i2i' : 't2i';
  if (taskType === 'i2i') {
    if (refs.length < 1 || refs.length > QWEN_IMAGE_30_MAX_REFERENCE_IMAGES) {
      throw new Error(`Qwen Image 3.0 图像编辑需要 1-${QWEN_IMAGE_30_MAX_REFERENCE_IMAGES} 张参考图`);
    }
    payload.images = [];
    for (const source of refs) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: IMAGE_REFERENCE_MAX_BYTES,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
        cacheVariant: 'qwen-image-3.0-i2i-v1',
      }));
    }
  }
  return { payload, model, taskType };
}

function normalizeWan30PublicUrl(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 2048) throw new Error(`Wan 3.0 ${fieldName} 不能超过 2048 字符`);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`Wan 3.0 ${fieldName} 必须是 http(s) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Wan 3.0 ${fieldName} 必须是 http(s) URL`);
  }
  return text;
}

async function buildWan30Payload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim().toLowerCase();
  if (!WAN30_MODELS.has(model)) throw new Error(`未知 Wan 3.0 模型：${model || '(空)'}`);
  const taskType = WAN30_I2V_MODELS.has(model) ? 'i2v' : 'r2v';
  const prompt = String(request.prompt || '').trim();
  if (prompt.length > WAN30_PROMPT_MAX_LENGTH) {
    throw new Error(`Wan 3.0 提示词不能超过 ${WAN30_PROMPT_MAX_LENGTH} 字符`);
  }
  if (taskType === 'r2v' && !prompt) throw new Error('Wan 3.0 R2V 必须填写提示词');

  const seconds = String(request.duration ?? request.seconds ?? '2').trim();
  if (!WAN30_SECONDS.has(seconds)) throw new Error('Wan 3.0 时长只支持 auto 或 2-30 秒');
  const resolution = String(request.resolution || '480P').trim().toUpperCase();
  if (!WAN30_RESOLUTIONS.has(resolution)) throw new Error('Wan 3.0 分辨率只支持 480P、720P 或 1080P');
  const ratio = String(request.ratio || 'adaptive').trim();
  if (!WAN30_RATIOS.has(ratio)) throw new Error(`Wan 3.0 不支持比例 ${ratio}`);
  const seed = Number(request.seed ?? 0);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    throw new Error('Wan 3.0 seed 必须是 0 到 2147483647 的整数');
  }

  const imageSources = normalizeList(request.images || request.refImages);
  const videoSources = normalizeList(request.videos || request.videoUrls || request.video_url);
  const audioSources = normalizeList(request.audios || request.audioUrls || request.audio_url);
  const fileUrl = normalizeWan30PublicUrl(request.fileUrl ?? request.file_url, 'file_url');
  const linkUrl = normalizeWan30PublicUrl(request.linkUrl ?? request.link_url, 'link_url');
  if (fileUrl && linkUrl) throw new Error('Wan 3.0 file_url 与 link_url 不能同时填写');

  if (taskType === 'i2v') {
    if (imageSources.length < 1 || imageSources.length > 2) {
      throw new Error('Wan 3.0 I2V 必须提供 1-2 张图片（首帧/可选尾帧）');
    }
    if (videoSources.length || audioSources.length || fileUrl || linkUrl) {
      throw new Error('Wan 3.0 I2V 只接受首帧与可选尾帧图片');
    }
  } else {
    if (imageSources.length > WAN30_MAX_IMAGES) throw new Error(`Wan 3.0 R2V 最多支持 ${WAN30_MAX_IMAGES} 张图片`);
    if (videoSources.length > WAN30_MAX_VIDEOS) throw new Error(`Wan 3.0 R2V 最多支持 ${WAN30_MAX_VIDEOS} 个视频`);
    if (audioSources.length > WAN30_MAX_AUDIOS) throw new Error(`Wan 3.0 R2V 最多支持 ${WAN30_MAX_AUDIOS} 个音频`);
  }

  const metadata = {
    resolution,
    ratio,
    generate_audio: request.generateAudio !== false && request.generate_audio !== false,
    seed,
  };
  const payload = { model, seconds, metadata };
  if (prompt) payload.prompt = prompt;

  if (imageSources.length) {
    payload.images = [];
    for (const source of imageSources) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
        cacheVariant: `wan30-${taskType}-image-v1`,
      }));
    }
  }

  if (taskType === 'i2v') {
    if (WAN30_THINKING_MODELS.has(model)) {
      metadata.enable_thinking = request.enableThinking === true || request.enable_thinking === true;
    }
    return { payload, model, taskType };
  }

  if (videoSources.length) {
    metadata.video_url = [];
    for (const source of videoSources) {
      metadata.video_url.push(await uploadMedia(source, 'video', apiKey, {
        ...options,
        cacheVariant: 'wan30-r2v-video-v1',
      }));
    }
  }
  if (audioSources.length) {
    metadata.audio_url = [];
    for (const source of audioSources) {
      metadata.audio_url.push(await uploadMedia(source, 'audio', apiKey, {
        ...options,
        cacheVariant: 'wan30-r2v-audio-v1',
      }));
    }
  }
  if (fileUrl) metadata.file_url = fileUrl;
  if (linkUrl) metadata.link_url = linkUrl;
  if (WAN30_THINKING_MODELS.has(model)) {
    metadata.enable_thinking = request.enableThinking === true
      || request.enable_thinking === true
      || Boolean(fileUrl || linkUrl);
  }
  return { payload, model, taskType };
}

async function buildWanPayload(request, apiKey, options = {}) {
  const model = String(request.model || WAN27_SPICY_MODEL).trim();
  if (WAN30_MODELS.has(model.toLowerCase())) return buildWan30Payload(request, apiKey, options);
  if (model !== WAN27_SPICY_MODEL) throw new Error(`未知 Wan 模型：${model || '(空)'}`);

  const sources = normalizeList(request.images || request.refImages);
  if (sources.length === 0) throw new Error('Wan 2.7 Spicy 必须提供 1 张首帧图');
  const prompt = String(request.prompt || '').trim();
  if (prompt.length > 20480) throw new Error('Wan 2.7 Spicy 提示词不能超过 20480 字符');
  const negativePrompt = String(request.negative_prompt || request.negativePrompt || '').trim();
  if (negativePrompt.length > 20480) throw new Error('Wan 2.7 Spicy 反向提示词不能超过 20480 字符');
  const resolution = String(request.resolution || '720p').trim().toLowerCase();
  if (!WAN27_SPICY_RESOLUTIONS.has(resolution)) {
    throw new Error('Wan 2.7 Spicy 分辨率只支持 720p 或 1080p');
  }
  const audioUrl = String(request.audio_url || request.audioUrl || '').trim();

  const metadata = { resolution };
  if (negativePrompt) metadata.negative_prompt = negativePrompt;
  if (audioUrl) metadata.audio_url = await uploadMedia(audioUrl, 'audio', apiKey, options);
  if (request.prompt_extend === true || request.promptExtend === true) metadata.prompt_extend = true;
  const seed = request.seed === undefined || request.seed === null || request.seed === ''
    ? -1
    : Number(request.seed);
  if (!Number.isInteger(seed) || seed < -1 || seed > 2147483647) {
    throw new Error('Wan 2.7 Spicy seed 必须是 -1 到 2147483647 的整数');
  }
  if (seed >= 0) metadata.seed = seed;

  const imageUrl = await uploadMedia(sources[0], 'image', apiKey, {
    ...options,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
  });
  const payload = {
    model,
    seconds: normalizeWanSeconds(request.duration ?? request.seconds),
    metadata,
    images: [imageUrl],
  };
  if (prompt) payload.prompt = prompt;
  return { payload, model, taskType: 'i2v' };
}

async function validateHailuoFirstImage(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer, {
      animated: false,
      failOn: 'error',
      limitInputPixels: 100_000_000,
    }).metadata();
  } catch {
    throw boundaryError('Hailuo 首帧图无法解码', 'HAILUO_INVALID_FIRST_IMAGE', 400);
  }
  const width = Number(metadata?.width || 0);
  const height = Number(metadata?.pageHeight || metadata?.height || 0);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw boundaryError('Hailuo 首帧图缺少有效尺寸', 'HAILUO_INVALID_FIRST_IMAGE_SIZE', 400);
  }
  if (Math.min(width, height) < HAILUO23_MIN_IMAGE_SHORT_EDGE) {
    throw boundaryError('Hailuo 首帧图短边必须大于 300px', 'HAILUO_FIRST_IMAGE_TOO_SMALL', 400);
  }
  const aspectRatio = width / height;
  if (aspectRatio < HAILUO23_MIN_ASPECT_RATIO || aspectRatio > HAILUO23_MAX_ASPECT_RATIO) {
    throw boundaryError('Hailuo 首帧图宽高比必须在 2:5 到 5:2 之间', 'HAILUO_FIRST_IMAGE_ASPECT_RATIO', 400);
  }
}

async function buildMinimaxH3ContextIrPayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim();
  if (!MINMAX_H3_CONTEXT_IR_MODELS.has(model)) {
    throw new Error(`未知 MiniMax H3 Context IR 模型：${model || '(空)'}`);
  }

  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error('MiniMax H3 Context IR 必须填写提示词');
  if (prompt.length > MINMAX_H3_CONTEXT_IR_PROMPT_MAX_LENGTH) {
    throw new Error(`MiniMax H3 Context IR 提示词不能超过 ${MINMAX_H3_CONTEXT_IR_PROMPT_MAX_LENGTH} 字符`);
  }

  const seconds = String(request.duration ?? request.seconds ?? '4').trim();
  if (!MINMAX_H3_CONTEXT_IR_SECONDS.has(seconds)) {
    throw new Error('MiniMax H3 Context IR 时长只支持 4-15 秒');
  }

  const imageSources = normalizeList(request.images || request.refImages);
  const videoSources = normalizeList(request.videos || request.videoUrls || request.video_url);
  const audioSources = normalizeList(request.audios || request.audioUrls || request.audio_url);
  const payload = { model, prompt, seconds };

  if (model === MINMAX_H3_CONTEXT_IR_TEXT_MODEL) {
    if (imageSources.length || videoSources.length || audioSources.length) {
      throw new Error('MiniMax H3 Context IR Text 只接受文本，不接受参考素材');
    }
    const ratio = String(request.ratio || '16:9').trim();
    if (!MINMAX_H3_CONTEXT_IR_TEXT_RATIOS.has(ratio)) {
      throw new Error('MiniMax H3 Context IR Text 比例只支持 21:9、16:9、4:3、1:1、3:4 或 9:16');
    }
    payload.metadata = { ratio };
    return { payload, model, taskType: 'text' };
  }

  if (model === MINMAX_H3_CONTEXT_IR_IMAGE_MODEL) {
    if (imageSources.length < 1 || imageSources.length > 2) {
      throw new Error('MiniMax H3 Context IR Image 必须提供 1-2 张首帧/尾帧图片');
    }
    if (videoSources.length || audioSources.length) {
      throw new Error('MiniMax H3 Context IR Image 不接受视频或音频素材');
    }
    payload.images = [];
    for (const source of imageSources) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: 30 * 1024 * 1024,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
        cacheVariant: 'minmax-h3-context-ir-image-v1',
      }));
    }
    return { payload, model, taskType: 'image' };
  }

  if (!imageSources.length && !videoSources.length && !audioSources.length) {
    throw new Error('MiniMax H3 Context IR Multimodal 至少需要 1 个图片、视频或音频素材');
  }
  if (imageSources.length > MINMAX_H3_CONTEXT_IR_MAX_IMAGES) {
    throw new Error(`MiniMax H3 Context IR Multimodal 最多支持 ${MINMAX_H3_CONTEXT_IR_MAX_IMAGES} 张图片`);
  }
  if (videoSources.length > MINMAX_H3_CONTEXT_IR_MAX_VIDEOS) {
    throw new Error(`MiniMax H3 Context IR Multimodal 最多支持 ${MINMAX_H3_CONTEXT_IR_MAX_VIDEOS} 个视频`);
  }
  if (audioSources.length > MINMAX_H3_CONTEXT_IR_MAX_AUDIOS) {
    throw new Error(`MiniMax H3 Context IR Multimodal 最多支持 ${MINMAX_H3_CONTEXT_IR_MAX_AUDIOS} 个音频`);
  }

  const ratio = String(request.ratio || 'api_default').trim();
  if (ratio !== 'api_default' && !MINMAX_H3_CONTEXT_IR_MULTIMODAL_RATIOS.has(ratio)) {
    throw new Error('MiniMax H3 Context IR Multimodal 比例不受支持');
  }
  const metadata = {};
  if (ratio !== 'api_default') metadata.ratio = ratio;

  if (imageSources.length) {
    payload.images = [];
    for (const source of imageSources) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: 30 * 1024 * 1024,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
        cacheVariant: 'minmax-h3-context-ir-multimodal-image-v1',
      }));
    }
  }
  if (videoSources.length) {
    metadata.video_urls = [];
    for (const source of videoSources) {
      metadata.video_urls.push(await uploadMedia(source, 'video', apiKey, {
        ...options,
        maxBytes: 50 * 1024 * 1024,
        allowedMimes: ['video/mp4', 'video/x-msvideo', 'video/quicktime', 'video/x-matroska'],
        cacheVariant: 'minmax-h3-context-ir-multimodal-video-v1',
      }));
    }
  }
  if (audioSources.length) {
    metadata.audio_url = [];
    for (const source of audioSources) {
      metadata.audio_url.push(await uploadMedia(source, 'audio', apiKey, {
        ...options,
        maxBytes: 50 * 1024 * 1024,
        allowedMimes: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac'],
        cacheVariant: 'minmax-h3-context-ir-multimodal-audio-v1',
      }));
    }
  }
  if (Object.keys(metadata).length) payload.metadata = metadata;
  return { payload, model, taskType: 'multimodal' };
}

async function buildHailuoPayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim();
  if (!HAILUO_MODELS.has(model)) throw new Error(`未知 Hailuo 模型：${model || '(空)'}`);

  if (MINIMAX_H3_OW_MODELS.has(model)) {
    const prompt = String(request.prompt || '').trim();
    const isAudioDrive = MINIMAX_H3_OW_AUDIO_DRIVE_MODELS.has(model);
    const taskType = MINIMAX_H3_OW_T2V_MODELS.has(model)
      ? 't2v'
      : isAudioDrive ? 'multi' : MINIMAX_H3_OW_R2V_MODELS.has(model) ? 'r2v' : 'i2v';
    const isFast = MINIMAX_H3_OW_FAST_MODELS.has(model);
    if ((taskType === 't2v' || taskType === 'r2v') && !prompt) {
      throw new Error('MiniMax H3 OW 文生视频与参考生视频必须填写提示词');
    }
    if (prompt.length > HAILUO_H3_PROMPT_MAX_LENGTH) {
      throw new Error(`MiniMax H3 OW 提示词不能超过 ${HAILUO_H3_PROMPT_MAX_LENGTH} 字符`);
    }
    const seconds = String(request.duration ?? request.seconds ?? '5').trim();
    if (!MINIMAX_H3_OW_SECONDS.has(seconds)) throw new Error('MiniMax H3 OW 时长只支持 5、10 或 15 秒');
    const resolution = String(request.resolution || '480p').trim().toLowerCase();
    if (!MINIMAX_H3_OW_RESOLUTIONS.has(resolution)) throw new Error('MiniMax H3 OW 分辨率只支持 480p 或 720p');
    const ratio = String(request.ratio || '16:9').trim();
    if (!MINIMAX_H3_OW_RATIOS.has(ratio)) throw new Error(`MiniMax H3 OW 不支持比例 ${ratio}`);

    const payload = { model, seconds, metadata: { resolution, ratio } };
    if (prompt) payload.prompt = prompt;
    const videoSources = normalizeList(request.videos || request.videoUrls || request.video_url);
    const audioSources = normalizeList(request.audios || request.audioUrls || request.audio_url);
    if (taskType === 't2v' && (normalizeList(request.images || request.refImages).length || videoSources.length || audioSources.length)) {
      throw new Error('MiniMax H3 OW 文生视频不接受图片、视频或音频素材');
    }
    if (taskType !== 't2v') {
      const imageSources = normalizeList(request.images || request.refImages);
      if ((taskType === 'i2v' || isAudioDrive) && imageSources.length !== 1) {
        throw new Error('MiniMax H3 OW 图生视频必须且只能提供 1 张首帧图');
      }
      const maxImages = isFast && taskType === 'r2v' ? 9 : 1;
      if (taskType === 'r2v' && (imageSources.length < 1 || imageSources.length > maxImages)) {
        throw new Error(`MiniMax H3 OW 参考生视频必须提供 1-${maxImages} 张参考图`);
      }
      if (videoSources.length > 0 || (!isAudioDrive && isFast && audioSources.length > 0)) {
        throw new Error('MiniMax H3 OW Fast 只接受图片参考，不接受视频或音频素材');
      }
      if (isAudioDrive && audioSources.length !== 1) {
        throw new Error('MiniMax H3 OW 音频驱动必须且只能提供 1 段音频');
      }
      payload.images = [];
      for (const source of imageSources) {
        payload.images.push(await uploadMedia(source, 'image', apiKey, {
          ...options,
          maxBytes: IMAGE_REFERENCE_MAX_BYTES,
          allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
          cacheVariant: isFast ? 'minimax-h3-ow-fast-image-v1' : 'minimax-h3-ow-image-v1',
        }));
      }
      if (isAudioDrive) {
        payload.metadata.audio_urls = [await uploadMedia(audioSources[0], 'audio', apiKey, {
          ...options,
          maxBytes: 50 * 1024 * 1024,
          allowedMimes: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac'],
          cacheVariant: 'minimax-h3-ow-fast-audio-drive-v1',
        })];
      }
    }
    return { payload, model, taskType };
  }

  if (HAILUO_H3_MAX_MODELS.has(model)) {
    const isTurbo = HAILUO_H3_MAX_TURBO_MODELS.has(model);
    const modelLabel = isTurbo ? 'MiniMax H3 Max Turbo' : 'MiniMax H3 Max';
    const prompt = String(request.prompt || '').trim();
    if (!prompt) throw new Error(`${modelLabel} 必须填写提示词`);
    if (prompt.length > HAILUO_H3_PROMPT_MAX_LENGTH) {
      throw new Error(`${modelLabel} 提示词不能超过 ${HAILUO_H3_PROMPT_MAX_LENGTH} 字符`);
    }
    const seconds = String(request.duration ?? request.seconds ?? '5').trim();
    if (!HAILUO_H3_SECONDS.has(seconds)) throw new Error(`${modelLabel} 时长只支持 5-15 秒`);
    const resolution = String(request.resolution || (isTurbo ? '480p' : '480P')).trim();
    const allowedResolutions = isTurbo
      ? HAILUO_H3_MAX_TURBO_RESOLUTIONS
      : HAILUO_H3_MAX_STANDARD_RESOLUTIONS;
    if (!allowedResolutions.has(resolution)) {
      throw new Error(`${modelLabel} 分辨率只支持 ${isTurbo ? '480p 或 768p' : '480P 或 768P'}`);
    }

    const taskType = HAILUO_H3_MAX_T2V_MODELS.has(model) ? 't2v' : 'i2v';
    const imageSources = normalizeList(request.images || request.refImages);
    const videoSources = normalizeList(request.videos || request.videoUrls || request.video_url);
    const audioSources = normalizeList(request.audios || request.audioUrls || request.audio_url);
    const payload = { model, prompt, seconds, metadata: { resolution } };

    if (taskType === 't2v') {
      if (imageSources.length || videoSources.length || audioSources.length) {
        throw new Error(`${modelLabel} 文生视频不接受图片、视频或音频素材`);
      }
      const ratio = String(request.ratio || '16:9').trim();
      if (!HAILUO_H3_MAX_RATIOS.has(ratio)) throw new Error(`${modelLabel} 不支持比例 ${ratio}`);
      payload.metadata.ratio = ratio;
      return { payload, model, taskType };
    }

    if (videoSources.length || audioSources.length) {
      throw new Error(`${modelLabel} 图生视频只接受首帧与可选尾帧图片`);
    }
    if (imageSources.length < 1 || imageSources.length > 2) {
      throw new Error(`${modelLabel} 图生视频必须提供 1-2 张首尾帧图片`);
    }
    payload.images = [];
    for (const source of imageSources) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: 30 * 1024 * 1024,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
        cacheVariant: isTurbo ? 'hailuo-h3-max-turbo-i2v-image-v1' : 'hailuo-h3-max-i2v-image-v1',
      }));
    }
    return { payload, model, taskType };
  }

  if (HAILUO_H3_MODELS.has(model)) {
    const prompt = String(request.prompt || '').trim();
    if (prompt.length > HAILUO_H3_PROMPT_MAX_LENGTH) {
      throw new Error(`Hailuo H3 提示词不能超过 ${HAILUO_H3_PROMPT_MAX_LENGTH} 字符`);
    }
    const taskType = HAILUO_H3_T2V_MODELS.has(model)
      ? 't2v'
      : HAILUO_H3_I2V_MODELS.has(model) ? 'i2v' : 'multi';
    if (taskType !== 'i2v' && !prompt) {
      throw new Error(`Hailuo H3 ${taskType === 'multi' ? '多模态参考' : '文生视频'}必须填写提示词`);
    }

    const seconds = String(request.duration ?? request.seconds ?? '5').trim();
    if (!HAILUO_H3_SECONDS.has(seconds)) throw new Error('Hailuo H3 时长只支持 5-15 秒');
    const requestedResolution = String(request.resolution || '768P').trim().toUpperCase();
    if (!HAILUO_H3_RESOLUTIONS.has(requestedResolution)) throw new Error('Hailuo H3 分辨率只支持 768P 或 2K');

    const payload = {
      model,
      seconds,
      metadata: { resolution: requestedResolution },
    };
    if (taskType === 't2v') {
      payload.metadata.ratio = normalizeRatio(request.ratio || '16:9');
      payload.prompt = prompt;
      return { payload, model, taskType };
    }

    const imageSources = normalizeList(request.images || request.refImages);
    if (taskType === 'i2v') {
      if (imageSources.length === 0) throw new Error('Hailuo H3 图生视频必须提供第 1 张首帧图');
      if (imageSources.length > 2) throw new Error('Hailuo H3 图生视频最多支持 2 张首尾帧图片');
      const images = [];
      for (const source of imageSources) {
        images.push(await uploadMedia(source, 'image', apiKey, {
          ...options,
          maxBytes: 30 * 1024 * 1024,
          allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
          cacheVariant: 'hailuo-h3-i2v-image-v1',
        }));
      }
      payload.images = images;
      if (prompt) payload.prompt = prompt;
      return { payload, model, taskType };
    }

    const videoSources = normalizeList(request.videos || request.videoUrls || request.video_url);
    const audioSources = normalizeList(request.audios || request.audioUrls || request.audio_url);
    if (imageSources.length === 0 && videoSources.length === 0 && audioSources.length === 0) {
      throw new Error('Hailuo H3 多模态参考至少需要 1 个图片、视频或音频素材');
    }
    if (imageSources.length > HAILUO_H3_MAX_REFERENCE_IMAGES) {
      throw new Error(`Hailuo H3 多模态参考最多支持 ${HAILUO_H3_MAX_REFERENCE_IMAGES} 张图片`);
    }
    if (videoSources.length > HAILUO_H3_MAX_REFERENCE_VIDEOS) {
      throw new Error(`Hailuo H3 多模态参考最多支持 ${HAILUO_H3_MAX_REFERENCE_VIDEOS} 个视频`);
    }
    if (audioSources.length > HAILUO_H3_MAX_REFERENCE_AUDIOS) {
      throw new Error(`Hailuo H3 多模态参考最多支持 ${HAILUO_H3_MAX_REFERENCE_AUDIOS} 个音频`);
    }

    const images = [];
    for (const source of imageSources) {
      images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: 30 * 1024 * 1024,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
        cacheVariant: 'hailuo-h3-multi-image-v1',
      }));
    }
    const videos = [];
    for (const source of videoSources) {
      videos.push(await uploadMedia(source, 'video', apiKey, {
        ...options,
        maxBytes: 50 * 1024 * 1024,
        allowedMimes: ['video/mp4'],
        cacheVariant: 'hailuo-h3-multi-video-v1',
      }));
    }
    const audios = [];
    for (const source of audioSources) {
      audios.push(await uploadMedia(source, 'audio', apiKey, {
        ...options,
        maxBytes: 50 * 1024 * 1024,
        allowedMimes: ['audio/mpeg', 'audio/wav', 'audio/x-wav'],
        cacheVariant: 'hailuo-h3-multi-audio-v1',
      }));
    }
    payload.prompt = prompt;
    payload.metadata.ratio = normalizeRatio(request.ratio || '16:9');
    if (images.length) payload.images = images;
    if (videos.length) payload.metadata.video_url = videos;
    if (audios.length) payload.metadata.audio_url = audios;
    return { payload, model, taskType };
  }

  const prompt = String(request.prompt || '').trim();
  if (prompt.length > HAILUO23_PROMPT_MAX_LENGTH) {
    throw new Error(`Hailuo 2.3 提示词不能超过 ${HAILUO23_PROMPT_MAX_LENGTH} 字符`);
  }
  const taskType = HAILUO23_T2V_MODELS.has(model) ? 't2v' : 'i2v';
  if (taskType === 't2v' && !prompt) throw new Error('Hailuo 2.3 文生视频必须填写提示词');

  const seconds = String(request.duration ?? request.seconds ?? '6').trim();
  if (!HAILUO23_SECONDS.has(seconds)) throw new Error('Hailuo 2.3 时长只支持 6 或 10 秒');
  const resolution = String(request.resolution || '768p').trim().toLowerCase();
  if (!HAILUO23_RESOLUTIONS.has(resolution)) throw new Error('Hailuo 2.3 分辨率只支持 768p 或 1080p');
  if (resolution === '1080p' && seconds !== '6') throw new Error('Hailuo 2.3 的 1080p 只支持 6 秒');

  const payload = {
    model,
    seconds,
    metadata: { resolution },
  };
  if (taskType === 't2v') {
    const ratio = normalizeRatio(request.ratio || '16:9');
    if (ratio !== 'adaptive') payload.metadata.ratio = ratio;
    payload.prompt = prompt;
    return { payload, model, taskType };
  }

  const sources = normalizeList(request.images || request.refImages);
  if (sources.length === 0) throw new Error('Hailuo 2.3 图生视频必须提供 1 张首帧图');
  const imageUrl = await uploadMedia(sources[0], 'image', apiKey, {
    ...options,
    maxBytes: 30 * 1024 * 1024,
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
    cacheVariant: 'hailuo23-first-image-v1',
    validateBuffer: validateHailuoFirstImage,
  });
  payload.images = [imageUrl];
  if (prompt) payload.prompt = prompt;
  return { payload, model, taskType };
}

function flux3TaskType(model) {
  if (FLUX3_T2V_MODELS.has(model)) return 't2v';
  if (FLUX3_I2V_MODELS.has(model)) return 'i2v';
  if (FLUX3_V2V_MODELS.has(model)) return 'v2v';
  if (FLUX3_DRAFT_ENHANCE_MODELS.has(model)) return 'draft-enhance';
  return null;
}

async function buildFlux3Payload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim();
  const taskType = flux3TaskType(model);
  if (!taskType || !FLUX3_VIDEO_MODELS.has(model)) throw new Error(`未知 FLUX 3 Video 模型：${model || '(空)'}`);

  const prompt = String(request.prompt || '').trim();
  if (prompt.length > FLUX3_PROMPT_MAX_LENGTH) throw new Error(`FLUX 3 提示词不能超过 ${FLUX3_PROMPT_MAX_LENGTH} 字符`);
  if (taskType !== 'draft-enhance' && !prompt) throw new Error('FLUX 3 文生、图生和视频编辑必须填写提示词');

  const seconds = String(request.duration ?? request.seconds ?? '5').trim();
  if (!FLUX3_SECONDS.has(seconds)) throw new Error('FLUX 3 时长只支持 5-20 秒');
  const resolution = String(request.resolution || 'hd').trim().toLowerCase();
  if (!FLUX3_RESOLUTIONS.has(resolution)) throw new Error('FLUX 3 分辨率只支持 hd 或 fhd');
  const ratio = String(request.ratio || 'auto').trim();
  if (!FLUX3_RATIOS.has(ratio)) throw new Error(`FLUX 3 不支持比例 ${ratio}`);

  const imageSources = normalizeList(request.images || request.refImages);
  const videoSources = normalizeList(request.videos || request.videoUrls || request.video_url || request.videoUrl);
  if (taskType === 't2v' || taskType === 'draft-enhance') {
    if (imageSources.length || videoSources.length) throw new Error(`FLUX 3 ${taskType === 't2v' ? '文生视频' : '草稿增强'}不接受参考素材`);
  }
  if (taskType === 'i2v' && videoSources.length) throw new Error('FLUX 3 图生视频不接受视频素材');
  if (taskType === 'v2v' && imageSources.length) throw new Error('FLUX 3 视频编辑不接受图片素材');

  const metadata = { resolution, ratio };
  const payload = { model, seconds, metadata };

  if (taskType === 'draft-enhance') {
    const draftCache = String(request.draft_cache || request.draftCache || '').trim();
    if (!draftCache) throw new Error('FLUX 3 草稿增强必须提供 draft_cache');
    if (draftCache.length > FLUX3_DRAFT_CACHE_MAX_LENGTH) throw new Error('FLUX 3 draft_cache 超过允许长度');
    metadata.draft_cache = draftCache;
  } else {
    payload.prompt = prompt;
    if (request.draft === true) metadata.draft = true;
  }

  const audioMode = String(request.audioMode || request.audio_mode || '').trim().toLowerCase();
  if (request.generate_audio === true || request.generateAudio === true || audioMode === 'enabled') {
    metadata.generate_audio = true;
  } else if (request.generate_audio === false || request.generateAudio === false || audioMode === 'disabled') {
    metadata.generate_audio = false;
  } else if (audioMode && audioMode !== 'api_default') {
    throw new Error(`FLUX 3 不支持音频模式 ${audioMode}`);
  }

  const rawSafety = request.safety_tolerance ?? request.safetyTolerance;
  if (rawSafety !== undefined && rawSafety !== null && String(rawSafety).trim() !== '' && String(rawSafety) !== 'api_default') {
    const safetyTolerance = Number(rawSafety);
    if (!Number.isInteger(safetyTolerance) || safetyTolerance < 0 || safetyTolerance > 4) {
      throw new Error('FLUX 3 safety_tolerance 只支持 0-4');
    }
    metadata.safety_tolerance = safetyTolerance;
  }

  if (taskType === 'i2v') {
    if (imageSources.length < 1 || imageSources.length > FLUX3_MAX_REFERENCE_IMAGES) {
      throw new Error(`FLUX 3 图生视频必须提供 1-${FLUX3_MAX_REFERENCE_IMAGES} 张关键帧图片`);
    }
    payload.images = [];
    for (const source of imageSources) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: 30 * 1024 * 1024,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
        cacheVariant: 'flux3-i2v-image-v1',
      }));
    }
  } else if (taskType === 'v2v') {
    if (videoSources.length !== 1) throw new Error('FLUX 3 视频编辑必须且只能提供 1 个 MP4 视频');
    metadata.video_url = await uploadMedia(videoSources[0], 'video', apiKey, {
      ...options,
      maxBytes: 50 * 1024 * 1024,
      allowedMimes: ['video/mp4'],
      cacheVariant: 'flux3-v2v-video-v1',
    });
  }

  return { payload, model, taskType };
}

function deriveKlingTaskType(model) {
  if (KLING_T2V_MODELS.has(model)) return 't2v';
  if (KLING_I2V_MODELS.has(model)) return 'i2v';
  if (KLING_R2V_MODELS.has(model)) return 'r2v';
  if (KLING_EDIT_MODELS.has(model)) return 'edit';
  return '';
}

async function uploadKlingImages(sources, apiKey, options = {}) {
  const images = [];
  for (const source of sources) {
    images.push(await uploadMedia(source, 'image', apiKey, {
      ...options,
      maxBytes: 30 * 1024 * 1024,
      allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
    }));
  }
  return images;
}

async function buildKlingPayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim();
  if (!KLING_MODELS.has(model)) throw new Error(`未知 Kling 模型：${model || '(空)'}`);

  const taskType = deriveKlingTaskType(model);
  const prompt = String(request.prompt || '').trim();
  if (prompt.length > KLING_PROMPT_MAX_LENGTH) {
    throw new Error(`Kling 提示词不能超过 ${KLING_PROMPT_MAX_LENGTH} 字符`);
  }
  if (taskType !== 'i2v' && !prompt) {
    throw new Error(`Kling ${taskType === 'edit' ? '视频编辑' : taskType === 'r2v' ? '参考生视频' : '文生视频'}必须填写提示词`);
  }
  const seconds = String(request.duration ?? request.seconds ?? '5').trim();
  if (!KLING_SECONDS.has(seconds)) throw new Error('Kling 时长只支持 5 或 10 秒');

  if (taskType === 'edit') {
    const videos = normalizeList(request.videos || request.videoUrls);
    if (videos.length === 0) throw new Error('Kling 视频编辑必须提供 1 个输入视频');
    const videoUrl = await uploadMedia(videos[0], 'video', apiKey, {
      ...options,
      maxBytes: 50 * 1024 * 1024,
      allowedMimes: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'],
    });
    return {
      payload: {
        model,
        prompt,
        seconds,
        metadata: {
          content: [{ type: 'video_url', video_url: { url: videoUrl } }],
        },
      },
      model,
      taskType,
    };
  }

  const ratio = String(request.ratio || '16:9').trim();
  if (!RATIOS.has(ratio)) throw new Error(`Kling 不支持比例：${ratio || '(空)'}`);
  const negativePrompt = String(request.negativePrompt ?? request.negative_prompt ?? '').trim();
  if (negativePrompt.length > KLING_PROMPT_MAX_LENGTH) {
    throw new Error(`Kling 反向提示词不能超过 ${KLING_PROMPT_MAX_LENGTH} 字符`);
  }
  const sources = normalizeList(request.images || request.refImages);
  let selectedSources = [];
  if (taskType === 'i2v') {
    if (sources.length === 0) throw new Error('Kling 图生视频必须提供第 1 张首帧图');
    selectedSources = sources.slice(0, 2);
  } else if (taskType === 'r2v') {
    if (sources.length === 0) throw new Error('Kling 参考生视频至少需要 1 张参考图');
    selectedSources = sources.slice(0, KLING_MAX_REFERENCE_IMAGES);
  }

  const metadata = {};
  if (ratio !== 'adaptive') metadata.ratio = ratio;
  if (negativePrompt) metadata.negative_prompt = negativePrompt;
  const payload = { model, seconds, metadata };
  if (prompt) payload.prompt = prompt;
  if (selectedSources.length) payload.images = await uploadKlingImages(selectedSources, apiKey, options);
  return { payload, model, taskType };
}

function validateUpscalerMp4(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') {
    throw boundaryError('Zhenzhen Upscaler 输入必须是有效 MP4', 'UPSCALER_INVALID_MP4', 400);
  }
}

async function buildUpscalerPayload(request, apiKey, options = {}) {
  const model = String(request.model || ZHENZHEN_UPSCALER_MODEL).trim();
  if (model !== ZHENZHEN_UPSCALER_MODEL) {
    throw new Error(`未知 Zhenzhen Upscaler 模型：${model || '(空)'}`);
  }
  const resolution = String(request.resolution || '1080p').trim().toLowerCase();
  if (!ZHENZHEN_UPSCALER_RESOLUTIONS.has(resolution)) {
    throw new Error('Zhenzhen Upscaler 分辨率只支持 720p、1080p、2k 或 4k');
  }
  const sources = normalizeList(request.videos || request.videoUrls || (request.video ? [request.video] : []));
  if (sources.length !== 1) throw new Error('Zhenzhen Upscaler 必须提供且只能提供 1 个 MP4 视频');
  const videoUrl = await uploadMedia(sources[0], 'video', apiKey, {
    ...options,
    maxBytes: 50 * 1024 * 1024,
    allowedMimes: ['video/mp4'],
    cacheVariant: 'zhenzhen-upscaler-mp4-v1',
    validateBuffer: validateUpscalerMp4,
  });
  return {
    payload: {
      model,
      prompt: 'upscale',
      metadata: {
        resolution,
        content: [{ type: 'video_url', video_url: { url: videoUrl } }],
      },
    },
    model,
    taskType: 'upscale',
  };
}

async function probeFashVsrInput(buffer, file, options = {}) {
  if (typeof options.fashVsrProbe === 'function') {
    const injected = await options.fashVsrProbe(buffer, file);
    return {
      width: Number(injected?.width),
      height: Number(injected?.height),
      duration: Number(injected?.duration),
    };
  }
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 't8-fashvsr-probe-'));
  const inputPath = path.join(tempDir, `source.${seedance25ProbeExtension(file, 'video')}`);
  const ffprobe = options.ffprobePath || resolveBundledFfprobe();
  const timeoutMs = Math.max(5_000, Math.min(60_000, Number(options.ffprobeTimeoutMs) || 30_000));
  try {
    await fs.promises.writeFile(inputPath, buffer);
    return await withFfmpegProcessSlot(() => new Promise((resolve, reject) => {
      let settled = false;
      let stdout = '';
      const child = spawn(ffprobe, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:format=duration',
        '-of', 'json',
        inputPath,
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener?.('abort', onAbort);
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => {
        try { child.kill('SIGKILL'); } catch {}
        finish(boundaryError('FlashVSR 素材校验已取消', 'FASHVSR_PROBE_ABORTED', 499));
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        finish(boundaryError('读取 FlashVSR 输入视频信息超时', 'FASHVSR_PROBE_TIMEOUT', 504));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        if (stdout.length < 64 * 1024) stdout += chunk.toString('utf8');
      });
      child.once('error', () => finish(boundaryError('无法读取 FlashVSR 输入视频', 'FASHVSR_INVALID_VIDEO', 400)));
      child.once('close', (code) => {
        if (code !== 0) {
          finish(boundaryError('无法读取 FlashVSR 输入视频', 'FASHVSR_INVALID_VIDEO', 400));
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null;
          const result = {
            width: Number(stream?.width),
            height: Number(stream?.height),
            duration: Number(parsed?.format?.duration),
          };
          if (!Number.isFinite(result.width) || !Number.isFinite(result.height) || !Number.isFinite(result.duration)) {
            throw new Error('invalid probe');
          }
          finish(null, result);
        } catch {
          finish(boundaryError('无法读取 FlashVSR 输入视频', 'FASHVSR_INVALID_VIDEO', 400));
        }
      });
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener?.('abort', onAbort, { once: true });
    }), { isCancelled: () => options.signal?.aborted === true });
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function validateFashVsrInput(buffer, file, options = {}) {
  const media = await probeFashVsrInput(buffer, file, options);
  if (media.height !== 480) {
    throw boundaryError('FlashVSR 输入视频必须是 480P（视频高度 480 像素）', 'FASHVSR_REQUIRES_480P', 400);
  }
  if (media.duration < FASHVSR_MIN_SECONDS || media.duration > FASHVSR_MAX_SECONDS) {
    throw boundaryError(
      `FlashVSR 输入视频时长必须为 ${FASHVSR_MIN_SECONDS}-${FASHVSR_MAX_SECONDS} 秒`,
      'FASHVSR_INVALID_DURATION',
      400,
    );
  }
}

async function buildFashVsrPayload(request, apiKey, options = {}) {
  const requestedModel = String(request.model || FASHVSR_VIDEO_UPSCALE_MODEL).trim();
  if (requestedModel !== FASHVSR_VIDEO_UPSCALE_MODEL && requestedModel !== LEGACY_FASHVSR_VIDEO_UPSCALE_MODEL) {
    throw new Error(`未知 FlashVSR 模型：${requestedModel || '(空)'}`);
  }
  const sources = normalizeList(request.videos || request.videoUrls || (request.video ? [request.video] : []));
  if (sources.length !== 1) throw new Error('FlashVSR 必须提供且只能提供 1 个 480P 视频');
  const videoUrl = await uploadMedia(sources[0], 'video', apiKey, {
    ...options,
    maxBytes: 50 * 1024 * 1024,
    allowedMimes: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'],
    cacheVariant: 'fashvsr-video-v1',
    validateBuffer: (buffer, file) => validateFashVsrInput(buffer, file, options),
  });
  return {
    payload: {
      model: FASHVSR_VIDEO_UPSCALE_MODEL,
      metadata: { video_url: videoUrl },
    },
    model: FASHVSR_VIDEO_UPSCALE_MODEL,
    taskType: 'upscale',
  };
}

function deriveViduTaskType(model) {
  if (VIDU_Q3_T2V_MODELS.has(model)) return 't2v';
  if (VIDU_Q3_I2V_MODELS.has(model)) return 'i2v';
  if (VIDU_Q3_START_END_MODELS.has(model)) return 'start-end';
  if (VIDU_Q3_R2V_MODELS.has(model)) return 'r2v';
  if (VIDU_Q3_SHORT_PLAY_MODELS.has(model)) return 'short-play';
  return '';
}

async function uploadViduImages(sources, apiKey, options = {}) {
  const images = [];
  for (const source of sources) {
    images.push(await uploadMedia(source, 'image', apiKey, {
      ...options,
      maxBytes: 30 * 1024 * 1024,
      allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
    }));
  }
  return images;
}

async function buildViduPayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim();
  if (!VIDU_Q3_MODELS.has(model)) throw new Error(`未知 Vidu Q3 模型：${model || '(空)'}`);

  const taskType = deriveViduTaskType(model);
  const prompt = String(request.prompt || '').trim();
  if (prompt.length > VIDU_Q3_PROMPT_MAX_LENGTH) {
    throw new Error(`Vidu Q3 提示词不能超过 ${VIDU_Q3_PROMPT_MAX_LENGTH} 字符`);
  }

  const sources = normalizeList(request.images || request.refImages);
  if (taskType === 'short-play') {
    if (!prompt) throw new Error('Vidu Q3 短剧成片必须填写脚本内容');
    const scriptName = String(request.scriptName ?? request.script_name ?? '').trim();
    if (!scriptName) throw new Error('Vidu Q3 短剧成片必须填写脚本名称');
    if (scriptName.length > 20) throw new Error('Vidu Q3 短剧脚本名称不能超过 20 字符');
    const resolution = String(request.resolution || '1080p').trim().toLowerCase();
    if (resolution !== '1080p') throw new Error('Vidu Q3 短剧成片分辨率必须是 1080p');
    const duration = String(request.duration ?? request.seconds ?? '8').trim();
    if (!VIDU_Q3_SHORT_PLAY_DURATIONS.has(duration)) throw new Error('Vidu Q3 短剧成片时长只支持 8-12 秒');
    const aspectRatio = String(request.aspectRatio ?? request.aspect_ratio ?? request.ratio ?? '9:16').trim();
    if (!VIDU_Q3_SHORT_PLAY_ASPECT_RATIOS.has(aspectRatio)) throw new Error('Vidu Q3 短剧成片比例只支持 9:16 或 16:9');
    const style = String(request.style || 'realistic').trim();
    if (style.length > 30) throw new Error('Vidu Q3 短剧视频风格不能超过 30 字符');
    const assetType = String(request.assetType ?? request.asset_type ?? 'character').trim();
    if (!VIDU_Q3_SHORT_PLAY_ASSET_TYPES.has(assetType)) throw new Error('Vidu Q3 短剧资产类型只支持 character、scene 或 prop');
    const assetNamePrefix = String(request.assetNamePrefix ?? request.asset_name_prefix ?? 'Asset').trim();
    if (!assetNamePrefix) throw new Error('Vidu Q3 短剧资产名称前缀不能为空');
    const assetDescription = String(request.assetDescription ?? request.asset_description ?? 'Reference asset').trim();
    if (!assetDescription) throw new Error('Vidu Q3 短剧资产描述不能为空');
    if (sources.length === 0) throw new Error('Vidu Q3 短剧成片至少需要 1 张参考资产图');
    if (sources.length > VIDU_Q3_MAX_SHORT_PLAY_ASSETS) throw new Error('Vidu Q3 短剧成片最多支持 14 张参考资产图');

    const uploaded = await uploadViduImages(sources, apiKey, options);
    return {
      payload: {
        model,
        prompt,
        metadata: {
          script_name: scriptName,
          resolution: '1080p',
          duration: Number(duration),
          aspect_ratio: aspectRatio,
          style,
          assets: uploaded.map((url, index) => ({
            id: String(index + 1),
            type: assetType,
            name: `${assetNamePrefix} ${index + 1}`,
            image_uri: url,
            description: assetDescription,
          })),
        },
      },
      model,
      taskType,
    };
  }

  if (taskType === 't2v' && !prompt) throw new Error('Vidu Q3 文生视频必须填写提示词');
  const seconds = String(request.duration ?? request.seconds ?? '4').trim();
  if (!VIDU_Q3_SECONDS.has(seconds)) throw new Error('Vidu Q3 时长只支持 4-15 秒');
  const ratio = String(request.ratio || '16:9').trim();
  if (!RATIOS.has(ratio)) throw new Error(`Vidu Q3 不支持比例：${ratio || '(空)'}`);
  const resolution = String(request.resolution || 'default').trim().toLowerCase();
  if (!VIDU_Q3_RESOLUTIONS.has(resolution)) throw new Error('Vidu Q3 分辨率只支持 default、720p 或 1080p');
  const seed = request.seed === undefined || request.seed === null || request.seed === ''
    ? -1
    : Number(request.seed);
  if (!Number.isInteger(seed) || seed < -1 || seed > 2147483647) {
    throw new Error('Vidu Q3 seed 必须是 -1 到 2147483647 的整数');
  }

  let selectedSources = [];
  if (taskType === 'i2v') {
    if (sources.length === 0) throw new Error('Vidu Q3 图生视频必须提供第 1 张首帧图');
    selectedSources = sources.slice(0, 1);
  } else if (taskType === 'start-end') {
    if (sources.length < 2) throw new Error('Vidu Q3 首尾帧视频必须提供第 1 张和第 2 张图片');
    selectedSources = sources.slice(0, 2);
  } else if (taskType === 'r2v') {
    if (sources.length === 0) throw new Error('Vidu Q3 参考生视频至少需要 1 张参考图');
    selectedSources = sources.slice(0, VIDU_Q3_MAX_REFERENCE_IMAGES);
  }

  const metadata = {};
  if (ratio !== 'adaptive') metadata.ratio = ratio;
  if (resolution !== 'default') metadata.resolution = resolution;
  if (seed >= 0) metadata.seed = seed;
  const payload = { model, seconds, metadata };
  if (prompt) payload.prompt = prompt;
  if (selectedSources.length) payload.images = await uploadViduImages(selectedSources, apiKey, options);
  return { payload, model, taskType };
}

async function buildHappyHorsePayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim();
  if (!HAPPYHORSE_MODELS.has(model)) throw new Error(`未知 Happy Horse 模型：${model || '(空)'}`);
  const prompt = String(request.prompt || '').trim();
  if (prompt.length > 20480) throw new Error('Happy Horse 提示词不能超过 20480 字符');
  if (model.endsWith('-t2v') && !prompt) throw new Error('Happy Horse 文生视频必须填写提示词');

  const resolution = String(request.resolution || '720p').trim().toLowerCase();
  if (!HAPPYHORSE_RESOLUTIONS.has(resolution)) {
    throw new Error('Happy Horse 分辨率只支持 720p 或 1080p');
  }
  const ratio = normalizeRatio(request.ratio || 'adaptive');
  const sources = normalizeList(request.images || request.refImages);
  const taskType = model.endsWith('-t2v') ? 't2v' : model.endsWith('-i2v') ? 'i2v' : 'r2v';
  if (taskType !== 't2v' && sources.length === 0) {
    throw new Error(`Happy Horse ${taskType} 至少需要 1 张参考图`);
  }
  if (taskType === 'r2v' && sources.length > 9) throw new Error('Happy Horse r2v 最多支持 9 张参考图');

  const payload = {
    model,
    seconds: normalizeHappyHorseSeconds(request.duration ?? request.seconds),
    metadata: { resolution, ratio },
  };
  if (prompt) payload.prompt = prompt;
  if (taskType !== 't2v') {
    payload.images = [];
    const selected = taskType === 'i2v' ? sources.slice(0, 1) : sources.slice(0, 9);
    for (const source of selected) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
      }));
    }
  }
  return { payload, model, taskType };
}

async function submitHappyHorseTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildHappyHorsePayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz Happy Horse 任务提交');
  const data = await responseJson(response, 'seedance.nz Happy Horse 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.id || data?.task_id || data?.data?.id, 'seedance.nz Happy Horse 任务提交', response);
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

async function submitHailuoTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildHailuoPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz Hailuo 任务提交');
  const data = await responseJson(response, 'seedance.nz Hailuo 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.id || data?.task_id || data?.data?.id, 'seedance.nz Hailuo 任务提交', response);
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

async function submitKlingTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildKlingPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz Kling 任务提交');
  const data = await responseJson(response, 'seedance.nz Kling 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.id || data?.task_id || data?.data?.id, 'seedance.nz Kling 任务提交', response);
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

async function submitUpscalerTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildUpscalerPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz Zhenzhen Upscaler 任务提交');
  const data = await responseJson(response, 'seedance.nz Zhenzhen Upscaler 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.id || data?.task_id || data?.data?.id, 'seedance.nz Zhenzhen Upscaler 任务提交', response);
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

async function submitFashVsrTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildFashVsrPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/video/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz FlashVSR 任务提交');
  const data = await responseJson(response, 'seedance.nz FlashVSR 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(
    data?.id || data?.task_id || data?.data?.id || data?.data?.task_id,
    'seedance.nz FlashVSR 任务提交',
    response,
  );
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

async function submitViduTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildViduPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz Vidu Q3 任务提交');
  const data = await responseJson(response, 'seedance.nz Vidu Q3 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.id || data?.task_id || data?.data?.id, 'seedance.nz Vidu Q3 任务提交', response);
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

async function submitWanTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildWanPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz Wan 视频任务提交');
  const data = await responseJson(response, 'seedance.nz Wan 视频任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.id || data?.task_id || data?.data?.id, 'seedance.nz Wan 视频任务提交', response);
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

function normalizeSunoOperation(value) {
  const operation = String(value || 'suno-generation').trim();
  if (!Object.prototype.hasOwnProperty.call(SUNO_ACTION_SPECS, operation)) {
    throw new Error(`未知 Suno 操作：${operation}`);
  }
  return operation;
}

function sunoTaskIdFromResponse(value, depth = 0) {
  if (depth > 8 || value == null) return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const taskId = sunoTaskIdFromResponse(item, depth + 1);
      if (taskId) return taskId;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of ['task_id', 'id']) {
    const candidate = String(value[key] || '').trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._:\-]{0,255}$/.test(candidate)) return candidate;
  }
  for (const key of ['data', 'result', 'task']) {
    const taskId = sunoTaskIdFromResponse(value[key], depth + 1);
    if (taskId) return taskId;
  }
  return '';
}

function sunoRequiredValuePresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return String(value ?? '').trim().length > 0;
}

function finiteSunoNumber(value, field, { min = 0, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) throw new Error(`Suno 参数 ${field} 必须是大于等于 ${min} 的数字`);
  return integer ? Math.trunc(number) : number;
}

async function buildSunoMusicPayload(request, apiKey, options = {}) {
  const operation = normalizeSunoOperation(request.operation);
  const spec = SUNO_ACTION_SPECS[operation];
  const payload = { model: 'suno' };
  const input = request && typeof request === 'object' ? request : {};

  if (spec.allowedVersions.length > 0) {
    const version = String(input.version || spec.defaultVersion || '').trim();
    if (!spec.allowedVersions.includes(version)) {
      throw new Error(`${operation} 的 version 仅支持：${spec.allowedVersions.join('、')}`);
    }
    payload.version = version;
  }

  for (const field of spec.allowedFields) {
    if (field === 'version' || field === 'audioFilePath' || field === 'audio_url' || field === 'audio_urls' || field === 'task_ids') continue;
    if (field === 'custom' || field === 'instrumental') {
      if (input[field] !== undefined) payload[field] = input[field] === true;
      continue;
    }
    if (field === 'audio_index') {
      payload.audio_index = finiteSunoNumber(input.audio_index ?? 1, field, { min: 1, integer: true });
      continue;
    }
    if (['continue_at', 'start_s', 'end_s', 'duration_s', 'speed'].includes(field)) {
      if (input[field] !== undefined && input[field] !== '') {
        payload[field] = finiteSunoNumber(input[field], field, { min: field === 'speed' ? 0.01 : 0 });
      }
      continue;
    }
    if (input[field] !== undefined && input[field] !== null) {
      const text = String(input[field]).trim();
      if (text) payload[field] = text;
    }
  }

  if (spec.referenceType === 'mashup') {
    const rawTaskIds = Array.isArray(input.task_ids)
      ? input.task_ids
      : [input.task_id, input.task_id_2];
    payload.task_ids = rawTaskIds.map((item) => String(item || '').trim()).filter(Boolean);
    if (payload.task_ids.length !== 2) throw new Error('Suno 双曲混合必须填写 2 个 task_id');
  } else if (operation === 'suno-upload') {
    const source = String(input.audioFilePath || input.audio_url || normalizeList(input.audioUrls)[0] || '').trim();
    if (source) payload.audioFilePath = await uploadMedia(source, 'audio', apiKey, options);
  } else if (operation === 'suno-create-voice') {
    const source = String(input.audio_url || input.audioFilePath || normalizeList(input.audioUrls)[0] || '').trim();
    if (source) payload.audio_url = await uploadMedia(source, 'audio', apiKey, options);
  } else if (operation === 'suno-inspo') {
    const sources = normalizeList(input.audio_urls || input.audioUrls).slice(0, SUNO_MAX_REFERENCE_AUDIOS);
    if (sources.length) {
      payload.audio_urls = [];
      for (const source of sources) payload.audio_urls.push(await uploadMedia(source, 'audio', apiKey, options));
    }
  }

  for (const field of spec.requiredFields) {
    if (!sunoRequiredValuePresent(payload[field])) throw new Error(`${operation} 缺少必填参数：${field}`);
  }
  if (payload.start_s !== undefined && payload.end_s !== undefined && payload.end_s <= payload.start_s) {
    throw new Error('Suno 参数 end_s 必须大于 start_s');
  }

  return {
    operation,
    action: spec.action,
    resultFamily: spec.resultFamily,
    sync: spec.sync,
    payload,
  };
}

function sunoMediaKind(key, url) {
  const keyText = String(key || '').toLowerCase();
  let extension = '';
  try {
    extension = path.extname(new URL(url).pathname).toLowerCase();
  } catch {}
  if (keyText.includes('image') || ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) return 'image';
  if (keyText.includes('video') || keyText.includes('mp4') || ['.mp4', '.mov', '.mkv', '.avi', '.webm'].includes(extension)) return 'video';
  if (keyText.includes('audio') || keyText.includes('wav') || ['.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac'].includes(extension)) return 'audio';
  return 'file';
}

function collectSunoArtifacts(value, key = '', artifacts = [], seen = new Set(), depth = 0) {
  if (depth > 12 || value == null) return artifacts;
  if (Array.isArray(value)) {
    for (const item of value) collectSunoArtifacts(item, key, artifacts, seen, depth + 1);
    return artifacts;
  }
  if (typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) {
      collectSunoArtifacts(child, childKey, artifacts, seen, depth + 1);
    }
    return artifacts;
  }
  if (typeof value !== 'string') return artifacts;
  const url = value.trim();
  if (!/^https?:\/\//i.test(url) || seen.has(url)) return artifacts;
  seen.add(url);
  artifacts.push({ url, kind: sunoMediaKind(key, url) });
  return artifacts;
}

function extractSunoText(value, depth = 0) {
  if (depth > 10 || value == null) return '';
  if (typeof value === 'string') return /^https?:\/\//i.test(value.trim()) ? '' : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const simple = value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
    if (simple.length === value.length && simple.length > 0) return JSON.stringify(simple);
    for (const item of value) {
      const text = extractSunoText(item, depth + 1);
      if (text) return text;
    }
    return '';
  }

  if (typeof value !== 'object') return '';
  for (const key of ['text', 'lyrics', 'tags', 'aligned_lyrics', 'bpm', 'persona_id', 'voice_id', 'audio_id', 'content', 'message']) {
    if (value[key] === undefined) continue;
    const text = extractSunoText(value[key], depth + 1);
    if (text) return text;
  }
  if (Array.isArray(value.music)) {
    for (const item of value.music) {
      for (const key of ['lyrics', 'title', 'audio_id']) {
        const text = extractSunoText(item?.[key], depth + 1);
        if (text) return text;
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (['id', 'task_id', 'status', 'progress'].includes(key)) continue;
    const text = extractSunoText(child, depth + 1);
    if (text) return text;
  }
  return '';
}

function normalizeSunoMusicResponse(data, options = {}) {
  const rawData = data?.data;
  const taskData = Array.isArray(rawData)
    ? (rawData.find((item) => item && typeof item === 'object') || {})
    : rawData && typeof rawData === 'object' ? rawData : data;
  const resultData = taskData?.result !== undefined ? taskData.result : taskData;
  const rawStatus = String(taskData?.status || data?.status || '').trim().toLowerCase();
  const taskId = sunoTaskIdFromResponse(data);
  let status = normalizeStatus(rawStatus);
  if (!rawStatus && (!taskId || options.sync)) status = 'succeeded';
  const artifacts = collectSunoArtifacts(resultData);
  const music = Array.isArray(resultData?.music) ? resultData.music : [];
  // Provider failure bodies are intentionally not reflected to the client:
  // some upstreams echo request headers or signed URLs inside nested errors.
  const failReason = status === 'failed' ? 'Suno 任务失败' : '';
  return {
    taskId,
    status,
    progress: safeProgress(taskData?.progress ?? data?.progress),
    resultFamily: options.resultFamily || 'audio',
    artifacts,
    music,
    text: extractSunoText(resultData),
    failReason,
  };
}

async function submitSunoMusicTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildSunoMusicPayload(request, apiKey, options);
  const suffix = built.action ? `/${built.action}` : '';
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/music/generations${suffix}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, `seedance.nz ${built.operation} 提交`);
  const data = await responseJson(response, `seedance.nz ${built.operation} 提交`);
  if (!response.ok) throw createUpstreamError(data, response);
  return {
    operation: built.operation,
    action: built.action,
    ...normalizeSunoMusicResponse(data, { sync: built.sync, resultFamily: built.resultFamily }),
    ...safeProviderTrace(response, data, { pollCount: 0 }),
  };
}

async function querySunoMusicTask(taskId, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('缺少贞贞的平价AI小屋 API Key');
  const safeTaskId = requiredTaskId(taskId, 'seedance.nz Suno 任务查询');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/music/tasks/${encodeURIComponent(safeTaskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, options, 'seedance.nz Suno 任务查询');
  const data = await responseJson(response, 'seedance.nz Suno 任务查询');
  if (!response.ok) throw createUpstreamError(data, response);
  return {
    ...normalizeSunoMusicResponse(data, { resultFamily: options.resultFamily }),
    taskId: safeTaskId,
    ...safeProviderTrace(response, data),
  };
}

function normalizeFlowMusicOperation(value) {
  const operation = String(value || 'flowmusic-generation').trim();
  if (!Object.prototype.hasOwnProperty.call(FLOWMUSIC_ACTION_SPECS, operation)) {
    throw new Error(`未知 Flow Music 操作：${operation}`);
  }
  return operation;
}

async function buildFlowMusicPayload(request, apiKey, options = {}) {
  const input = request && typeof request === 'object' ? request : {};
  const operation = normalizeFlowMusicOperation(input.operation);
  const spec = FLOWMUSIC_ACTION_SPECS[operation];
  const payload = { model: FLOWMUSIC_MODEL };

  if (spec.supportsLyria35) {
    const version = String(input.version || 'lyria-3.5').trim().toLowerCase();
    if (!FLOWMUSIC_VERSIONS.has(version)) {
      throw new Error(`${operation} 的 version 只支持 default 或 lyria-3.5`);
    }
    if (version !== 'default') payload.version = version;
  }

  for (const field of ['sound_prompt', 'lyrics', 'prompt', 'title', 'clip_id', 'instruction']) {
    if (!spec.allowedFields.includes(field)) continue;
    const value = String(input[field] ?? input[field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] ?? '').trim();
    if (value) payload[field] = value;
  }

  if (operation === 'flowmusic-generation') {
    if (!payload.sound_prompt && !payload.lyrics) {
      throw new Error('Flow Music 的 sound_prompt 与 lyrics 不能同时为空');
    }
    payload.bpm = String(finiteSunoNumber(input.bpm ?? 120, 'bpm', { min: 1, integer: true }));
    const length = finiteSunoNumber(input.length ?? 60, 'length', { min: 1, integer: true });
    if (length > 240) throw new Error('Flow Music 参数 length 必须在 1-240 秒之间');
    payload.length = length;
    payload.seed = finiteSunoNumber(input.seed ?? 0, 'seed', { min: 0, integer: true });
  } else if (operation === 'flowmusic-lyrics') {
    if (String(payload.prompt || '').length > 3000) throw new Error('flowmusic-lyrics 的 prompt 最多 3000 字符');
  } else if (operation === 'flowmusic-upload-audio') {
    const source = String(input.audio_url || input.audioUrl || normalizeList(input.audioUrls)[0] || '').trim();
    if (source) {
      const normalizedSource = normalizeT8LocalMediaRef(source);
      payload.audio_url = /^https?:\/\//i.test(normalizedSource) && !isT8LocalMediaPath(normalizedSource)
        ? normalizedSource
        : await uploadMedia(normalizedSource, 'audio', apiKey, options);
    }
  } else if (operation === 'flowmusic-extend') {
    payload.extend_from_s = finiteSunoNumber(input.extend_from_s ?? input.extendFromSeconds ?? 0, 'extend_from_s', { min: 0 });
    payload.extend_s = finiteSunoNumber(input.extend_s ?? input.extendSeconds ?? 30, 'extend_s', { min: 1, integer: true });
    if (payload.extend_s > 164) throw new Error('Flow Music 参数 extend_s 必须在 1-164 秒之间');
    payload.seed = finiteSunoNumber(input.seed ?? 0, 'seed', { min: 0, integer: true });
  } else if (operation === 'flowmusic-replace') {
    payload.start_s = finiteSunoNumber(input.start_s ?? input.startSeconds ?? 0, 'start_s', { min: 0 });
    payload.end_s = finiteSunoNumber(input.end_s ?? input.endSeconds ?? 10, 'end_s', { min: 0 });
    if (payload.end_s <= payload.start_s) throw new Error('Flow Music 参数 end_s 必须大于 start_s');
    payload.seed = finiteSunoNumber(input.seed ?? 0, 'seed', { min: 0, integer: true });
  } else if (operation === 'flowmusic-cover') {
    const strength = Number(input.strength ?? 0.5);
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
      throw new Error('Flow Music 参数 strength 必须在 0-1 之间');
    }
    payload.strength = strength;
    payload.seed = finiteSunoNumber(input.seed ?? 0, 'seed', { min: 0, integer: true });
  } else if (operation === 'flowmusic-download-audio') {
    const format = String(input.format || 'mp3').trim().toLowerCase();
    if (!FLOWMUSIC_FORMATS.has(format)) throw new Error(`Flow Music 不支持下载格式 ${format || '(空)'}`);
    payload.format = format;
  } else if (operation === 'flowmusic-video-clip') {
    const preset = String(input.preset || 'modern').trim().toLowerCase();
    if (!FLOWMUSIC_VIDEO_PRESETS.has(preset)) throw new Error(`Flow Music 不支持视频模板 ${preset || '(空)'}`);
    payload.preset = preset;
  }

  for (const field of spec.requiredFields) {
    if (!sunoRequiredValuePresent(payload[field])) throw new Error(`${operation} 缺少必填参数：${field}`);
  }
  return {
    operation,
    action: spec.action,
    resultFamily: spec.resultFamily,
    payload,
  };
}

function normalizeFlowMusicResponse(data, options = {}) {
  const rawData = data?.data;
  const taskData = Array.isArray(rawData)
    ? (rawData.find((item) => item && typeof item === 'object') || {})
    : rawData && typeof rawData === 'object' ? rawData : data;
  const resultData = taskData?.result !== undefined ? taskData.result : taskData;
  const rawStatus = String(taskData?.status || data?.status || '').trim().toLowerCase();
  const taskId = sunoTaskIdFromResponse(data);
  const status = normalizeStatus(rawStatus);
  const music = Array.isArray(resultData?.music) ? resultData.music : [];
  const clipIds = music.map((item) => String(item?.clip_id || '').trim()).filter(Boolean);
  return {
    taskId,
    status,
    progress: safeProgress(taskData?.progress ?? data?.progress),
    resultFamily: options.resultFamily || 'audio',
    artifacts: collectSunoArtifacts(resultData),
    music,
    clipIds,
    text: extractSunoText(resultData),
    failReason: status === 'failed' ? 'Flow Music 任务失败' : '',
  };
}

async function submitFlowMusicTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildFlowMusicPayload(request, apiKey, options);
  const suffix = built.action ? `/${built.action}` : '';
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/music/generations${suffix}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, `seedance.nz ${built.operation} 提交`);
  const data = await responseJson(response, `seedance.nz ${built.operation} 提交`);
  if (!response.ok) throw createUpstreamError(data, response);
  return {
    operation: built.operation,
    action: built.action,
    ...normalizeFlowMusicResponse(data, { resultFamily: built.resultFamily }),
    ...safeProviderTrace(response, data, { pollCount: 0 }),
  };
}

async function queryFlowMusicTask(taskId, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('缺少贞贞的平价AI小屋 API Key');
  const safeTaskId = requiredTaskId(taskId, 'Flow Music 任务查询');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/music/tasks/${encodeURIComponent(safeTaskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, options, 'seedance.nz Flow Music 任务查询');
  const data = await responseJson(response, 'seedance.nz Flow Music 任务查询');
  if (!response.ok) throw createUpstreamError(data, response);
  return {
    ...normalizeFlowMusicResponse(data, { resultFamily: options.resultFamily }),
    taskId: safeTaskId,
    ...safeProviderTrace(response, data),
  };
}

function normalizeAudioBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return Boolean(value);
}

function normalizeBoundedNumber(value, fallback, min, max, label) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}必须在 ${min}-${max} 之间`);
  }
  return parsed;
}

function validMinimaxCustomVoiceId(value) {
  const text = String(value || '').trim();
  return text.length >= 8
    && text.length <= 256
    && /^\p{L}[\p{L}\p{N}_-]*[\p{L}\p{N}]$/u.test(text);
}

async function buildAudioPayload(request, apiKey, options = {}) {
  const model = String(request.model || SEED_AUDIO_MODEL).trim().toLowerCase();
  if (!SEEDANCE_NZ_AUDIO_MODELS.has(model)) throw new Error(`未知 seedance.nz 音频模型：${model}`);

  if (QWEN3_TTS_MODELS.has(model)) {
    const prompt = String(request.prompt || '').trim();
    const voice = String(request.voice || '').trim();
    const languageType = String(request.languageType || request.language_type || 'Chinese').trim();
    if (!prompt) throw new Error(`${model} 必须填写合成文本`);
    if (!voice) throw new Error(`${model} 必须填写音色 ID`);
    if (!QWEN3_TTS_LANGUAGE_TYPES.has(languageType)) throw new Error(`${model} 不支持语言 ${languageType || '(空)'}`);
    const metadata = { voice, language_type: languageType };
    const instructions = String(request.instructions || '').trim();
    if (model === QWEN3_TTS_INSTRUCT_FLASH_MODEL && instructions) {
      metadata.instructions = instructions;
      metadata.optimize_instructions = normalizeAudioBoolean(
        request.optimizeInstructions ?? request.optimize_instructions,
        true,
      );
    }
    return { payload: { model, prompt, metadata }, model };
  }

  if (MINIMAX_AUDIO_MODELS.has(model)) {
    const prompt = String(request.prompt || '').trim();
    if (!prompt) throw new Error(`${model} 必须填写提示词或朗读文本`);
    let metadata;
    if (model === MINIMAX_MUSIC_MODEL) {
      const isInstrumental = normalizeAudioBoolean(request.isInstrumental ?? request.is_instrumental, true);
      const lyricsOptimizer = normalizeAudioBoolean(request.lyricsOptimizer ?? request.lyrics_optimizer, false);
      const outputFormat = String(request.outputFormat || request.output_format || 'mp3').trim().toLowerCase();
      const sampleRate = String(request.sampleRate || request.sample_rate || '32000').trim();
      const bitrate = String(request.bitrate || '128000').trim();
      if (!MINIMAX_AUDIO_FORMATS.has(outputFormat)) throw new Error(`${model} 不支持格式 ${outputFormat}`);
      if (!MINIMAX_SAMPLE_RATES.has(sampleRate)) throw new Error(`${model} 不支持采样率 ${sampleRate}`);
      if (!MINIMAX_BITRATES.has(bitrate)) throw new Error(`${model} 不支持码率 ${bitrate}`);
      const lyrics = String(request.lyrics || '').trim();
      if (!isInstrumental && !lyrics && !lyricsOptimizer) {
        throw new Error(`${model} 非纯音乐模式必须填写歌词或启用歌词生成`);
      }
      metadata = {
        is_instrumental: isInstrumental,
        lyrics_optimizer: lyricsOptimizer,
        format: outputFormat,
        sample_rate: sampleRate,
        bitrate,
      };
      if (!isInstrumental && lyrics) metadata.lyrics = lyrics;
    } else if (MINIMAX_SPEECH_MODELS.has(model)) {
      const voiceId = String(request.voiceId || request.voice_id || '').trim();
      if (!voiceId) throw new Error(`${model} 必须填写 voice_id`);
      const languageBoost = String(request.languageBoost || request.language_boost || 'auto').trim();
      const outputFormat = String(request.outputFormat || request.output_format || 'mp3').trim().toLowerCase();
      const sampleRate = String(request.sampleRate || request.sample_rate || '32000').trim();
      const bitrate = String(request.bitrate || '128000').trim();
      if (!MINIMAX_LANGUAGE_BOOSTS.has(languageBoost)) throw new Error(`${model} 不支持语言增强 ${languageBoost}`);
      if (!MINIMAX_AUDIO_FORMATS.has(outputFormat)) throw new Error(`${model} 不支持格式 ${outputFormat}`);
      if (!MINIMAX_SAMPLE_RATES.has(sampleRate)) throw new Error(`${model} 不支持采样率 ${sampleRate}`);
      if (!MINIMAX_BITRATES.has(bitrate)) throw new Error(`${model} 不支持码率 ${bitrate}`);
      metadata = {
        voice_id: voiceId,
        speed: normalizeBoundedNumber(request.speed, 1, 0.5, 2, `${model} 语速`),
        vol: normalizeBoundedNumber(request.volume ?? request.vol, 1, 0.000001, 10, `${model} 音量`),
        pitch: normalizeBoundedInteger(request.pitch, `${model} 音高`, -12, 12, 0),
        language_boost: languageBoost,
        format: outputFormat,
        sample_rate: sampleRate,
        bitrate,
        channel: normalizeBoundedInteger(request.channel, `${model} 声道`, 1, 2, 1),
      };
    } else {
      const audioSources = normalizeList(request.audioUrls || request.audios || request.referenceAudios);
      if (audioSources.length !== 1) throw new Error(`${model} 必须且只能提供 1 段 10 秒至 5 分钟的参考音频`);
      const customVoiceId = String(request.customVoiceId || request.custom_voice_id || '').trim();
      if (!validMinimaxCustomVoiceId(customVoiceId)) {
        throw new Error(`${model} custom_voice_id 必须为 8-256 位字母/数字/-/_，以字母开头且不能以 -/_ 结尾`);
      }
      const cloneTargetModel = String(
        request.cloneTargetModel || request.clone_target_model || MINIMAX_SPEECH_HD_MODEL,
      ).trim().toLowerCase();
      if (!MINIMAX_SPEECH_MODELS.has(cloneTargetModel)) throw new Error(`${model} 不支持目标语音模型 ${cloneTargetModel}`);
      metadata = {
        audio_url: await uploadMedia(audioSources[0], 'audio', apiKey, options),
        custom_voice_id: customVoiceId,
        model: cloneTargetModel,
        need_noise_reduction: normalizeAudioBoolean(request.needNoiseReduction ?? request.need_noise_reduction, false),
        need_volume_normalization: normalizeAudioBoolean(
          request.needVolumeNormalization ?? request.need_volume_normalization,
          false,
        ),
      };
    }
    return { payload: { model, prompt, metadata }, model };
  }

  if (MUREKA_BGM_MODELS.has(model)) {
    const prompt = String(request.prompt || '').trim();
    const instrumentalId = String(request.instrumentalId || request.instrumental_id || '').trim();
    if (Boolean(prompt) === Boolean(instrumentalId)) {
      throw new Error(`${model} 的 prompt 与 instrumental_id 必须且只能填写一个`);
    }
    const metadata = {
      n: normalizePositiveInteger(request.n, 1, 1, 3, `${model} 生成数量 n `),
      stream: false,
    };
    const payload = { model, metadata };
    if (prompt) payload.prompt = prompt;
    else metadata.instrumental_id = instrumentalId;
    return { payload, model };
  }

  const prompt = String(request.prompt || '').trim();
  if (prompt.length < 5 || prompt.length > 2048) {
    throw new Error('Seed Audio 提示词长度必须为 5-2048 字符');
  }

  const speaker = String(request.speaker || '').trim();
  const imageSources = normalizeList(request.images || request.refImages).slice(0, 1);
  const audioSources = normalizeList(request.audioUrls || request.audios || request.referenceAudios);
  if (audioSources.length > 3) throw new Error('Seed Audio 最多支持 3 段参考音频');
  const referenceModes = [!!speaker, imageSources.length > 0, audioSources.length > 0].filter(Boolean).length;
  if (referenceModes > 1) throw new Error('Seed Audio 的音色 ID、参考图和参考音频只能选择一种');

  const outputFormat = String(request.outputFormat || request.output_format || 'wav').trim().toLowerCase();
  if (!SEED_AUDIO_FORMATS.has(outputFormat)) throw new Error('Seed Audio 输出格式只支持 wav/mp3/pcm/ogg_opus');
  const sampleRate = String(request.sampleRate || request.sample_rate || '24000').trim();
  if (!SEED_AUDIO_SAMPLE_RATES.has(sampleRate)) throw new Error('Seed Audio 不支持该采样率');
  const metadata = {
    format: outputFormat,
    sample_rate: sampleRate,
    speech_rate: normalizeBoundedInteger(request.speechRate ?? request.speech_rate, 'Seed Audio 语速', -50, 100),
    loudness_rate: normalizeBoundedInteger(request.loudnessRate ?? request.loudness_rate, 'Seed Audio 音量', -50, 100),
    pitch_rate: normalizeBoundedInteger(request.pitchRate ?? request.pitch_rate, 'Seed Audio 音高', -12, 12),
  };
  if (speaker) metadata.speaker = speaker;

  const payload = { model, prompt, metadata };
  if (imageSources.length) {
    payload.images = [await uploadMedia(imageSources[0], 'image', apiKey, {
      ...options,
      allowedMimes: ['image/jpeg', 'image/png', 'image/webp'],
    })];
  }
  if (audioSources.length) {
    metadata.audio_urls = [];
    for (const source of audioSources) {
      metadata.audio_urls.push(await uploadMedia(source, 'audio', apiKey, options));
    }
  }
  return { payload, model };
}

async function submitAudioTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildAudioPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/audio/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz Seed Audio 任务提交');
  const data = await responseJson(response, 'seedance.nz Seed Audio 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.task_id || data?.id || data?.data?.task_id, 'seedance.nz Seed Audio 任务提交', response);
  return { taskId, model: built.model, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

async function queryAudioTask(taskId, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('缺少贞贞的平价AI小屋 API Key');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/audio/generations/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, options, 'seedance.nz Seed Audio 任务查询');
  const data = await responseJson(response, 'seedance.nz Seed Audio 任务查询');
  if (!response.ok) throw createUpstreamError(data, response);
  const record = data?.data && typeof data.data === 'object' ? data.data : data;
  const status = normalizeImageTaskStatus(record?.status || data?.status);
  const nested = record?.data && typeof record.data === 'object' ? record.data : {};
  const content = nested?.content && typeof nested.content === 'object' ? nested.content : {};
  const audioUrls = [];
  if (status === 'succeeded' && Array.isArray(content?.audio_urls)) {
    for (const value of content.audio_urls) {
      const url = String(value || '').trim();
      if (url) audioUrls.push(url);
    }
  }
  if (status === 'succeeded' && audioUrls.length === 0) {
    const primary = String(
      record?.result_url
      || record?.resultUrl
      || content?.audio_url
      || content?.audioUrl
      || content?.url
      || '',
    ).trim();
    if (primary) audioUrls.push(primary);
  }
  const resultText = status === 'succeeded'
    ? String(
      content?.voice_id
      || content?.custom_voice_id
      || content?.result_text
      || content?.text
      || nested?.voice_id
      || nested?.custom_voice_id
      || nested?.result_text
      || nested?.text
      || record?.voice_id
      || record?.custom_voice_id
      || record?.result_text
      || record?.text
      || '',
    ).trim()
    : '';
  const failReason = status === 'failed'
    ? String(
      record?.fail_reason
      || record?.failReason
      || nested?.error?.message
      || nested?.message
      || data?.message
      || '音频任务失败',
    ).trim() || '音频任务失败'
    : null;
  return {
    status,
    progress: safeProgress(record?.progress ?? data?.progress),
    audioUrl: audioUrls[0] || null,
    audioUrls,
    resultText,
    failReason,
    ...safeProviderTrace(response, data),
  };
}

function whisperExtension(file = {}) {
  const nameExtension = path.extname(String(file.fileName || '')).toLowerCase();
  if (WHISPER_FILE_EXTENSIONS.has(nameExtension)) return nameExtension;
  const mime = String(file.mime || '').split(';')[0].trim().toLowerCase();
  const mimeExtensions = {
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/flac': '.flac',
    'audio/mp4': '.m4a',
    'video/mp4': '.mp4',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/aac': '.aac',
    'audio/aiff': '.aiff',
    'audio/x-aiff': '.aiff',
  };
  return mimeExtensions[mime] || '';
}

function normalizeWhisperSegments(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.segments,
    payload.data?.segments,
    payload.result?.segments,
    payload.data?.result?.segments,
  ];
  const source = candidates.find((candidate) => Array.isArray(candidate));
  if (!source) return [];

  const normalized = [];
  let totalTextLength = 0;
  for (const raw of source.slice(0, WHISPER_MAX_SEGMENTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const start = Number(raw.start);
    const end = Number(raw.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) continue;
    const text = String(raw.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const remaining = WHISPER_MAX_SEGMENT_TEXT_TOTAL - totalTextLength;
    if (remaining <= 0) break;
    const boundedText = text.slice(0, Math.min(WHISPER_MAX_SEGMENT_TEXT_LENGTH, remaining));
    normalized.push({
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      text: boundedText,
    });
    totalTextLength += boundedText.length;
  }
  return normalized;
}

async function transcribeAudio(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const source = String(request.audioUrl || request.audio || request.source || '').trim();
  if (!source) throw new Error('Whisper 必须连接或上传 1 个音频/视频素材');
  const model = String(request.model || WHISPER_MODEL).trim().toLowerCase();
  if (model !== WHISPER_MODEL) throw new Error(`Whisper 仅支持模型 ${WHISPER_MODEL}`);
  const responseFormat = String(request.response_format || request.responseFormat || 'json').trim().toLowerCase();
  if (!WHISPER_RESPONSE_FORMATS.has(responseFormat)) {
    throw new Error('Whisper response_format 只支持 json、verbose_json、srt、text 或 vtt');
  }

  const file = await mediaBuffer(source, 'audio', 50 * 1024 * 1024, options);
  const extension = whisperExtension(file);
  if (!extension) {
    throw new Error('Whisper 不支持该文件格式；仅支持 mp3、wav、flac、m4a、mp4、ogg、opus、aac、aiff，不支持 webm');
  }
  const baseName = path.basename(String(file.fileName || 'whisper-input'), path.extname(String(file.fileName || '')));
  const fileName = `${baseName || 'whisper-input'}${extension}`;
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mime || defaultMime('audio') }), fileName);
  form.append('model', WHISPER_MODEL);
  form.append('response_format', responseFormat);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, options, 'seedance.nz Whisper 转写');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  let data;
  if (contentType.includes('application/json')) {
    data = await responseJson(response, 'seedance.nz Whisper 转写');
  } else {
    data = await response.text();
  }
  if (!response.ok) throw createUpstreamError(data, response);
  const text = typeof data === 'string'
    ? data
    : String(data?.text || data?.data?.text || data?.result?.text || '').trim();
  if (!text) throw new Error('Whisper 转写完成但未返回文本');
  const segments = responseFormat === 'verbose_json' ? normalizeWhisperSegments(data) : [];
  return {
    text,
    model: WHISPER_MODEL,
    responseFormat,
    segments,
    ...safeProviderTrace(response, typeof data === 'object' ? data : {}),
  };
}

async function submitImageTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildImagePayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/image/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz 图像任务提交');
  const data = await responseJson(response, 'seedance.nz 图像任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(
    data?.task_id || data?.id || data?.data?.task_id || data?.data?.id,
    'seedance.nz 图像任务提交',
    response,
  );
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

function normalizeImageTaskStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'SUCCEEDED') return 'succeeded';
  if (status === 'FAILURE' || status === 'FAILED' || status === 'CANCELLED' || status === 'CANCELED') return 'failed';
  if (status === 'IN_PROGRESS' || status === 'PROCESSING' || status === 'RUNNING') return 'running';
  return 'pending';
}

function imageTaskResultUrls(record, nested) {
  const urls = [];
  const add = (value) => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) urls.push(normalized);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    for (const key of ['url', 'image_url', 'imageUrl', 'result_url', 'resultUrl']) {
      add(value[key]);
    }
  };
  const documentedLayerUrls = nested?.content?.image_urls ?? nested?.content?.imageUrls;
  if (Array.isArray(documentedLayerUrls)) {
    add(documentedLayerUrls);
    if (urls.length) return urls;
  }
  const providerLayerResults = nested?.upstream?.response?.results;
  if (Array.isArray(providerLayerResults)) {
    add(providerLayerResults);
    if (urls.length) return urls;
  }
  for (const value of [
    record?.result_urls,
    record?.resultUrls,
    record?.images,
    nested?.content?.images,
    record?.result_url,
    record?.resultUrl,
    nested?.content?.image_url,
    nested?.content?.imageUrl,
  ]) add(value);
  return [...new Set(urls)];
}

async function queryImageTask(taskId, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('缺少贞贞的平价AI小屋 API Key');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/image/generations/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, options, 'seedance.nz 图像任务查询');
  const data = await responseJson(response, 'seedance.nz 图像任务查询');
  if (!response.ok) throw createUpstreamError(data, response);
  const record = data?.data && typeof data.data === 'object' ? data.data : data;
  const status = normalizeImageTaskStatus(record?.status || data?.status);
  const nested = record?.data && typeof record.data === 'object' ? record.data : {};
  const imageUrls = status === 'succeeded' ? imageTaskResultUrls(record, nested) : [];
  const operationResult = status === 'succeeded'
    ? (record?.content?.result || nested?.content?.result || data?.content?.result || null)
    : null;
  const failReason = status === 'failed'
    ? String(
      record?.fail_reason
      || record?.failReason
      || nested?.error?.message
      || nested?.message
      || data?.message
      || '图像任务失败',
    ).trim() || '图像任务失败'
    : null;
  return {
    status,
    progress: safeProgress(record?.progress ?? data?.progress),
    imageUrl: imageUrls[0] || null,
    imageUrls,
    operationResult,
    failReason,
    ...safeProviderTrace(response, data),
  };
}

async function buildHunyuan3dPayload(request, apiKey, options = {}) {
  const model = String(request.model || '').trim().toLowerCase();
  if (!HUNYUAN3D_MODELS.has(model)) throw new Error(`未知 Hunyuan 3D 模型：${model || '(空)'}`);
  const prompt = String(request.prompt || '').trim();
  if (!prompt) throw new Error('Hunyuan 3D 必须填写提示词');
  const faceCount = normalizePositiveInteger(request.face_count ?? request.faceCount, 500000, 10000, 1500000, 'face_count ');
  const generateType = String(request.generate_type || request.generateType || 'Normal').trim();
  if (!HUNYUAN3D_GENERATE_TYPES.has(generateType)) throw new Error(`Hunyuan 3D 不支持 generate_type ${generateType}`);
  const refs = normalizeList(request.images || request.refImages);
  if (model === HUNYUAN3D_TEXT_MODEL && refs.length) throw new Error('文生 3D 不接受参考图');
  if (model === HUNYUAN3D_IMAGE_MODEL && (refs.length < 1 || refs.length > 8)) throw new Error('图生 3D 必须提供 1-8 张有序视图');
  const payload = { model, prompt, face_count: faceCount, enable_pbr: request.enable_pbr === true || request.enablePbr === true, generate_type: generateType };
  if (refs.length) {
    payload.images = [];
    for (const source of refs) {
      payload.images.push(await uploadMedia(source, 'image', apiKey, {
        ...options,
        maxBytes: IMAGE_REFERENCE_MAX_BYTES,
        allowedMimes: ['image/jpeg', 'image/png'],
        cacheVariant: 'hunyuan3d-v31-image',
      }));
    }
  }
  return { payload, model, taskType: model === HUNYUAN3D_IMAGE_MODEL ? 'i3d' : 't3d' };
}

async function submitHunyuan3dTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先填写贞贞的平价AI小屋 API Key');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildHunyuan3dPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/3d/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz Hunyuan 3D 任务提交');
  const data = await responseJson(response, 'seedance.nz Hunyuan 3D 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.task_id || data?.id || data?.data?.task_id || data?.data?.id, 'seedance.nz Hunyuan 3D 任务提交', response);
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

function model3dResultUrls(value) {
  const urls = [];
  const visit = (item) => {
    if (typeof item === 'string') { if (/^https?:\/\//i.test(item.trim())) urls.push(item.trim()); return; }
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (!item || typeof item !== 'object') return;
    Object.values(item).forEach(visit);
  };
  visit(value);
  const score = (url) => {
    let pathname = '';
    try { pathname = new URL(url).pathname.toLowerCase(); } catch {}
    if (pathname.endsWith('.glb')) return 100;
    if (pathname.endsWith('.gltf')) return 80;
    if (pathname.endsWith('.zip')) return 10;
    return 0;
  };
  return [...new Set(urls)].sort((a, b) => score(b) - score(a));
}

async function queryHunyuan3dTask(taskId, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('缺少贞贞的平价AI小屋 API Key');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/3d/generations/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, options, 'seedance.nz Hunyuan 3D 任务查询');
  const data = await responseJson(response, 'seedance.nz Hunyuan 3D 任务查询');
  if (!response.ok) throw createUpstreamError(data, response);
  const record = data?.data && typeof data.data === 'object' ? data.data : data;
  const status = normalizeImageTaskStatus(record?.status || data?.status);
  // A successful Hunyuan response can include previews and ZIP sidecars beside
  // the actual GLB. Keep only the highest-confidence renderable model so the
  // materializer and 3D preview never receive an unrelated attachment.
  const rankedModelUrls = status === 'succeeded' ? model3dResultUrls(record) : [];
  const modelUrls = rankedModelUrls.length ? [rankedModelUrls[0]] : [];
  return {
    status,
    progress: safeProgress(record?.progress ?? data?.progress),
    modelUrl: modelUrls[0] || null,
    modelUrls,
    failReason: status === 'failed' ? String(record?.fail_reason || record?.failReason || record?.message || data?.message || '3D 任务失败') : null,
    ...safeProviderTrace(response, data),
  };
}

async function submitMinimaxH3ContextIrTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildMinimaxH3ContextIrPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/video/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz MiniMax H3 Context IR 任务提交');
  const data = await responseJson(response, 'seedance.nz MiniMax H3 Context IR 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(
    data?.task_id || data?.id || data?.data?.task_id || data?.data?.id,
    'seedance.nz MiniMax H3 Context IR 任务提交',
    response,
  );
  return {
    taskId,
    model: built.model,
    taskType: built.taskType,
    ...safeProviderTrace(response, data, { pollCount: 0 }),
  };
}

function normalizeMinimaxH3ContextIrStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(status)) return 'succeeded';
  if (['FAILURE', 'FAILED', 'CANCELED', 'CANCELLED'].includes(status)) return 'failed';
  if (['IN_PROGRESS', 'PROCESSING', 'RUNNING'].includes(status)) return 'running';
  return 'pending';
}

async function queryMinimaxH3ContextIrTask(taskId, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('缺少贞贞的平价AI小屋 API Key');
  const safeTaskId = requiredTaskId(taskId, 'seedance.nz MiniMax H3 Context IR 任务查询');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(
    fetchImpl,
    `${baseUrl}/v1/video/generations/${encodeURIComponent(safeTaskId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    options,
    'seedance.nz MiniMax H3 Context IR 任务查询',
  );
  const data = await responseJson(response, 'seedance.nz MiniMax H3 Context IR 任务查询');
  if (!response.ok) throw createUpstreamError(data, response);
  const record = data?.data && typeof data.data === 'object' ? data.data : data;
  const status = normalizeMinimaxH3ContextIrStatus(record?.status || data?.status);
  const resultText = status === 'succeeded'
    ? String(record?.result_text || data?.result_text || '').trim()
    : '';
  if (status === 'succeeded' && !resultText) {
    throw invalidResponseError('seedance.nz MiniMax H3 Context IR 任务完成但缺少 result_text', response);
  }
  const failReason = status === 'failed'
    ? String(
      record?.fail_reason
      || record?.failReason
      || record?.error?.message
      || data?.message
      || 'MiniMax H3 Context IR 任务失败',
    ).trim() || 'MiniMax H3 Context IR 任务失败'
    : null;
  return {
    status,
    progress: safeProgress(record?.progress ?? data?.progress),
    resultText,
    failReason,
    ...safeProviderTrace(response, data),
  };
}

async function submitFlux3Task(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildFlux3Payload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz FLUX 3 Video 任务提交');
  const data = await responseJson(response, 'seedance.nz FLUX 3 Video 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.id || data?.task_id || data?.data?.id, 'seedance.nz FLUX 3 Video 任务提交', response);
  return { taskId, model: built.model, taskType: built.taskType, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

async function submitTask(request, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('请先在 API 设置中填写“贞贞的平价AI小屋 API Key”');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const built = await buildPayload(request, apiKey, options);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(built.payload),
  }, options, 'seedance.nz 任务提交');
  const data = await responseJson(response, 'seedance.nz 任务提交');
  if (!response.ok) throw createUpstreamError(data, response);
  const taskId = requiredTaskId(data?.id || data?.task_id || data?.data?.id, 'seedance.nz 任务提交', response);
  return { taskId, taskType: built.taskType, model: built.model, ...safeProviderTrace(response, data, { pollCount: 0 }) };
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'completed' || status === 'success' || status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'failure' || status === 'cancelled' || status === 'canceled') return 'failed';
  if (status === 'in_progress' || status === 'processing' || status === 'running') return 'running';
  return 'pending';
}

async function queryTask(taskId, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('缺少贞贞的平价AI小屋 API Key');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(fetchImpl, `${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, options, 'seedance.nz 任务查询');
  const data = await responseJson(response, 'seedance.nz 任务查询');
  if (!response.ok) throw createUpstreamError(data, response);
  const status = normalizeStatus(data?.status || data?.data?.status);
  const metadata = data?.metadata || data?.data?.metadata || {};
  return {
    status,
    progress: safeProgress(data?.progress ?? data?.data?.progress),
    videoUrl: status === 'succeeded'
      ? String(metadata?.url || data?.url || data?.data?.url || '').trim() || null
      : null,
    draftCache: status === 'succeeded'
      ? String(metadata?.draft_cache || data?.draft_cache || data?.data?.draft_cache || '').trim() || null
      : null,
    failReason: status === 'failed' ? 'Seedance 任务失败' : null,
    ...safeProviderTrace(response, data),
  };
}

async function queryFashVsrTask(taskId, apiKey, options = {}) {
  if (!String(apiKey || '').trim()) throw new Error('缺少贞贞的平价AI小屋 API Key');
  const fetchImpl = getFetchImpl(options);
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const response = await fetchProviderResponse(
    fetchImpl,
    `${baseUrl}/v1/video/generations/${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    options,
    'seedance.nz FlashVSR 任务查询',
  );
  const data = await responseJson(response, 'seedance.nz FlashVSR 任务查询');
  if (!response.ok) throw createUpstreamError(data, response);
  const body = data?.data && typeof data.data === 'object' ? data.data : data;
  const status = normalizeStatus(body?.status || body?.data?.status);
  const videoUrl = String(
    body?.result_url
    || body?.resultUrl
    || body?.video_url
    || body?.videoUrl
    || body?.data?.result_url
    || body?.data?.content?.video_url
    || body?.content?.video_url
    || '',
  ).trim();
  return {
    status,
    progress: safeProgress(body?.progress ?? body?.data?.progress),
    videoUrl: status === 'succeeded' ? videoUrl || null : null,
    failReason: status === 'failed' ? 'FlashVSR 视频超分任务失败' : null,
    ...safeProviderTrace(response, data),
  };
}

function resetCachesForTests() {
  uploadCache.clear();
  uploadQueues.clear();
}

module.exports = {
  BASE_URL,
  HAILUO23_I2V_MODELS,
  HAILUO23_MODELS,
  HAILUO23_RESOLUTIONS,
  HAILUO23_SECONDS,
  HAILUO23_T2V_MODELS,
  HAILUO_H3_I2V_MODEL,
  HAILUO_H3_GLOBAL_I2V_MODEL,
  HAILUO_H3_GLOBAL_MULTI_MODEL,
  HAILUO_H3_GLOBAL_T2V_MODEL,
  HAILUO_H3_I2V_MODELS,
  HAILUO_H3_MODELS,
  HAILUO_H3_MULTI_MODEL,
  HAILUO_H3_MULTI_MODELS,
  HAILUO_H3_RESOLUTIONS,
  HAILUO_H3_SECONDS,
  HAILUO_H3_MAX_MODELS,
  HAILUO_H3_MAX_RATIOS,
  HAILUO_H3_MAX_RESOLUTIONS,
  HAILUO_H3_MAX_STANDARD_RESOLUTIONS,
  HAILUO_H3_MAX_TURBO_RESOLUTIONS,
  HAILUO_H3_MAX_TURBO_MODELS,
  HAILUO_H3_MAX_T2V_MODELS,
  HAILUO_H3_MAX_I2V_MODELS,
  HAILUO_H3_T2V_MODEL,
  HAILUO_H3_T2V_MODELS,
  HAILUO_MODELS,
  MINMAX_H3_CONTEXT_IR_IMAGE_MODEL,
  MINMAX_H3_CONTEXT_IR_MAX_AUDIOS,
  MINMAX_H3_CONTEXT_IR_MAX_IMAGES,
  MINMAX_H3_CONTEXT_IR_MAX_VIDEOS,
  MINMAX_H3_CONTEXT_IR_MODELS,
  MINMAX_H3_CONTEXT_IR_MULTIMODAL_MODEL,
  MINMAX_H3_CONTEXT_IR_MULTIMODAL_RATIOS,
  MINMAX_H3_CONTEXT_IR_SECONDS,
  MINMAX_H3_CONTEXT_IR_TEXT_MODEL,
  MINMAX_H3_CONTEXT_IR_TEXT_RATIOS,
  FLUX3_DRAFT_ENHANCE_MODELS,
  FLUX3_I2V_MODELS,
  FLUX3_RATIOS,
  FLUX3_RESOLUTIONS,
  FLUX3_SECONDS,
  FLUX3_T2V_MODELS,
  FLUX3_V2V_MODELS,
  FLUX3_VIDEO_MODELS,
  MINIMAX_H3_OW_I2V_MODEL,
  MINIMAX_H3_OW_I2V_MODELS,
  MINIMAX_H3_OW_FAST_I2V_MODEL,
  MINIMAX_H3_OW_FAST_FL2VA_AUDIO_MODEL,
  MINIMAX_H3_OW_FAST_MODELS,
  MINIMAX_H3_OW_FAST_REF2VA_AUDIO_MODEL,
  MINIMAX_H3_OW_FAST_R2V_MODEL,
  MINIMAX_H3_OW_FAST_T2V_MODEL,
  MINIMAX_H3_OW_AUDIO_DRIVE_MODELS,
  MINIMAX_H3_OW_MODELS,
  MINIMAX_H3_OW_R2V_MODEL,
  MINIMAX_H3_OW_R2V_MODELS,
  MINIMAX_H3_OW_RESOLUTIONS,
  MINIMAX_H3_OW_SECONDS,
  MINIMAX_H3_OW_T2V_MODEL,
  MINIMAX_H3_OW_T2V_MODELS,
  KLING_EDIT_MODELS,
  KLING_I2V_MODELS,
  KLING_MODELS,
  KLING_R2V_MODELS,
  KLING_SECONDS,
  KLING_T2V_MODELS,
  KLING_VIDEO_MODELS,
  VIDU_Q3_I2V_MODELS,
  VIDU_Q3_MODELS,
  VIDU_Q3_R2V_MODELS,
  VIDU_Q3_RESOLUTIONS,
  VIDU_Q3_SECONDS,
  VIDU_Q3_SHORT_PLAY_MODELS,
  VIDU_Q3_START_END_MODELS,
  VIDU_Q3_T2V_MODELS,
  VIDU_Q3_VIDEO_MODELS,
  HAPPYHORSE_MODELS,
  HAPPYHORSE_RESOLUTIONS,
  IMAGE_MODEL_PAIRS,
  IMAGE_MODELS,
  IMAGE_RESOLUTIONS,
  SEEDREAM_LAYER_DECOMPOSITION_MODEL,
  DOLA_SEEDREAM_LAYER_DECOMPOSITION_MODEL,
  SEEDREAM_LAYER_DECOMPOSITION_MODELS,
  SEEDREAM_LAYER_RESOLUTIONS,
  QWEN_IMAGE_30_I2I_MODELS,
  QWEN_IMAGE_30_MODELS,
  QWEN_IMAGE_30_RATIOS,
  QWEN_IMAGE_30_RESOLUTIONS,
  QWEN_IMAGE_30_T2I_MODELS,
  WAN27_GLOBAL_T2I_MODEL,
  WAN27_GLOBAL_I2I_MODEL,
  WAN27_GLOBAL_I2I_PRO_MODEL,
  WAN27_GLOBAL_I2I_MODELS,
  WAN27_GLOBAL_IMAGE_MODELS,
  MIDJOURNEY_ACTION_SPECS,
  MIDJOURNEY_ANIMATE_MODES,
  MIDJOURNEY_BATCH_SIZES,
  MIDJOURNEY_DIMENSIONS,
  MIDJOURNEY_DIRECTIONS,
  MIDJOURNEY_MOTIONS,
  MIDJOURNEY_QUALITIES,
  MIDJOURNEY_SPEEDS,
  MIDJOURNEY_VERSIONS,
  MIDJOURNEY_VIDEO_TYPES,
  ZHENZHEN_IMAGE_G2_I2I_MODEL,
  ZHENZHEN_IMAGE_G2_MODELS,
  ZHENZHEN_IMAGE_G2_RATIOS,
  ZHENZHEN_IMAGE_G2_T2I_MODEL,
  ZHENZHEN_APIMART_IMAGE_MODELS,
  ZHENZHEN_APIMART_VIDEO_MODELS,
  ZHENZHEN_IMAGE_G_V2_LOWPRICE_MODEL,
  ZHENZHEN_IMAGE_GK_V2_MODEL,
  ZHENZHEN_IMAGE_GK_V2_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V2_SEGMENT_MODEL,
  ZHENZHEN_IMAGE_GK_V2_REGION_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V15_EDIT_MODEL,
  ZHENZHEN_IMAGE_GK_V15_MODEL,
  ZHENZHEN_IMAGE_NB_2_LITE_MODEL,
  ZHENZHEN_IMAGE_NB_2_MODEL,
  ZHENZHEN_IMAGE_NB_PRO_MODEL,
  ZHENZHEN_IMAGE_NB_MODELS,
  ZHENZHEN_VIDEO_G_OMNI_FLASH_MODEL,
  ZHENZHEN_VIDEO_G_OMNI_FLASH_LOWPRICE_MODEL,
  ZHENZHEN_VIDEO_G_OMNI_11_FLASH_LOWPRICE_MODEL,
  ZHENZHEN_VIDEO_GK_V15_MODEL,
  ZHENZHEN_VIDEO_V31_FAST_MODEL,
  ZHENZHEN_VIDEO_V31_LITE_MODEL,
  ZHENZHEN_VIDEO_V31_QUALITY_MODEL,
  ZHENZHEN_UPSCALER_MODEL,
  ZHENZHEN_UPSCALER_RESOLUTIONS,
  FASHVSR_VIDEO_UPSCALE_MODEL,
  HUNYUAN3D_TEXT_MODEL,
  HUNYUAN3D_IMAGE_MODEL,
  HUNYUAN3D_MODELS,
  HUNYUAN3D_GENERATE_TYPES,
  PROVIDER_ID,
  RATIOS,
  RESOLUTIONS,
  SEEDANCE25_I2V_MODELS,
  SEEDANCE25_MODELS,
  SEEDANCE25_MULTI_MODELS,
  SEEDANCE25_MULTI_LIMITS,
  SEEDANCE25_RESOLUTIONS,
  SEEDANCE25_T2V_MODELS,
  SEED_AUDIO_FORMATS,
  SEED_AUDIO_MODEL,
  SEED_AUDIO_SAMPLE_RATES,
  QWEN3_TTS_FLASH_MODEL,
  QWEN3_TTS_INSTRUCT_FLASH_MODEL,
  QWEN3_TTS_MODELS,
  QWEN3_TTS_LANGUAGE_TYPES,
  MINIMAX_MUSIC_MODEL,
  MINIMAX_SPEECH_HD_MODEL,
  MINIMAX_SPEECH_TURBO_MODEL,
  MINIMAX_VOICE_CLONE_MODEL,
  MINIMAX_SPEECH_MODELS,
  MINIMAX_AUDIO_MODELS,
  MINIMAX_AUDIO_FORMATS,
  MINIMAX_SAMPLE_RATES,
  MINIMAX_BITRATES,
  MINIMAX_LANGUAGE_BOOSTS,
  MUREKA_BGM_MODELS,
  FLOWMUSIC_MODEL,
  FLOWMUSIC_VERSIONS,
  FLOWMUSIC_FORMATS,
  FLOWMUSIC_VIDEO_PRESETS,
  FLOWMUSIC_ACTION_SPECS,
  SEEDANCE_NZ_AUDIO_MODELS,
  SUNO_ACTION_SPECS,
  SUNO_VERSIONS,
  WHISPER_MODEL,
  WHISPER_RESPONSE_FORMATS,
  WAN27_SPICY_MODEL,
  WAN27_SPICY_RESOLUTIONS,
  WAN30_I2V_MODELS,
  WAN30_R2V_MODELS,
  WAN30_MODELS,
  WAN30_THINKING_MODELS,
  WAN30_SECONDS,
  WAN30_RESOLUTIONS,
  WAN30_RATIOS,
  buildAudioPayload,
  buildFlowMusicPayload,
  buildSunoMusicPayload,
  buildHailuoPayload,
  buildMinimaxH3ContextIrPayload,
  buildFlux3Payload,
  buildKlingPayload,
  buildUpscalerPayload,
  buildFashVsrPayload,
  buildViduPayload,
  buildHappyHorsePayload,
  buildWan30Payload,
  buildWanPayload,
  buildPayload,
  buildSeedance25Payload,
  buildApimartImagePayload,
  buildApimartVideoPayload,
  buildHunyuan3dPayload,
  buildImagePayload,
  buildSeedreamLayerDecompositionPayload,
  buildQwenImage30Payload,
  buildWan27GlobalImagePayload,
  buildMidjourneyPayload,
  buildZhenzhenImageG2Payload,
  deriveTaskType,
  fetchRemote: secureFetch,
  normalizePromptMentions,
  normalizeResolution,
  queryImageTask,
  submitHunyuan3dTask,
  queryHunyuan3dTask,
  queryMinimaxH3ContextIrTask,
  queryMidjourneyTask,
  queryAudioTask,
  queryFlowMusicTask,
  querySunoMusicTask,
  queryTask,
  queryFashVsrTask,
  resetCachesForTests,
  resolveModel,
  seedancePublicDnsLookup,
  submitAudioTask,
  submitFlowMusicTask,
  submitSunoMusicTask,
  submitHailuoTask,
  submitFlux3Task,
  submitKlingTask,
  submitUpscalerTask,
  submitFashVsrTask,
  submitViduTask,
  submitHappyHorseTask,
  submitImageTask,
  submitMinimaxH3ContextIrTask,
  submitMidjourneyAction,
  submitTask,
  submitWanTask,
  transcribeAudio,
  uploadMedia,
  normalizeMidjourneyResponse,
};
