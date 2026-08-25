/**
 * T8-penguin-canvas 节点类型定义
 * 与 features.json 节点清单严格对齐(24 节点 + 4 已弃)
 */

// 节点类型(25 种保留 = 24 + upload)
export type NodeType =
  // Core (9)
  | 'text'
  | 'image'
  | 'video'
  | 'video-edit'
  | 'seedance'
  | 'seedance25'
  | 'fashvsr-video-upscale'
  | 'director-storyboard'
  | 'story'
  | 'script-master'
  | 'minimax-h3-prompt-enhancer'
  | 'minimax-music3-prompt-enhancer'
  | 'minimax-h3-official-prompt-enhancer'
  | 'seedance20-prompt-enhancer'
  | 'mv-music-master'
  | 'audio'
  | 'llm'
  | 'runninghub'
  | 'runninghub-wallet'
  | 'rh-config'
  | 'rh-tools'
  | 'rh-toolbox'
  | 'rh-toolbox-maker'
  | 'vibex'
  | 'fal-toolbox'
  | 'fal-toolbox-maker'
  | 'model-3d-preview'
  | 'model-3d'
  | 'grok-image-tools'
  | 'face-expression-3d'
  | 'previs-studio'
  | 'model-3d-upload'
  | 'grok-oauth-agent'
  | 'codex-cli-agent'
  | 'codex-image-conjure'
  | 'artist-style-master'
  | 'anime-tag-master'
  | 'comfyui-store'
  | 'comfyui-app-maker'
  // Special (5)
  | 'multi-angle-3d'
  | 'panorama-720'
  | 'penguin-portrait'
  | 'portrait-metadata'
  | 'storyboard-grid'
  // Utility (9)
  | 'drawing-board'
  | 'browser'
  | 'image-compare'
  | 'frame-extractor'
  | 'frame-pair'
  | 'loop'
  | 'random-route'
  | 'subflow'
  | 'pick-from-set'
  | 'text-split'
  | 'resize'
  | 'combine'
  | 'remove-bg'
  | 'upscale'
  | 'grid-crop'
  | 'grid-editor'
  // Auxiliary (5)
  | 'edit'
  | 'idea'
  | 'bp'
  | 'relay'
  | 'remove-ai-watermark'
  | 'video-output'
  // Toolbox (6)
  | 'cinematic'
  | 'video-motion'
  | 'multi-angle-visual'
  | 'portrait-master'
  | 'pose-master'
  | 'aggregate-parser'
  | 'batch-processor'
  | 'batch-tagger'
  | 'topaz-image-upscale'
  | 'topaz-video-upscale'
  // 3D (1)
  | 'panorama-3d'
  // Input/Output 素材 (2) - 上传素材(图像/视频/音频三合一) + 输出素材(文本/图像/视频/音频预览)
  | 'upload'
  | 'material-set'
  | 'generation-target'
  | 'volcengine-assets'
  | 'feishu-bitable-input'
  | 'feishu-bitable-output'
  | 'output';

// 节点分类
export type NodeCategory =
  | 'core'
  | 'rh'
  | 'fal'
  | 'grok'
  | 'codex'
  | 'inspiration'
  | 'comfyui'
  | 'special'
  | 'utility'
  | 'auxiliary'
  | 'toolbox'
  | '3d'
  | 'input';

// 节点元数据(用于 Sidebar 展示)
export interface NodeMeta {
  type: NodeType;
  label: string;
  /** Stable display keys. Translated labels are never persisted in canvas data. */
  labelKey?: string;
  category: NodeCategory;
  description: string;
  descriptionKey?: string;
  icon: string; // lucide-react 图标名
  color: string; // tailwind 色阶
  /**
   * 是否在 UI 入口暂时隐藏(Sidebar 节点列表 + 端口拖出候选选择器)。
   * 节点本身仍然在 NODE_REGISTRY 中注册到 nodeTypes,以保证已存在画布数据加载与渲染兼容,
   * 仅从用户主动添加入口中移除。设为 true 即等价于「暂时不展示」。
   */
  hidden?: boolean;
}

