import type { NodeMeta } from '../types/canvas';
import type { UiLocale } from './index';

export interface EnglishNodeCopy {
  label: string;
  description: string;
  aliases?: string[];
}

export const DEV_ENGLISH_NODE_CATALOG: Record<string, EnglishNodeCopy> = {
  'rh-toolbox-maker': { label: 'RH Toolbox Builder', description: 'Developer-only editor for RH Toolbox manifest templates.' },
  'fal-toolbox-maker': { label: 'FAL App Builder', description: 'Developer-only generator for Fal Marketplace manifests from Fal.ai API documentation.' },
};

/**
 * English display copy is keyed by the stable node type. Chinese remains the
 * canonical copy in canvasNodeSchema.json. Keeping the second locale separate
 * makes a newly-added schema node fail the coverage gate until its English
 * copy is deliberately supplied, without ever persisting translated labels in
 * a canvas document.
 */
export const ENGLISH_NODE_CATALOG: Record<string, EnglishNodeCopy> = {
  upload: { label: 'Upload Material', description: 'Upload images, video, or audio through one adaptive output node.' },
  'model-3d-upload': { label: 'Upload 3D Material', description: 'Upload GLB, GLTF, OBJ, STL, FBX, USDZ, or ZIP models and create a 3D preview node.' },
  'model-3d-preview': { label: '3D Model Preview', description: 'Preview a 3D model, access its original download, and output a snapshot from the current view.' },
  'model-3d': { label: '3D', description: 'Extensible 3D generation with Hunyuan 3D v3.1 text-to-3D and ordered multi-view image-to-GLB.' },
  'grok-image-tools': { label: 'Grok Segmentation Editor', description: 'Segment one image, retain object IDs, and edit by object, bounding box, or selection.' },
  'material-set': { label: 'Material Set', description: 'Collect and reorder same-kind text, image, video, or audio materials for generation and RH nodes.' },
  'generation-target': { label: 'Generation Target', description: 'Reserve an output position, then replace it with generated or edited image results.' },
  output: { label: 'Output Material', description: 'Preview upstream text, image, video, audio, and 3D results with native aspect ratios.' },
  'volcengine-assets': { label: 'Volcengine Asset Library', description: 'Browse, organize, import, tag, and reference private Volcengine Ark image, video, and audio assets.' },
  'feishu-bitable-input': { label: 'Feishu Bitable Input', description: 'Read Feishu or Lark Bitable records as text, image, video, audio, and row metadata.' },
  'feishu-bitable-output': { label: 'Feishu Bitable Output', description: 'Create or update Feishu or Lark Bitable records with text and attachment fields.' },
  text: { label: 'Text', description: 'Prompt text node.' },
  image: { label: 'Image', description: 'Multi-tab image generation with GPT Image 2, Nano Banana, Grok, Seedream, Qwen Image 3.0, and Midjourney.' },
  video: { label: 'Video', description: 'Multi-model video generation with Veo, Grok, Hailuo, MiniMax H3 OW, and more.' },
  'video-edit': { label: 'Video Editor', description: 'Collect, trim, reorder, transition, filter, and merge clips into a standard video asset.' },
  seedance: { label: 'SD2.0', description: 'Seedance 2.0 video storyboard generation.' },
  seedance25: { label: 'SD2.5', description: 'Seedance 2.5 Standard text, first/last-frame, and multimodal reference video generation.' },
  'fashvsr-video-upscale': { label: 'FlashVSR Video Upscale', description: 'Upscale one 480p, 3–15 second video through Zhenzhen Affordable AI.' },
  'director-storyboard': { label: 'Director Storyboard', description: 'Long-form shot planning with prompts, references, and unlimited concurrent Seedance 2.0 generation.' },
  story: { label: 'Story Automated Production', description: 'Turn a script into shots, assets, prompts, SD2.0 clips, and a finished video with step-by-step control.' },
  'script-master': { label: 'Script Master', description: 'Professional script analysis, stable asset binding, multitrack timeline, and capability-aware PromptPack compilation.' },
  audio: { label: 'Audio', description: 'Generate audio with Suno, Seed Audio, Qwen3-TTS, MiniMax, or Mureka, and transcribe speech with Whisper.' },
  llm: { label: 'LLM', description: 'GPT-5, Claude 4.5, and Gemini 2.5 with independent API keys.' },
  'minimax-h3-prompt-enhancer': { label: 'MiniMax H3 Prompt Enhancer', description: 'Enhance T2VA, I2VA, FL2VA, L2VA, and Ref2VA prompts with H3 skills, presets, multimodal understanding, and selectable LLM channels.' },
  'minimax-music3-prompt-enhancer': { label: 'MiniMax Music Prompt Enhancer', description: 'Plan songs and lyrics with the Music 3 skill, controlled rewrites, templates, privacy isolation, and selectable LLM channels.' },
  'minimax-h3-official-prompt-enhancer': { label: 'Official MiniMax H3 Prompt Enhancer', description: 'Enhance prompts through official asynchronous Context IR text, image, and multimodal models.' },
  'seedance20-prompt-enhancer': { label: 'Seedance 2.0 Prompt Enhancer', description: 'Enhance generation, first/last-frame, reference, edit, extend, and track prompts with multimodal understanding.' },
  'mv-music-master': { label: 'MV Music Master', description: 'Build a recoverable MV from song, lyrics, identity, style, semantic segments, storyboard images, clips, and the original audio track.' },
  runninghub: { label: 'RunningHub', description: 'Primary RunningHub workflow node.' },
  'runninghub-wallet': { label: 'RH Wallet App', description: 'RunningHub wallet-app workflow using the shared RunningHub API key.' },
  'rh-config': { label: 'RH Configuration', description: 'Inject parameters into RunningHub workflows.' },
  'rh-tools': { label: 'RH Marketplace', description: 'Browse, search, and run categorized RunningHub AI applications from one launcher.' },
  'rh-toolbox': { label: 'RH Toolbox', description: 'Curated read-only RunningHub tools reusable by image, video, text, and audio nodes.' },
  ...(import.meta.env?.DEV ? DEV_ENGLISH_NODE_CATALOG : {}),
  vibex: { label: 'VibeX Workspace', description: 'Embed local or online VibeX and return video, image, audio, and prompts to the canvas.' },
  'fal-toolbox': { label: 'Fal Marketplace', description: 'Run categorized Fal.ai capabilities from upstream text, image, video, or audio.' },
  'grok-oauth-agent': { label: 'Grok OAuth Agent', description: 'Standalone Grok/xAI OAuth workspace for streaming chat, image, video, TTS, and STT.' },
  'codex-cli-agent': { label: 'Codex CLI Agent', description: 'Creator-focused Codex CLI workspace with streaming chat, image prompts, skills, assets, and version history.' },
  'codex-image-conjure': { label: 'Codex Image Workspace', description: 'Image workspace powered by Codex image generation, prompt templates, fragments, references, and a public gallery.' },
  'artist-style-master': { label: 'Artist Style Master', description: 'Search the qiaomu artist library by artist, Chinese name, movement, or tag and output style prompts or references.' },
  'anime-tag-master': { label: 'Anime Tag Master', description: 'Search lazy-loaded Danbooru and Gelbooru tags and references, save custom tags, and output tags or images.' },
  'comfyui-store': { label: 'ComfyUI Marketplace', description: 'Import prepared ComfyUI workflow apps and run them with upstream materials.' },
  'comfyui-app-maker': { label: 'ComfyUI App Builder', description: 'Upload a ComfyUI API Workflow JSON, detect parameters, and save a reusable app.' },
  'multi-angle-3d': { label: 'Multi-angle 3D', description: 'Generate multiple 3D views.' },
  'panorama-720': { label: '720 Panorama', description: 'Generate a 720-degree panorama.' },
  'penguin-portrait': { label: 'Penguin Portrait', description: 'Portrait-specific workflow.' },
  'portrait-metadata': { label: 'Portrait Metadata', description: 'Manage portrait parameters.' },
  'storyboard-grid': { label: 'Storyboard Grid', description: 'Nine-panel storyboard layout.' },
  'drawing-board': { label: 'Drawing Board', description: 'Draw, annotate, and combine upstream images into a new image output.' },
  browser: { label: 'Browser', description: 'Embedded web page.' },
  'image-compare': { label: 'Image Compare', description: 'Compare two images with slider, side-by-side, overlay, heatmap, or focus views.' },
  'frame-extractor': { label: 'Frame Extractor', description: 'Extract frames from video.' },
  'frame-pair': { label: 'First & Last Frames', description: 'Extract the first and last frames from a video as separate outputs.' },
  loop: { label: 'Loop', description: 'Drive downstream generation sequentially or clone a subgraph in parallel for multiple same-kind materials.' },
  'random-route': { label: 'Random Route', description: 'Route upstream material through a chosen number of randomly selected output branches at runtime.' },
  subflow: { label: 'Subflow', description: 'Reusable versioned node flow with explicit ports, parameter overrides, and internal run tracking.' },
  'pick-from-set': { label: 'Pick from Set', description: 'Select one material by index from an upstream collection and switch its kind in the node.' },
  'text-split': { label: 'Text Split', description: 'Split long text by paragraph, line, intelligent shot, regular expression, delimiter, or length.' },
  resize: { label: 'Resize', description: 'Resize images.' },
  combine: { label: 'Combine', description: 'Combine images.' },
  'remove-bg': { label: 'Remove Background', description: 'Remove image backgrounds.' },
  upscale: { label: 'Upscale', description: 'Upscale images.' },
  'grid-crop': { label: 'Grid Crop', description: 'Split an image into a grid.' },
  'grid-editor': { label: 'Grid Editor', description: 'Arrange multi-image storyboard grids and split them back in order.' },
  edit: { label: 'Edit', description: 'Edit an image or local region.' },
  idea: { label: 'Idea', description: 'Capture creative ideas.' },
  bp: { label: 'BP Blueprint', description: 'Blueprint planning node.' },
  relay: { label: 'Relay', description: 'Relay data between nodes.' },
  'remove-ai-watermark': { label: 'Remove AI Watermark', description: 'Remove visible or invisible AI watermarks, erase regions, clear metadata, and inspect marks.' },
  'video-output': { label: 'Video Output', description: 'Display video results.' },
  cinematic: { label: 'Cinematic Look', description: 'Combine style, camera, lighting, grading, and texture presets with favorites and JSON import/export.' },
  'video-motion': { label: 'Video Motion', description: 'Combine scene, action, path, rhythm, stability, and subject constraints with favorites and JSON import/export.' },
  'multi-angle-visual': { label: 'Visual Multi-angle', description: 'Adjust azimuth, elevation, and distance with batch angles, prompt mode, favorites, and JSON import/export.' },
  'portrait-master': { label: 'Portrait Master', description: 'Design portrait prompts across facial features, hair, clothing, accessories, mood, weights, locks, and randomization.' },
  'pose-master': { label: 'Pose Master', description: 'Edit multi-person line-art poses and output OpenPose/COCO previews, keypoints JSON, and prompts.' },
  'aggregate-parser': { label: 'Aggregate Parser', description: 'Parse compliant short links, share codes, or shared text with local output by default and optional remote parsing.' },
  'batch-processor': { label: 'Batch Material Processor', description: 'Import files or folders and batch rename, crop bars, remove backgrounds, outpaint, and upscale.' },
  'batch-tagger': { label: 'Batch Tagger', description: 'Generate tags, captions, natural language, or JSON sidecars for imported image and video assets.' },
  'topaz-image-upscale': { label: 'Topaz Image Upscale', description: 'Upscale upstream images through a locally installed and licensed Topaz Gigapixel AI.' },
  'topaz-video-upscale': { label: 'Topaz Video Upscale', description: 'Upscale and interpolate upstream video through a locally installed and licensed Topaz Video AI.' },
  'face-expression-3d': { label: '3D Expression Editor', description: 'Edit 52-channel 3D facial expressions with photo calibration, camera, lighting, and 1K–4K batch export.' },
  'previs-studio': { label: 'White-model Previs', description: 'Build white-model scenes with 67-bone IK, cameras, and keyframes, then export Seedance still and motion references.' },
  'panorama-3d': { label: '3D Panorama', description: 'Preview Three.js 360 panoramas and generate 21:9 panorama textures with GPT Image 2.' },
};