// 画布节点数据(xyflow Node.data)
export type AdvancedProviderProtocol =
  | 'openai-compatible'
  | 'modelscope'
  | 'volcengine'
  | 'agnes'
  | 'comfyui'
  | 'jimeng-cli';

export interface AdvancedProviderConfig {
  id: string;
  label: string;
  protocol: AdvancedProviderProtocol;
  baseUrl?: string;
  enabled?: boolean;
  allowRemote?: boolean;
  apiKey?: string;
  hasApiKey?: boolean;
  imageModels?: string[];
  videoModels?: string[];
  chatModels?: string[];
  defaults?: Record<string, any>;
  modelscopeConfig?: {
    defaultsVersion?: number;
    loras?: Array<{
      id: string;
      name?: string;
      targetModel: string;
      strength?: number;
      enabled?: boolean;
      note?: string;
    }>;
  };
  volcengineConfig?: {
    project?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    hasAccessKeyId?: boolean;
    hasSecretAccessKey?: boolean;
  };
  comfyuiConfig?: {
    instances?: string[];
    workflows?: Array<{
      id: string;
      name: string;
      workflowJson?: Record<string, any>;
      fields?: Array<{ nodeId: string; fieldName: string; source?: string; value?: any; options?: Array<string | number> }>;
      excludeRules?: string[];
      outputNodeIds?: string[];
    }>;
  };
  jimengConfig?: {
    executablePath?: string;
    useWsl?: boolean;
    wslDistro?: string;
    pollSeconds?: number;
  };
}

export interface AdvancedProviderSummary {
  enabledCount: number;
  configuredKeyCount: number;
  comfyuiConfigured: boolean;
  jimengConfigured: boolean;
}

export type CloudUploadProvider =
  | 'tencent-cos'
  | 'aliyun-oss'
  | 'baidu-netdisk'
  | 'quark-netdisk';

export interface CloudUploadTargetConfig {
  id: string;
  provider: CloudUploadProvider;
  label: string;
  enabled?: boolean;
  isDefault?: boolean;
  prefix?: string;
  publicBaseUrl?: string;
  tencentCos?: {
    bucket?: string;
    region?: string;
    secretId?: string;
    secretKey?: string;
    hasSecretId?: boolean;
    hasSecretKey?: boolean;
  };
  aliyunOss?: {
    bucket?: string;
    endpoint?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    hasAccessKeyId?: boolean;
    hasAccessKeySecret?: boolean;
  };
  baiduNetdisk?: {
    webdavUrl?: string;
    username?: string;
    password?: string;
    folder?: string;
    hasPassword?: boolean;
  };
  quarkNetdisk?: {
    webdavUrl?: string;
    username?: string;
    password?: string;
    folder?: string;
    hasPassword?: boolean;
  };
}

export interface CloudUploadSummary {
  totalCount: number;
  enabledCount: number;
  configuredCount: number;
  supportedUploadCount: number;
  defaultTargetId?: string;
  defaultLabel?: string;
}

export type CanvasProviderSource = 'zhenzhen' | AdvancedProviderProtocol;

export interface CanvasNodeData {
  label?: string;
  prompt?: string;
  imageUrl?: string;
  imageOnlyOutput?: boolean;
  reuseResult?: boolean;
  videoUrl?: string;
  audioUrl?: string;
  model?: string;
  providerSource?: CanvasProviderSource;
  providerId?: string;
  providerModel?: string;
  providerParams?: Record<string, any>;
  status?: 'idle' | 'generating' | 'success' | 'error';
  error?: string;
  // 通用扩展字段
  [key: string]: any;
}

// 画布列表项(后端返回)
export interface CanvasListItem {
  id: string;
  name: string;
  nodeCount: number;
  createdAt: number;
  updatedAt: number;
  revision?: number;
}