export const NODE_GROUP_COPY: Record<string, { 'zh-CN': string; 'en-US': string }> = {
  input: { 'zh-CN': '素材资源', 'en-US': 'Materials' },
  core: { 'zh-CN': '核心节点', 'en-US': 'Core Nodes' },
  rh: { 'zh-CN': 'RH', 'en-US': 'RH' },
  fal: { 'zh-CN': 'FAL工具箱', 'en-US': 'FAL Toolbox' },
  grok: { 'zh-CN': 'GROK OAuth', 'en-US': 'GROK OAuth' },
  codex: { 'zh-CN': 'CODEX CLI', 'en-US': 'CODEX CLI' },
  inspiration: { 'zh-CN': '灵感之源', 'en-US': 'Inspiration' },
  comfyui: { 'zh-CN': 'ComfyUI', 'en-US': 'ComfyUI' },
  special: { 'zh-CN': '特殊节点', 'en-US': 'Special Nodes' },
  utility: { 'zh-CN': '工具节点', 'en-US': 'Utilities' },
  auxiliary: { 'zh-CN': '辅助节点', 'en-US': 'Auxiliary' },
  toolbox: { 'zh-CN': '工具箱', 'en-US': 'Toolbox' },
  '3d': { 'zh-CN': '3D', 'en-US': '3D' },
};

export function nodeLabelKey(type: string) {
  return `nodes.catalog.${type}.label`;
}

export function nodeDescriptionKey(type: string) {
  return `nodes.catalog.${type}.description`;
}

export function localizeNodeMeta(meta: NodeMeta, locale: UiLocale): NodeMeta {
  if (locale === 'zh-CN') return meta;
  const copy = ENGLISH_NODE_CATALOG[meta.type];
  return copy ? { ...meta, label: copy.label, description: copy.description } : meta;
}

export function getNodeSearchText(meta: NodeMeta, locale: UiLocale) {
  const english = ENGLISH_NODE_CATALOG[meta.type];
  return [
    meta.type,
    meta.label,
    meta.description,
    english?.label,
    english?.description,
    ...(english?.aliases || []),
  ].filter(Boolean).join('\n').toLocaleLowerCase(locale);
}