export type CreativeDeskFrameId =
  | 'none'
  | 'poster-card'
  | 'glass-card'
  | 'sticker'
  | 'polaroid'
  | 'comic-panel'
  | 'matte-gallery'
  | 'torn-paper'
  | 'kraft-tape'
  | 'washi-corners'
  | 'scrapbook-tabs'
  | 'linen-mat'
  | 'walnut-frame'
  | 'brass-gallery'
  | 'silver-bevel'
  | 'black-archive'
  | 'neon-tube'
  | 'holographic'
  | 'film-strip'
  | 'slide-mount'
  | 'contact-sheet'
  | 'blueprint'
  | 'manga-speed'
  | 'ink-brush'
  | 'dotted-stitch'
  | 'sewing-thread'
  | 'lace-paper'
  | 'ticket-stub'
  | 'stamp-postage'
  | 'label-maker'
  | 'memo-pin'
  | 'cork-board'
  | 'magnetic-board'
  | 'acrylic-block'
  | 'frosted-panel'
  | 'shadow-float'
  | 'soft-vignette'
  | 'double-line'
  | 'triple-rule'
  | 'corner-brackets'
  | 'ruler-grid'
  | 'studio-slate'
  | 'photo-booth'
  | 'album-sleeve'
  | 'arcade-marquee'
  | 'safety-stripe'
  | 'cosmic-rim'
  | 'aurora-glow'
  | 'sakura-washi'
  | 'ocean-glass'
  | 'sunset-ticket';

export type CreativeDeskFrameColorId =
  | 'cream'
  | 'white'
  | 'black'
  | 'rose'
  | 'amber'
  | 'mint'
  | 'cyan'
  | 'violet';

export interface CreativeDeskItem {
  id: string;
  kind: 'image';
  url: string;
  title?: string;
  resourceId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  opacity: number;
  frameId: CreativeDeskFrameId | string;
  frameColorId?: CreativeDeskFrameColorId | string;
  zIndex: number;
  locked?: boolean;
  visible?: boolean;
  createdAt: number;
}

export interface CreativeDeskState {
  version: 1;
  coordinateMode?: 'viewport' | 'flow';
  defaultOpacity?: number;
  items: CreativeDeskItem[];
}

export type FarmSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type FarmWeather = 'sunny' | 'cloudy' | 'rainy' | 'festival';

export type FarmTool =
  | 'select'
  | 'hoe'
  | 'seed'
  | 'water'
  | 'harvest'
  | 'shovel'
  | 'build'
  | 'decor'
  | 'move'
  | 'delete';

export type FarmCropId = 'turnip' | 'potato' | 'tomato' | 'sunflower';
export type FarmAnimalKind = 'chicken' | 'cow' | 'sheep';
export type FarmAnimalProductId = 'egg' | 'milk' | 'wool';
export type FarmAnimalMood = 'happy' | 'calm' | 'hungry';
export type FarmNpcVisitorId = 'mira' | 'taro' | 'lina';
export type FarmNpcRequestKind = 'crop' | 'animal-product';
export type FarmRareEventId = 'giant-turnip' | 'rainbow-sunflower' | 'meteor-seed';

export type FarmCropStage =
  | 'seed'
  | 'sprout'
  | 'growing'
  | 'flowering'
  | 'mature'
  | 'withered';

export interface FarmCropState {
  cropId: FarmCropId;
  plantedDay: number;
  daysGrown: number;
  wateredToday: boolean;
  dryDays: number;
  stage: FarmCropStage;
  quality?: 'normal' | 'silver' | 'gold' | 'rainbow';
}

export type FarmObjectKind = 'plot' | 'building' | 'decor' | 'path' | 'obstacle';
export type FarmDecorObjectType = 'sign' | 'banner' | 'poster-wall' | 'tile';

export interface FarmSelectedResourceDecor {
  resourceId: string;
  skinId: string;
  objectType: FarmDecorObjectType;
}

export interface FarmCanvasObject {
  id: string;
  kind: FarmObjectKind;
  x: number;
  y: number;
  widthCells: number;
  heightCells: number;
  rotation?: 0 | 90 | 180 | 270;
  crop?: FarmCropState;
  buildingId?: string;
  decorId?: string;
  resourceId?: string;
  skinId?: string;
  objectType?: FarmDecorObjectType;
  createdDay: number;
}

export interface FarmAnimalState {
  id: string;
  kind: FarmAnimalKind;
  name: string;
  mood: FarmAnimalMood;
  placedDay: number;
  lastProducedDay?: number;
  productCount: number;
}

export interface FarmCanvasResources {
  gold: number;
  wood: number;
  stone: number;
  water: number;
  experience: number;
  seeds: Partial<Record<FarmCropId, number>>;
}

export interface FarmCanvasInventory {
  crops: Partial<Record<FarmCropId, number>>;
  animalProducts: Partial<Record<FarmAnimalProductId, number>>;
  decorIds: string[];
}

export interface FarmOrderRequirement {
  kind: 'crop';
  cropId: FarmCropId;
  amount: number;
}

export interface FarmOrderReward {
  gold?: number;
  wood?: number;
  stone?: number;
  experience?: number;
  seeds?: Partial<Record<FarmCropId, number>>;
  decorIds?: string[];
}

export interface FarmOrder {
  id: string;
  title: string;
  requirements: FarmOrderRequirement[];
  rewards: FarmOrderReward;
  completed?: boolean;
}

export type FarmFestivalTaskKind = 'complete-orders';

export interface FarmFestivalTask {
  id: string;
  festivalId: string;
  title: string;
  description: string;
  kind: FarmFestivalTaskKind;
  target: number;
  progress: number;
  rewards: FarmOrderReward;
  completed?: boolean;
  completedDay?: number;
}

export interface FarmNpcVisitState {
  id: string;
  visitorId: FarmNpcVisitorId;
  visitorName: string;
  day: number;
  title: string;
  message: string;
  requestKind: FarmNpcRequestKind;
  cropId?: FarmCropId;
  animalProductId?: FarmAnimalProductId;
  amount: number;
  rewards: FarmOrderReward;
  completed?: boolean;
  completedDay?: number;
}

export interface FarmRareEventState {
  id: string;
  eventId: FarmRareEventId;
  title: string;
  message: string;
  day: number;
  cropId?: FarmCropId;
  rewards: FarmOrderReward;
}

export type FarmEventKind =
  | 'plot_tilled'
  | 'crop_planted'
  | 'crop_watered'
  | 'crop_harvested'
  | 'order_completed'
  | 'npc_request_completed'
  | 'rare_event'
  | 'building_placed'
  | 'decor_placed'
  | 'day_advanced'
  | 'tool_feedback';

export interface FarmEventLogItem {
  id: string;
  kind: FarmEventKind;
  day: number;
  message: string;
  amount?: number;
  cropId?: FarmCropId;
  objectKind?: FarmObjectKind;
  orderId?: string;
  npcVisitId?: string;
  rareEventId?: string;
  createdAt: number;
}

export interface FarmDailySummary {
  id: string;
  fromDay: number;
  toDay: number;
  weather: FarmWeather;
  festivalId?: string;
  message: string;
  harvestedCrops: number;
  ordersCompleted: number;
  goldEarned: number;
  rainWateredCrops: number;
  festivalBonusGold: number;
  animalProductsProduced: number;
  animalProductSummary?: string;
  npcVisitsCompleted: number;
  rareEventsFound: number;
  rareEventSummary?: string;
  readyOrders: number;
  readyNpcVisits: number;
  dailyWaterCapacity: number;
  scarecrowProtectedCrops: number;
  wateredCrops: number;
  dryCrops: number;
  witheredCrops: number;
  newMatureCrops: number;
  matureCrops: number;
  nextMatureCrops: number;
  highlights: string[];
  createdAt: number;
}

export interface FarmCanvasStats {
  plotsTilled: number;
  cropsPlanted: number;
  cropsWatered: number;
  cropsHarvested: number;
  ordersCompleted: number;
  npcVisitsCompleted: number;
  rareEventsFound: number;
  objectsPlaced: number;
  buildingsPlaced: number;
  decorPlaced: number;
  daysAdvanced: number;
}

export type FarmLongTermGoalId =
  | 'starter-route'
  | 'crop-catalog'
  | 'farmstead-buildings'
  | 'orders-10'
  | 'decor-30'
  | 'days-7';

export interface FarmLongTermGoal {
  id: FarmLongTermGoalId;
  title: string;
  hint: string;
  current: number;
  target: number;
  unit: string;
  percent: number;
  done: boolean;
}

export interface FarmCanvasState {
  version: 1;
  coordinateMode: 'flow';
  gridSize: number;
  day: number;
  season: FarmSeason;
  weather: FarmWeather;
  festivalId?: string;
  resources: FarmCanvasResources;
  inventory: FarmCanvasInventory;
  objects: FarmCanvasObject[];
  animals: FarmAnimalState[];
  orders: FarmOrder[];
  festivalTasks: FarmFestivalTask[];
  npcVisits: FarmNpcVisitState[];
  rareEvents: FarmRareEventState[];
  eventLog: FarmEventLogItem[];
  lastDailySummary?: FarmDailySummary;
  discoveredCropIds: FarmCropId[];
  unlockedDecorIds: string[];
  stats: FarmCanvasStats;
  selectedTool?: FarmTool;
  selectedBuildingId?: string;
  selectedDecorId?: string;
  selectedResourceDecor?: FarmSelectedResourceDecor;
  selectedObjectId?: string;
}

// 画布完整数据
export interface CanvasData {
  schema?: 't8-canvas-document';
  schemaVersion?: 2;
  projectId?: string;
  canvasId?: string;
  entityUid?: string;
  revision?: number;
  viewportRevision?: number;
  updatedAt?: number;
  nodes: any[];
  edges: any[];
  viewport: { x: number; y: number; zoom: number };
  subflowInstances?: Array<Record<string, unknown>>;
  tombstones?: {
    nodes: Record<string, object>;
    edges: Record<string, object>;
  };
  nextNodeSerialId?: number;
  creativeDesk?: CreativeDeskState;
  farmCanvas?: FarmCanvasState;
}

// API Key 设置(对应后端 settings)
export interface ApiSettings {
  // 主 API Key
  zhenzhenApiKey: string;
  zhenzhenBaseUrl: string; // 锁定 https://ai.t8star.org
  zhenzhenSd2ApiKey: string;
  zhenzhenSd2BaseUrl: string; // 历史字段名；锁定贞贞平价 AI 小屋 https://api.seedance.nz
  rhApiKey: string;
  rhBaseUrl: string; // https://www.runninghub.cn
  rhIntlApiKey: string;
  rhIntlBaseUrl: string; // https://www.runninghub.ai
  llmApiKey: string;
  llmBaseUrl: string; // 锁定 https://ai.t8star.org
  // 分类 API Key（留空时 fallback 到 zhenzhenApiKey）
  gptImageApiKey?: string;
  nanoBananaApiKey?: string;
  mjApiKey?: string;
  veoApiKey?: string;
  soraApiKey?: string;
  grokApiKey?: string;
  seedanceApiKey?: string;
  sunoApiKey?: string;
  // v1.2.10.2: 全局生成素材自动保存到本地的路径(可用户自定义)
  fileSavePath?: string;
  // v1.3.1: 画布自动保存导出路径(实际写入 <path>/T8-penguin-canvas/canvases)
  canvasAutoSavePath?: string;
  // v1.3.4: 资源库路径(资源文件 + resource_library.json 元数据)
  resourceLibraryPath?: string;
  // v1.3.6: 自定义主题模板路径(主题 JSON 文件)
  themeTemplatePath?: string;
  // 本地 Eagle API 地址(默认 http://127.0.0.1:41595)
  eagleApiBase?: string;
  advancedProviders?: AdvancedProviderConfig[];
  advancedProviderSummary?: AdvancedProviderSummary;
  cloudUploadTargets?: CloudUploadTargetConfig[];
  cloudUploadSummary?: CloudUploadSummary;
  taskCompletionSound?: {
    mode?: 'default' | 'custom';
    name?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    updatedAt?: number;
    url?: string;
  };
  preferences?: {
    theme?: 'dark' | 'light';
    /** Interface locale only. It must never change prompt/content language. */
    uiLocale?: 'zh-CN' | 'en-US';
    language?: string;
  };
}
