import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Settings, Sun, Wifi, WifiOff, Sparkles, Cloud, ExternalLink, Copy, Check, Gift, Heart, Youtube, PlayCircle, Bell, Wand2, Globe, MessageCircle, CalendarDays, Rocket, Library, Palette, Skull, Sailboat, BookOpen, Shield, Crown, PanelLeftClose, PanelLeftOpen, Puzzle, KeyRound } from 'lucide-react';
import { useThemeStore } from './stores/theme';
import { seedDragonBallRadarForShenronTest, useDragonBallRadarStore } from './stores/dragonBallRadar';
import { seedSaintSeiyaGoldClothsForHadesTest, useSaintSeiyaSanctuaryStore } from './stores/saintSeiyaSanctuary';
import { trackAchievementEvent } from './stores/achievements';
import { useApiKeysStore } from './stores/apiKeys';
import { useShortcutStore } from './stores/shortcuts';
import { useUiLocaleStore } from './stores/locale';
import { stopCanvasCatalogRecoveryPolling, useCanvasStore } from './stores/canvas';
import Sidebar from './components/Sidebar';
import type { AddNodeFn, InsertWorkflowFn } from './components/Canvas';
import AppUpdaterButton from './components/AppUpdaterButton';
import AgentControlPairingModal from './components/AgentControlPairingModal';
import AgentControlApprovalModal from './components/AgentControlApprovalModal';
import MaterialContextMenu from './components/MaterialContextMenu';
import ErrorBoundary from './components/ErrorBoundary';
import AchievementButton from './components/AchievementButton';
import AchievementCeremonyLayer from './components/AchievementCeremonyLayer';
import AchievementDrawer from './components/AchievementDrawer';
import AchievementToast from './components/AchievementToast';
import AchievementTracker from './components/AchievementTracker';
import { RHToolsProvider } from './providers/RHToolsProvider';
import * as api from './services/api';
import type { NodeType } from './types/canvas';
import type { ResourceItem } from './services/api';
import { applyThemeTemplate } from './theme/applyTheme';
import { BUILT_IN_THEME_TEMPLATES, TECH_TEMPLATE_ID, resolveThemeTemplate } from './theme/defaultTemplates';
import type { ThemeTemplate } from './theme/types';
import { createThemeCssApplyCoordinator } from './theme/themeCssLoader';
import { materialSetItemsToData, type MaterialSetKind, type MaterialSetItem } from './utils/materialSet';
import { workflowManifestToFragment } from './utils/workflowResource';
import { matchesAnyShortcut } from './utils/keyboardShortcuts';
import { portraitResourceToNodeData } from './utils/portraitResource';
import { createUploadDataFromItems, type MediaKind } from './utils/mediaCollection';
import { applyUiFontPreference } from './utils/uiFont';
import { markCanvasPerformance } from './utils/canvasPerformanceProbe';
import { localizeThemeName } from './i18n/themeCatalog';
import { LocalModalSlot, LocalTopbarSlot } from 'virtual:t8-local-extensions';

const Canvas = lazy(() => import('./components/Canvas'));
const ApiSettingsModal = lazy(() => import('./components/ApiSettings'));
const ResourceLibraryDrawer = lazy(() => import('./components/ResourceLibraryDrawer'));
const ThemeTemplateManager = lazy(() => import('./components/ThemeTemplateManager'));

// vite.config 注入的编译期常量（与 package.json 同步），勿硬编码 v1.x.x
declare const __APP_VERSION__: string;

function isShortcutTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = 't8-sidebar-collapsed';
const CUSTOM_THEME_TEMPLATE_CACHE_KEY = 't8-custom-theme-templates-cache-v1';
const CUSTOM_THEME_TEMPLATE_CACHE_MAX_BYTES = 128 * 1024;
const CUSTOM_THEME_TEMPLATE_CACHE_URL_MAX_CHARS = 2_048;

function cachedThemeStringByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function sanitizeCachedThemeTemplate(template: ThemeTemplate): ThemeTemplate {
  if (!template.music) return { ...template, builtIn: false };
  const cacheableUrl = (value?: string) => (
    typeof value === 'string'
    && value.length <= CUSTOM_THEME_TEMPLATE_CACHE_URL_MAX_CHARS
    && !value.trimStart().toLowerCase().startsWith('data:')
      ? value
      : undefined
  );
  const url = cacheableUrl(template.music.url);
  const hiddenUrl = cacheableUrl(template.music.hiddenUrl);
  const source = !url && (template.music.source === 'upload' || template.music.source === 'url')
    ? 'synth'
    : template.music.source;
  return {
    ...template,
    builtIn: false,
    music: { ...template.music, source, url, hiddenUrl },
  };
}

const ZHAOTUTU_TAGGER_TRAINER_URL = 'https://zhaotutu.xyz';
const ZHAOTUTU_TAGGER_TRAINER_LABEL = '最好的打标和模型训练工具-图图打标及训练器：点击获取';
const API_ACQUISITION_LINKS = [
  {
    id: 'zhenzhen-cn',
    title: '贞贞的平价AI小屋（国内版）',
    titleEn: 'Zhenzhen Affordable AI Hub (China)',
    description: '主要调用国内模型，非盈利运营，仅保留 5%-10% 网站维护费用；国内模型价格约为海外版的 7.5-8 折（新网站）。',
    descriptionEn: 'Focused on China-region models. Non-profit operation with only a 5%–10% maintenance margin; China-region models are typically priced below the global site.',
    action: '获取国内版 API Key',
    actionEn: 'Get China API Key',
    url: 'https://api.seedance.nz/sign-up?aff=5f4w',
  },
  {
    id: 'zhenzhen-intl',
    title: '贞贞的AI工坊（海外版）',
    titleEn: 'Zhenzhen AI Workshop (Global)',
    description: '主要调用海外模型并服务海外用户，也包含国内模型；由于整体成本较高，国内模型价格不具优势。',
    descriptionEn: 'Focused on global models and users, while also carrying some China-region models; China-region pricing may be less competitive here.',
    action: '获取海外版 API Key',
    actionEn: 'Get global API Key',
    url: 'https://ai.t8star.org/register?aff=dP7j',
  },
  {
    id: 'runninghub-cn',
    title: 'RunningHub APIKEY 国内版',
    titleEn: 'RunningHub API Key (China)',
    description: '适配更多 AI 应用，并提供最新模型体验。',
    descriptionEn: 'Supports more AI apps and access to recent models.',
    action: '获取国内版 RH API Key',
    actionEn: 'Get China RH API Key',
    url: 'https://www.runninghub.cn/user-center/1819214514410942465/webapp?inviteCode=rh-v1121',
  },
  {
    id: 'runninghub-intl',
    title: 'RunningHub APIKEY 海外版',
    titleEn: 'RunningHub API Key (Global)',
    description: '审核规则更宽松，支持更多海外模型。',
    descriptionEn: 'Offers broader moderation rules and more global models.',
    action: '获取海外版 RH API Key',
    actionEn: 'Get global RH API Key',
    url: 'https://www.runninghub.ai/user-center/1907375370302308353/webapp?inviteCode=rh-v1121',
  },
] as const;

function readSidebarCollapsedPreference(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
}

function poseBackupToNodeData(value: unknown): Record<string, any> | null {
  const raw = value && typeof value === 'object' ? (value as Record<string, any>) : null;
  const backup = raw?.schema === 't8-pose-master-resource' ? raw.poseBackup : raw;
  if (!backup || typeof backup !== 'object' || (backup as any).schema !== 't8-pose-master') return null;
  const pose = backup as Record<string, any>;
  const people = Array.isArray(pose.people)
    ? pose.people
    : pose.hasPeople === false
      ? []
      : pose.points
        ? [pose.points]
        : [];
  const prompt = typeof pose.prompt === 'string' ? pose.prompt : '';
  return {
    kind: 'pose-master',
    posePoints: pose.points,
    posePointVersion: Number(pose.pointVersion) || 4,
    poseHasPeople: pose.hasPeople !== false,
    posePeople: people,
    poseActivePersonIndex: 0,
    poseHandControls: pose.handControls,
    posePresetId: typeof pose.presetId === 'string' ? pose.presetId : 'standing',
    poseViewId: typeof pose.viewId === 'string' ? pose.viewId : 'front',
    poseShotId: typeof pose.shotId === 'string' ? pose.shotId : 'full-body',
    poseIntensityId: typeof pose.intensityId === 'string' ? pose.intensityId : 'natural',
    poseLanguage: pose.language === 'zh' ? 'zh' : 'en',
    poseCustomText: typeof pose.custom === 'string' ? pose.custom : '',
    poseCanvasRatioId: typeof pose.canvasRatioId === 'string' ? pose.canvasRatioId : 'default',
    poseCanvasCustomWidth: Number(pose.canvasCustomWidth) || 620,
    poseCanvasCustomHeight: Number(pose.canvasCustomHeight) || 520,
    prompt,
    text: prompt,
    outputText: prompt,
    posePrompt: prompt,
    metadata: {
      schema: 't8-pose-master',
      resourceRestoredAt: Date.now(),
      sourceName: typeof pose.name === 'string' ? pose.name : '',
    },
  };
}

async function poseResourceToNodeData(item: ResourceItem): Promise<Record<string, any> | null> {
  if (item.kind !== 'pose' || !item.fileUrl) return null;
  const res = await fetch(item.fileUrl);
  if (!res.ok) throw new Error(`读取姿势资源失败: HTTP ${res.status}`);
  return poseBackupToNodeData(await res.json());
}

async function workflowResourceToFragment(item: ResourceItem) {
  if (item.kind !== 'workflow' || !item.fileUrl) return null;
  const res = await fetch(item.fileUrl);
  if (!res.ok) throw new Error(`读取工作流资源失败: HTTP ${res.status}`);
  return workflowManifestToFragment(await res.json());
}

const CANVAS_TUTORIALS = [
  {
    title: '基础功能教程第一弹1.2.3版',
    bilibili: 'https://www.bilibili.com/video/BV18sG76AE9Y/',
    youtube: 'https://www.youtube.com/watch?v=V8oCBhemmCQ',
  },
  {
    title: '教程第二弹（循环系统，RH超市等）',
    bilibili: 'https://www.bilibili.com/video/BV1CVGx6kEMV/',
    youtube: 'https://www.youtube.com/watch?v=hSpoXclezqw',
  },
  {
    title: '教程第三弹（节点回避算法，资产库，自定义主题等）',
    bilibili: 'https://www.bilibili.com/video/BV1qeVP6kEZi/',
    youtube: 'https://www.youtube.com/watch?v=oJUbD88kvnk',
  },
  {
    title: '教程第四弹（RH主题隐藏模式Red,素材集节点，导演节点三件套，多角度可视化，图像对比，高级版多宫格剪裁）',
    bilibili: 'https://www.bilibili.com/video/BV1gfGm6HERH/',
    youtube: 'https://www.youtube.com/watch?v=9Bn0BjsfwlE',
  },
  {
    title: '教程第五弹（人造人系统，灵魂画手控制系统，贞贞无限画布！火影忍者，EVA，幽游白书主题，设计师专属优化多画布及Eagle发送）',
    bilibili: 'https://www.bilibili.com/video/BV1KhVY6MEFP/',
    youtube: 'https://www.youtube.com/watch?v=_lmRmlPZ2y0',
  },
  {
    title: '教程第六弹（灌篮高手主题上线！新Red隐藏模式，姿势大师节点，全新交互及连线方式）',
    bilibili: 'https://www.bilibili.com/video/BV1RjVZ69En1/',
    youtube: 'https://www.youtube.com/watch?v=pSLqhcpmpn8',
  },
  {
    title: '教程第七弹（即梦CLI调用，Seedance2.0不卡人脸！支持modelscope免费版生成，OpenAI兼容调用，RH超市，画板功能再升级！宫格编辑！新增AI检测消除功能）',
    bilibili: 'https://www.bilibili.com/video/BV18eVz68ENs/',
    youtube: 'https://www.youtube.com/watch?v=PQ5rKtOZ-tM',
  },
  {
    title: '教程第八弹（本地Comfyui植入贞贞的无限画布！超简单超好用！新增足球小将主题，视频解析功能，节点对齐，即梦CLI修复多参，免费版魔搭API Lora支持，素材黏贴新模式，APIKEY导入导出功能）',
    bilibili: 'https://www.bilibili.com/video/BV1ha7R6DES5/',
    youtube: 'https://www.youtube.com/watch?v=LViGXsMTFhs',
  },
  {
    title: '教程第九弹（新增3D全景功能及资产库，一键自动更新功能，输入框放大按钮，修复即梦CLI的多参问题，AI去水印节点功能升级，新增聚合解析功能，可获取17个平台无水印视频，优化启动速度，优化画布加载如慢加载，支持自定义快捷键设置）',
    bilibili: 'https://www.bilibili.com/video/BV1gSEA6GEDQ/',
    youtube: 'https://www.youtube.com/watch?v=-nmX9oB-MX',
  },
  {
    title: '教程第十弹（3D全景功能增强，Figma联动，支持阿里云Oss及腾讯云Cos，新增放置栏，修正新香蕉的模型映射，上传素材的上限从10M到20M，新增veo-omni模型，新增提示词模板系统及增强功能，comfyui支持remote模式，新增newapi分组令牌高级模式，LLM/VISIOIN节点支持流式删除，分类独立APIKEY支持删除功能，新增画布教程模块，支持上游文本联动生成节点@模式，即梦CLI模型补全，素材支持直接拖到浏览器外文件夹）',
    bilibili: 'https://www.bilibili.com/video/BV1N9Eg6QEHs/',
    youtube: 'https://www.youtube.com/watch?v=zIW7PbEWQAs',
  },
  {
    title: '教程第十一弹（新增圣斗士星矢双主题，加强本地comfyui节点和参数解析，修复不支持LIST的问题，新增画布内图片素材按鼠标左右键拖动到文件夹，新增Fal超市功能，新增grok agent节点，含创作台和简易版，新增3D素材上传和预览功能）',
    bilibili: 'https://www.bilibili.com/video/BV1gGEz6VEDA/',
    youtube: 'https://www.youtube.com/watch?v=oRT59Qf65KY',
  },
  {
    title: '教程第十二弹（grok agent的节点修复图生视频功能，新增视频延展及视频编辑功能，新增codex cli agent节点，简约模式和创作台模式，新增Codex生图工作台节点，新增自定义快捷圆盘，FAL超市新增10多个新模型，视频节点新增3个grok video 1.5模型，解锁成就系统所有隐藏模式的奖励影片，新增俄罗斯方块主题及小游戏）',
    bilibili: 'https://www.bilibili.com/video/BV1phJs6oE2g/',
    youtube: 'https://www.youtube.com/watch?v=BKV8YA-kKK4',
  },
  {
    title: '教程第十三弹（新增牧场物语主题及养成游戏，放置栏可收缩，修复侧边栏按钮常驻BUG，3D全景节点新增2:1尺寸，修复部分用户无法新增资源库分类，新增画板及图像编辑功能shift正圆，正方形及实心素材，抠图功能等，新增chrome插件支持任意网络图像反推生成并发送画布，新增跨画布完成通知，优化comfyui节点，新增自定义系统字体，支持agens apikey多模态模型免费使用，新增历史记录）',
    bilibili: 'https://www.bilibili.com/video/BV1tYjy6jEuG/',
    youtube: 'https://www.youtube.com/watch?v=AH24lGHA9E0',
  },
  {
    title: '教程第十四弹（新增VibeX联动发送功能及节点，增强chrome反推插件（需更新安装，支持vibex以及修复反推发送问题），修复ID连线方式，新增区域连线方式，新增目标框节点，重写画布底层大幅度优化节点太多卡顿问题，图像编辑模式画板新增标签改图功能，全局去掉字体模糊效果，批量素材节点完善扩图，高清放大，抠图等功能（需填写RH APIKEY））',
    bilibili: 'https://www.bilibili.com/video/BV1mj7h6CEYx/',
    youtube: 'https://www.youtube.com/watch?v=wCOoTtuxQPM',
  },
  {
    title: '教程第十五弹（新增植物大战僵尸主题，新增PS插件支持Photoshop和画布发送及生成，图像节点新增seedream模块，修复agnes图像编辑报错，新增即梦cli，导演台，SD2.0节点的sd2.0mini和原生4K，新增随机路由节点，新增批量打标节点，新增视频剪辑节点，优化提示库模板功能，视频类素材左侧新增首尾帧，极速放大及质量放大功能）',
    bilibili: 'https://www.bilibili.com/video/BV1RoN76RE9m/',
    youtube: 'https://www.youtube.com/watch?v=K65BqvSTfh4',
  },
  {
    title: '教程第十六弹（支持贞贞的平价AI小屋，全国内站模型比海外站便宜5-7.5折，支持宽审核，每日更新模型，RH API分离设置）',
    bilibili: 'https://www.bilibili.com/video/BV11zNM6jEQR/',
    youtube: 'https://www.youtube.com/watch?v=_G9xLFd0DN0',
  },
  {
    title: '教程第十七弹（支持贞贞的平价AI小屋的全套LLM模型，图像模型(gpt-image-2低价版,grok image,midjourney 8.2)，视频模型(veo-omni(支持视频编辑),grok-video 1.5)，音频转译whisper-1,音乐模型suno5.5等，新增工作流医生，新增生成节点复用开关，图像节点新增提示词不输出模式，新增story全自动制片，新增3D表情节点，循环器重新增自定义并发模式，RH工具箱新增视频抠像功能，视频节点新增抠像TAB，视频节点新增获取当前帧，新增海螺视频，vidu视频，happyhorse视频，Wan视频，可灵视频支持，修复已知Bug）',
    bilibili: 'https://www.bilibili.com/video/BV1ob3g6pESq/',
    youtube: 'https://www.youtube.com/watch?v=B-2ICzUtcNU',
  },
];

const CANVAS_PLUGIN_INSTALL_GUIDES = [
  {
    name: 'T8 Photoshop Link',
    nameEn: 'T8 Photoshop Link',
    target: 'Photoshop UXP 面板',
    targetEn: 'Photoshop UXP panel',
    devPath: 'tools\\photoshop-bridge\\plugin\\manifest.json',
    packagedPath: 'resources\\tools\\photoshop-bridge\\plugin\\manifest.json',
    install: 'Adobe UXP Developer Tool -> Add Plugin 选择 manifest.json，然后 Load / Load & Watch；升级 manifest 时先 Unload，若仍指向旧目录则 Remove 后从当前目录重新 Add。',
    installEn: 'In Adobe UXP Developer Tool, choose Add Plugin and select manifest.json, then use Load or Load & Watch. Unload before upgrades; remove and add the current folder again if the old path remains.',
    use: '画布图片可发送到 PS，PS 当前画面可上传回 T8，插件内可浏览资产并把生成结果置入当前文档。',
    useEn: 'Send canvas images to Photoshop, upload the current Photoshop view back to T8, browse assets, and place generated results into the current document.',
    safety: '只连接 localhost / 127.0.0.1 的本机端口，不保存 T8 平台 API Key。',
    safetyEn: 'Connects only to localhost / 127.0.0.1 and does not store T8 platform API keys.',
  },
  {
    name: 'T8 Penguin Canvas Bridge',
    nameEn: 'T8 Penguin Canvas Bridge',
    target: 'Figma 开发插件',
    targetEn: 'Figma development plugin',
    devPath: 'tools\\figma-bridge\\plugin\\manifest.json',
    packagedPath: 'resources\\tools\\figma-bridge\\plugin\\manifest.json',
    install: 'Figma Desktop -> Plugins -> Development -> Import plugin from manifest...，不要走 Widget 导入；必要时可运行 npm run figma:bridge。',
    installEn: 'In Figma Desktop, use Plugins → Development → Import plugin from manifest. Do not import it as a widget; run npm run figma:bridge if needed.',
    use: '把画布素材发送到本机 Figma Bridge 队列，保持 Figma 插件窗口打开后会自动导入当前文件。',
    useEn: 'Send canvas assets to the local Figma Bridge queue. Keep the Figma plugin open to import them into the current file.',
    safety: 'Bridge 走本机 localhost:3845 / 127.0.0.1，不把素材上传到远端中转服务。',
    safetyEn: 'The bridge uses localhost:3845 / 127.0.0.1 and does not upload assets to a remote relay.',
  },
  {
    name: '网页图片反推与素材采集 Chrome 扩展',
    nameEn: 'Web Image Reverse-Prompt and Asset Capture Extension',
    target: '浏览器扩展',
    targetEn: 'Browser extension',
    devPath: 'extension\\manifest.json',
    packagedPath: 'resources/extension/web-image-reverse/',
    install: 'Chrome 扩展程序打开开发者模式，选择“加载已解压的扩展程序”，开发版选 extension，打包版选 resources/extension/web-image-reverse/。',
    installEn: 'Enable Developer mode in Chrome Extensions and choose Load unpacked. Use extension in development or resources/extension/web-image-reverse/ in the packaged app.',
    use: '网页图片右键反推提示词、生成图片；点击扩展图标可在 Popup 或 Side Panel 扫描图片、背景图、srcset、canvas，筛选后批量导入为一个上传素材节点，也可截取当前视口。',
    useEn: 'Reverse-prompt or generate from web images, scan images/backgrounds/srcset/canvas in the popup or side panel, batch-import selected items into one upload node, or capture the current viewport.',
    safety: '扩展不内置用户密钥。批量素材先写入本机 T8 input，再通过带会话令牌的本机桥接发送；公网 URL 回退会拒绝内网地址并限制单图与批次大小。',
    safetyEn: 'The extension embeds no user keys. Batch assets first enter the local T8 input directory and use a session-token bridge; public-URL fallback blocks private addresses and limits item and batch size.',
  },
] as const;

function InfiniteCanvasBootLoading() {
  const { t } = useTranslation('shell');
  return (
    <div className="t8-boot-screen" role="status" aria-label={t('loading.canvas')}>
      <img className="t8-boot-art" src="/infinite-canvas-loading.png" alt="" aria-hidden="true" />
      <div className="t8-boot-progress-shell" aria-hidden="true">
        <span className="t8-boot-progress-label">{t('loading.starting')}</span>
        <div className="t8-boot-progress-track">
          <span className="t8-boot-progress-fill" />
          <span className="t8-boot-progress-spark" />
        </div>
        <span className="t8-boot-progress-percent">Loading</span>
      </div>
    </div>
  );
}

/**
 * T8-penguin-canvas 应用根组件 (Phase 1)
 * 布局: [侧边栏(画布管理 + 节点列表)] [画布主体] + 头部状态栏
 */
function App() {
  const { t } = useTranslation(['shell', 'common']);
  useEffect(() => markCanvasPerformance('app-shell-visible'), []);
  const uiLocale = useUiLocaleStore((state) => state.locale);
  const setUiLocale = useUiLocaleStore((state) => state.setLocale);
  const {
    theme,
    style,
    templateId,
    customTemplates,
    templatesLoaded,
    uiFontPreset,
    customUiFont,
    toggleTheme,
    loadCustomTemplates,
  } = useThemeStore();
  const { load: loadSettings, save: saveSettings, settings } = useApiKeysStore();
  const bootstrapCanvases = useCanvasStore((state) => state.bootstrapCanvases);
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const currentTemplate = useMemo(
    () => resolveThemeTemplate(templateId, customTemplates),
    [templateId, customTemplates],
  );
  const [appliedThemeStyle, setAppliedThemeStyle] = useState(() =>
    typeof document === 'undefined'
      ? 'tech'
      : document.documentElement.getAttribute('data-theme-visual') || 'tech',
  );
  const [themeCssFailure, setThemeCssFailure] = useState<{ style: string; message: string } | null>(null);
  const [themeCssLoadAttempt, setThemeCssLoadAttempt] = useState(0);
  const themeCssApplyCoordinatorRef = useRef<ReturnType<typeof createThemeCssApplyCoordinator> | null>(null);
  if (!themeCssApplyCoordinatorRef.current) {
    themeCssApplyCoordinatorRef.current = createThemeCssApplyCoordinator();
  }
  const themeCssApplyCoordinator = themeCssApplyCoordinatorRef.current;
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [themeManagerOpen, setThemeManagerOpen] = useState(false);
  // 「在线画布」推广浮层开关 + 容器 ref(用于点击外部关闭)
  const [cloudOpen, setCloudOpen] = useState(false);
  const [wxCopied, setWxCopied] = useState(false);
  const cloudWrapRef = useRef<HTMLDivElement>(null);
  // 「视频教程」推广浮层开关
  const [videoOpen, setVideoOpen] = useState(false);
  const videoWrapRef = useRef<HTMLDivElement>(null);
  // 「图图打标器」推广浮层开关
  const [zhaotutuOpen, setZhaotutuOpen] = useState(false);
  const zhaotutuWrapRef = useRef<HTMLDivElement>(null);
  // 「API获取」说明浮层开关
  const [apiAcquisitionOpen, setApiAcquisitionOpen] = useState(false);
  const apiAcquisitionWrapRef = useRef<HTMLDivElement>(null);
  // 「插件安装」说明浮层开关
  const [pluginInstallOpen, setPluginInstallOpen] = useState(false);
  const pluginInstallWrapRef = useRef<HTMLDivElement>(null);
  // 「画布教程」教程合集浮层开关
  const [canvasTutorialOpen, setCanvasTutorialOpen] = useState(false);
  const canvasTutorialWrapRef = useRef<HTMLDivElement>(null);
  // 「贞贞工坊」推广浮层开关
  const [zhenOpen, setZhenOpen] = useState(false);
  const zhenWrapRef = useRef<HTMLDivElement>(null);
  // 「最新应用」推广浮层开关
  const [appOpen, setAppOpen] = useState(false);
  const appWrapRef = useRef<HTMLDivElement>(null);
  // 「AIX产品」推广浮层开关
  const [aixOpen, setAixOpen] = useState(false);
  const aixWrapRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
  // 画布接收节点添加的 ref(从 Sidebar -> Canvas)
  const addNodeRef = useRef<AddNodeFn | null>(null);
  const insertWorkflowRef = useRef<InsertWorkflowFn | null>(null);

  const handleOpenZhaotutuTaggerTrainer = useCallback(async () => {
    setZhaotutuOpen(false);
    setPluginInstallOpen(false);
    setCanvasTutorialOpen(false);
    if (typeof window === 'undefined') return;
    if (typeof window.t8pc?.openExternal === 'function') {
      try {
        const result = await window.t8pc.openExternal(ZHAOTUTU_TAGGER_TRAINER_URL);
        if (result?.success === true) return;
      } catch {
        /* fallback to browser window below */
      }
    }
    window.open(ZHAOTUTU_TAGGER_TRAINER_URL, '_blank', 'noopener,noreferrer');
  }, []);

  const handleOpenApiAcquisition = useCallback(async (url: string) => {
    setApiAcquisitionOpen(false);
    if (typeof window === 'undefined') return;
    if (typeof window.t8pc?.openExternal === 'function') {
      try {
        const result = await window.t8pc.openExternal(url);
        if (result?.success === true) return;
      } catch {
        /* fallback to browser window below */
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  const changeUiLocale = useCallback((locale: 'zh-CN' | 'en-US') => {
    setUiLocale(locale);
    void saveSettings({
      preferences: {
        ...(settings.preferences || {}),
        uiLocale: locale,
      },
    });
  }, [saveSettings, setUiLocale, settings.preferences]);

  // 「在线画布」浮层: 点击容器外部 / 按 ESC 自动关闭
  useEffect(() => {
    if (!cloudOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!cloudWrapRef.current) return;
      if (!cloudWrapRef.current.contains(e.target as Node)) setCloudOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCloudOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [cloudOpen]);

  // 「视频教程」浮层: 点击容器外部 / 按 ESC 自动关闭
  useEffect(() => {
    if (!videoOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!videoWrapRef.current) return;
      if (!videoWrapRef.current.contains(e.target as Node)) setVideoOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVideoOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [videoOpen]);

  // 「图图打标器」浮层: 点击容器外部 / 按 ESC 自动关闭
  useEffect(() => {
    if (!zhaotutuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!zhaotutuWrapRef.current) return;
      if (!zhaotutuWrapRef.current.contains(e.target as Node)) setZhaotutuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZhaotutuOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [zhaotutuOpen]);

  // 「API获取」浮层: 点击容器外部 / 按 ESC 自动关闭
  useEffect(() => {
    if (!apiAcquisitionOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!apiAcquisitionWrapRef.current) return;
      if (!apiAcquisitionWrapRef.current.contains(e.target as Node)) setApiAcquisitionOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setApiAcquisitionOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [apiAcquisitionOpen]);

  // 「插件安装」浮层: 点击容器外部 / 按 ESC 自动关闭
  useEffect(() => {
    if (!pluginInstallOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!pluginInstallWrapRef.current) return;
      if (!pluginInstallWrapRef.current.contains(e.target as Node)) setPluginInstallOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPluginInstallOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pluginInstallOpen]);

  // 「画布教程」浮层: 点击容器外部 / 按 ESC 自动关闭
  useEffect(() => {
    if (!canvasTutorialOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!canvasTutorialWrapRef.current) return;
      if (!canvasTutorialWrapRef.current.contains(e.target as Node)) setCanvasTutorialOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCanvasTutorialOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [canvasTutorialOpen]);

  // 「贞贞工坊」浮层: 点击容器外部 / 按 ESC 自动关闭
  useEffect(() => {
    if (!zhenOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!zhenWrapRef.current) return;
      if (!zhenWrapRef.current.contains(e.target as Node)) setZhenOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZhenOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [zhenOpen]);

  // 「最新应用」浮层: 点击容器外部 / 按 ESC 自动关闭
  useEffect(() => {
    if (!appOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!appWrapRef.current) return;
      if (!appWrapRef.current.contains(e.target as Node)) setAppOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAppOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [appOpen]);

  // 「AIX产品」浮层: 点击容器外部 / 按 ESC 自动关闭
  useEffect(() => {
    if (!aixOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!aixWrapRef.current) return;
      if (!aixWrapRef.current.contains(e.target as Node)) setAixOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAixOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [aixOpen]);

  useEffect(() => {
    const hasOpenTopSurface =
      cloudOpen || videoOpen || zhaotutuOpen || apiAcquisitionOpen || pluginInstallOpen || canvasTutorialOpen || zhenOpen || appOpen || aixOpen || resourceOpen;
    if (!hasOpenTopSurface) return;

    const onDocPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target.closest('.t8-topbar') ||
        target.closest('.resource-library-drawer') ||
        target.closest('[data-canvas-floating-ui]') ||
        target.closest('.react-flow__node') ||
        target.closest('.react-flow__edge') ||
        target.closest('.react-flow__controls') ||
        target.closest('.react-flow__minimap') ||
        target.closest('.t8-control-rail')
      ) {
        return;
      }

      setCloudOpen(false);
      setVideoOpen(false);
      setZhaotutuOpen(false);
      setApiAcquisitionOpen(false);
      setPluginInstallOpen(false);
      setCanvasTutorialOpen(false);
      setZhenOpen(false);
      setAppOpen(false);
      setAixOpen(false);
      // 资源库是创作侧栏：点击画布后保持开启，便于连续插入和 Ctrl 拖拽素材。
    };

    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
    };
  }, [cloudOpen, videoOpen, zhaotutuOpen, apiAcquisitionOpen, pluginInstallOpen, canvasTutorialOpen, zhenOpen, appOpen, aixOpen, resourceOpen]);

  const handleCopyWx = async () => {
    try {
      await navigator.clipboard.writeText('Lovexy_0222');
      setWxCopied(true);
      window.setTimeout(() => setWxCopied(false), 1600);
    } catch {
      // 兼容: 不支持 clipboard API 时降级 prompt 让用户手动复制
      window.prompt(t('shell:promotionDetails.cloudCanvas.copyPrompt'), 'Lovexy_0222');
    }
  };

  // 将主题状态注入 <html> 供 CSS 选择器使用
  useEffect(() => {
    const root = document.documentElement;
    const requestedStyle = currentTemplate.visuals?.style || style;
    root.setAttribute('data-theme-css-state', 'loading');
    root.setAttribute('data-theme-css-requested', requestedStyle);
    applyUiFontPreference(root, uiFontPreset, customUiFont);
    // 全局禁用拼写检查(节点提示词为中文/@变量语法,不需红色波浪线干扰)
    // spellcheck 属性 HTML 标准上是可继承的 → 根上设一次,所有后代 textarea/input 都生效
    root.setAttribute('spellcheck', 'false');
    document.body.setAttribute('spellcheck', 'false');
    let disposed = false;
    void themeCssApplyCoordinator.apply(
      requestedStyle,
      () => {
        if (disposed) return;
        applyThemeTemplate(currentTemplate, theme);
        setAppliedThemeStyle(requestedStyle);
        setThemeCssFailure(null);
        root.setAttribute('data-theme-css-state', 'ready');
        root.removeAttribute('data-theme-css-fallback');
      },
      (error) => {
        if (disposed) return;
        const fallbackTemplate = resolveThemeTemplate(TECH_TEMPLATE_ID);
        applyThemeTemplate(fallbackTemplate, theme);
        setAppliedThemeStyle('tech');
        root.setAttribute('data-theme-css-state', 'error');
        root.setAttribute('data-theme-css-fallback', 'tech');
        setThemeCssFailure({
          style: requestedStyle,
          message: error instanceof Error ? error.message : '未知加载错误',
        });
      },
    );
    return () => {
      disposed = true;
    };
  }, [currentTemplate, customUiFont, style, theme, themeCssApplyCoordinator, themeCssLoadAttempt, uiFontPreset]);

  // 全局 MutationObserver: 为动态挂载的 textarea / input 自动设置 spellcheck=false
  // (Chromium 对 textarea 默认 spellcheck=true,不会从祖先继承 → 需逐个设置)
  //
  // 同时：全局为所有 textarea / input / select 添加 `nodrag` + `nowheel` className
  // — xyflow v12 识别 `nodrag` 后不触发节点拖动，避免「框选文字时整个节点跟着鼠标走」
  // — `nowheel` 让 textarea 内部可独立滚轮滚动，不被 xyflow 接管为画布缩放
  // — 不覆盖节点原有 className(classList.add 只追加)，零侵入
  useEffect(() => {
    const apply = (el: Element) => {
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') {
        if (tag !== 'SELECT') {
          el.setAttribute('spellcheck', 'false');
          el.setAttribute('autocorrect', 'off');
          el.setAttribute('autocapitalize', 'off');
        }
        // xyflow noDragClassName / noWheelClassName 默认 'nodrag' / 'nowheel'
        // 加上后该元素上的 pointerdown 不会被 xyflow 当作节点拖拽启动
        el.classList.add('nodrag', 'nowheel');
      }
    };
    // 初始扫描
    document.querySelectorAll('textarea, input, select').forEach(apply);
    // 增量监听
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const el = n as Element;
          apply(el);
          el.querySelectorAll?.('textarea, input, select').forEach(apply);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // 启动探测后端
  useEffect(() => {
    const check = async () => {
      const ok = await api.checkBackendStatus();
      setBackendStatus(ok ? 'ok' : 'error');
    };
    check();
    const t = window.setInterval(check, 15_000);
    return () => window.clearInterval(t);
  }, []);

  // 目录启动不依赖 Sidebar 是否挂载：即使侧栏被持久化为收起状态，也能恢复最后画布。
  useEffect(() => {
    if (backendStatus === 'ok') void bootstrapCanvases();
    return stopCanvasCatalogRecoveryPolling;
  }, [backendStatus, bootstrapCanvases]);

  // 自定义主题先从轻量缓存恢复，避免首屏扫描主题目录。
  useEffect(() => {
    if (templatesLoaded) return;
    try {
      const raw = window.localStorage.getItem(CUSTOM_THEME_TEMPLATE_CACHE_KEY);
      if (!raw) return;
      if (
        raw.length > CUSTOM_THEME_TEMPLATE_CACHE_MAX_BYTES
        || cachedThemeStringByteLength(raw) > CUSTOM_THEME_TEMPLATE_CACHE_MAX_BYTES
      ) {
        window.localStorage.removeItem(CUSTOM_THEME_TEMPLATE_CACHE_KEY);
        return;
      }
      const parsed = JSON.parse(raw) as { templates?: unknown };
      if (!Array.isArray(parsed.templates)) return;
      const cachedTemplates = parsed.templates
        .filter((item): item is ThemeTemplate => Boolean(
          item
          && typeof item === 'object'
          && (item as ThemeTemplate).schema === 't8-theme-template'
          && typeof (item as ThemeTemplate).id === 'string'
          && (item as ThemeTemplate).id.length <= 160,
        ))
        .slice(0, 1)
        .map(sanitizeCachedThemeTemplate);
      if (cachedTemplates.length > 0) useThemeStore.setState({ customTemplates: cachedTemplates });
    } catch {
      window.localStorage.removeItem(CUSTOM_THEME_TEMPLATE_CACHE_KEY);
    }
  }, [templatesLoaded]);

  useEffect(() => {
    if (!templatesLoaded) return;
    try {
      const activeTemplate = customTemplates.find((template) => template.id === templateId);
      if (!activeTemplate) {
        window.localStorage.removeItem(CUSTOM_THEME_TEMPLATE_CACHE_KEY);
        return;
      }
      const serialized = JSON.stringify({
        version: 1,
        templates: [sanitizeCachedThemeTemplate(activeTemplate)],
      });
      if (cachedThemeStringByteLength(serialized) > CUSTOM_THEME_TEMPLATE_CACHE_MAX_BYTES) {
        window.localStorage.removeItem(CUSTOM_THEME_TEMPLATE_CACHE_KEY);
        return;
      }
      window.localStorage.setItem(CUSTOM_THEME_TEMPLATE_CACHE_KEY, serialized);
    } catch {
      // 缓存压力不影响主题切换；主题管理器仍可从后端刷新。
    }
  }, [customTemplates, templateId, templatesLoaded]);

  useEffect(() => {
    if (templatesLoaded) return;
    const activeTemplateIsUnknown = !BUILT_IN_THEME_TEMPLATES.some(
      (template) => template.id === templateId,
    );
    let timer = 0;
    let idleHandle: number | null = null;
    const refreshWhenIdle = () => {
      window.removeEventListener('pointerdown', refreshWhenIdle);
      window.removeEventListener('keydown', refreshWhenIdle);
      timer = window.setTimeout(() => {
        const run = () => {
          if (!useThemeStore.getState().templatesLoaded) void loadCustomTemplates();
        };
        const requestIdle = (window as any).requestIdleCallback as
          | undefined
          | ((callback: () => void, options: { timeout: number }) => number);
        if (requestIdle) idleHandle = requestIdle(run, { timeout: 5_000 });
        else run();
      }, 1_000);
    };
    if (activeTemplateIsUnknown) {
      refreshWhenIdle();
    } else {
      window.addEventListener('pointerdown', refreshWhenIdle, { once: true });
      window.addEventListener('keydown', refreshWhenIdle, { once: true });
    }
    return () => {
      window.removeEventListener('pointerdown', refreshWhenIdle);
      window.removeEventListener('keydown', refreshWhenIdle);
      window.clearTimeout(timer);
      if (idleHandle != null) (window as any).cancelIdleCallback?.(idleHandle);
    };
  }, [loadCustomTemplates, templateId, templatesLoaded]);

  // settings 不依赖目录扫描，可直接预加载。
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // 资源库快捷键：未选中任何节点时打开 / 关闭资源库。输入框内不拦截，避免打断提示词编辑。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesAnyShortcut(shortcuts['global.resource-library'], e)) return;
      if (e.repeat) return;
      if (isShortcutTypingTarget(e.target)) return;
      if (document.querySelector('.react-flow__node.selected')) return;
      e.preventDefault();
      setResourceOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  // 侧边栏快捷键：H 隐藏 / 恢复左侧栏。输入框内不拦截，避免影响 Prompt 和搜索。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesAnyShortcut(shortcuts['global.sidebar-toggle'], e)) return;
      if (e.repeat) return;
      if (isShortcutTypingTarget(e.target)) return;
      e.preventDefault();
      toggleSidebarCollapsed();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts, toggleSidebarCollapsed]);

  const isDark = theme === 'dark';
  const isPixel = appliedThemeStyle === 'pixel';
  const isOp = appliedThemeStyle === 'op';
  const isRh = appliedThemeStyle === 'rh';
  const isNaruto = appliedThemeStyle === 'naruto';
  const isEva = appliedThemeStyle === 'eva';
  const isYyh = appliedThemeStyle === 'yyh';
  const isSlamdunk = appliedThemeStyle === 'slamdunk';
  const isSoccer = appliedThemeStyle === 'soccer-hero';
  const isDragonBall = appliedThemeStyle === 'dragon-ball';
  const isSaintSeiya = appliedThemeStyle === 'saint-seiya';
  const shenronUnlockedAt = useDragonBallRadarStore((state) => state.shenronUnlockedAt);
  const shenronModeActive = useDragonBallRadarStore((state) => state.shenronModeActive);
  const setShenronModeActive = useDragonBallRadarStore((state) => state.setShenronModeActive);
  const hadesUnlockedAt = useSaintSeiyaSanctuaryStore((state) => state.hadesUnlockedAt);
  const hadesModeActive = useSaintSeiyaSanctuaryStore((state) => state.hadesModeActive);
  const setHadesModeActive = useSaintSeiyaSanctuaryStore((state) => state.setHadesModeActive);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('t8DragonBalls') !== '6') return;
    seedDragonBallRadarForShenronTest(7);
    params.delete('t8DragonBalls');
    const query = params.toString();
    window.history.replaceState(null, document.title, `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('t8SaintSeiya') !== 'hades') return;
    seedSaintSeiyaGoldClothsForHadesTest();
    params.delete('t8SaintSeiya');
    const query = params.toString();
    window.history.replaceState(null, document.title, `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, []);

  const handleDragonBallModeSwitch = (active: boolean) => {
    setShenronModeActive(active);
    if (active && !shenronModeActive) {
      trackAchievementEvent({
        type: 'hidden_mode.enabled',
        theme: 'dragon-ball',
        kind: 'dragon-ball-shenron',
        mode: 'enabled',
      });
    }
  };

  const handleSaintSeiyaModeSwitch = (active: boolean) => {
    setHadesModeActive(active);
    if (active && !hadesModeActive) {
      trackAchievementEvent({
        type: 'hidden_mode.enabled',
        theme: 'saint-seiya',
        kind: 'saint-seiya-hades',
        mode: 'enabled',
      });
    }
  };

  const handleAddNode = (type: NodeType) => {
    addNodeRef.current?.(type);
  };

  const handleInsertResource = async (item: ResourceItem) => {
    const addNode = addNodeRef.current;
    if (!addNode) throw new Error('画布尚未就绪，请稍后再试');
    const portraitData = portraitResourceToNodeData(item);
    if (portraitData) {
      addNode('portrait-master', { data: portraitData });
      return;
    }
    if (item.kind === 'pose') {
      const poseData = await poseResourceToNodeData(item);
      if (!poseData) throw new Error('姿势资源格式无效');
      addNode('pose-master', { data: poseData });
      return;
    }
    if (item.kind === 'workflow') {
      const fragment = await workflowResourceToFragment(item);
      if (!fragment) throw new Error('工作流资源格式无效');
      const insertWorkflow = insertWorkflowRef.current;
      if (!insertWorkflow) throw new Error('画布尚未就绪，请稍后再试');
      insertWorkflow(fragment, { title: item.title || '工作流' });
      return;
    }
    if (item.kind === 'set' && item.materialSetKind && item.materialSetItems?.length) {
      addNode('material-set', {
        data: materialSetItemsToData(
          item.materialSetKind as MaterialSetKind,
          item.materialSetItems as MaterialSetItem[],
        ),
      });
      return;
    }
    const mediaKind = item.kind === 'panorama' ? 'image' : item.kind;
    if (!['image', 'video', 'audio'].includes(mediaKind) || !item.fileUrl) {
      throw new Error('该资源没有可插入的图像、视频或音频文件');
    }
    const kind = mediaKind as Extract<MediaKind, 'image' | 'video' | 'audio'>;
    addNode('upload', {
      data: createUploadDataFromItems(kind, [{
        kind,
        url: item.fileUrl,
        name: item.originalName || item.title || '资源库素材',
        size: item.size,
        mime: item.mime,
      }]),
    });
  };

  return (
    <RHToolsProvider>
    <AchievementTracker />
    <div
      className={`t8-app-shell h-screen flex flex-col overflow-hidden ${
        isPixel ? '' : isDark ? 'bg-zinc-950 text-white' : 'bg-zinc-50 text-zinc-900'
      } ${isOp ? 't8-app-shell--op' : ''} ${isRh ? 't8-app-shell--rh' : ''} ${isNaruto ? 't8-app-shell--naruto' : ''} ${isEva ? 't8-app-shell--eva' : ''} ${isYyh ? 't8-app-shell--yyh' : ''} ${isSlamdunk ? 't8-app-shell--slamdunk' : ''} ${isSoccer ? 't8-app-shell--soccer' : ''} ${isDragonBall ? 't8-app-shell--dragon-ball' : ''} ${isSaintSeiya ? 't8-app-shell--saint-seiya' : ''}`}
      style={{ background: 'var(--t8-bg-app)', color: 'var(--t8-text-main)' }}
    >
      {themeCssFailure && (
        <div
          role="alert"
          data-theme-css-fallback-notice="true"
          className="fixed left-1/2 top-14 z-[250] flex -translate-x-1/2 items-center gap-3 rounded-md border border-amber-400/60 bg-zinc-950 px-3 py-2 text-xs text-amber-100 shadow-xl"
          title={themeCssFailure.message}
        >
          <span>{t('shell:themeCssFailed')}</span>
          <button
            type="button"
            className="rounded border border-amber-300/50 px-2 py-1 font-semibold hover:bg-amber-300/10"
            onClick={() => setThemeCssLoadAttempt((attempt) => attempt + 1)}
          >
            {t('common:actions.retry')} {themeCssFailure.style}
          </button>
        </div>
      )}
      {/* 头部状态栏 */}
      <header
        className={`t8-topbar flex items-center justify-between px-4 py-2 border-b ${
          isPixel
            ? 'px-panel'
            : isDark
              ? 'bg-zinc-900 border-white/10'
              : 'bg-white border-black/10'
        }`}
      >
        <div className="flex items-center gap-3">
          {isOp ? (
            <div className="t8-op-brand flex items-center gap-2">
              <span className="t8-op-brand__mark">
                <Skull size={16} />
              </span>
              <div className="min-w-0">
                <h1 className="t8-op-brand__title text-[14px] font-black leading-none">
                  {t('shell:brand.onePiece')}
                </h1>
                <div className="t8-op-brand__sub text-[9px] font-bold tracking-wide leading-none mt-0.5">
                  GRAND LINE CANVAS
                </div>
              </div>
              <Sailboat className="t8-op-brand__ship" size={15} />
            </div>
          ) : isRh ? (
            <div className="t8-rh-brand flex items-center gap-2">
              <span className="t8-rh-brand__mark">
                <Cloud size={16} />
              </span>
              <div className="min-w-0">
                <h1 className="t8-rh-brand__title text-[14px] font-black leading-none">
                  {t('shell:brand.runningHub')}
                </h1>
                <div className="t8-rh-brand__sub text-[9px] font-bold tracking-wide leading-none mt-0.5">
                  RUNNINGHUB WORKSPACE
                </div>
              </div>
            </div>
          ) : isNaruto ? (
            <div className="t8-naruto-brand flex items-center gap-2">
              <span className="t8-naruto-brand__mark" aria-hidden="true">
                <span className="t8-naruto-brand__leaf" />
              </span>
              <div className="min-w-0">
                <h1 className="t8-naruto-brand__title text-[14px] font-black leading-none">
                  {t('shell:brand.naruto')}
                </h1>
                <div className="t8-naruto-brand__sub text-[9px] font-bold tracking-wide leading-none mt-0.5">
                  SHINOBI CHAKRA CANVAS
                </div>
              </div>
            </div>
          ) : isEva ? (
            <div className="t8-eva-brand flex items-center gap-2">
              <span className="t8-eva-brand__mark" aria-hidden="true">
                <span className="t8-eva-brand__core" />
              </span>
              <div className="min-w-0">
                <h1 className="t8-eva-brand__title text-[14px] font-black leading-none">
                  {t('shell:brand.eva')}
                </h1>
                <div className="t8-eva-brand__sub text-[9px] font-bold tracking-wide leading-none mt-0.5">
                  NERV HQ - TOKYO-3 / MAGI SYSTEM ONLINE
                </div>
              </div>
              <span className="t8-eva-brand__sync" aria-hidden="true">SYSTEM STATUS: ONLINE</span>
            </div>
          ) : isYyh ? (
            <div className="t8-yyh-brand flex items-center gap-2">
              <span className="t8-yyh-brand__mark" aria-hidden="true">
                <Sparkles size={16} />
              </span>
              <div className="min-w-0">
                <h1 className="t8-yyh-brand__title text-[14px] font-black leading-none">
                  {t('shell:brand.yyh')}
                </h1>
                <div className="t8-yyh-brand__sub text-[9px] font-bold tracking-wide leading-none mt-0.5">
                  SPIRIT DETECTIVE CANVAS / REI MAP ONLINE
                </div>
              </div>
              <span className="t8-yyh-brand__status" aria-hidden="true">REI GUN READY</span>
            </div>
          ) : isSlamdunk ? (
            <div className="t8-slamdunk-brand flex items-center gap-2">
              <span className="t8-slamdunk-brand__mark" aria-hidden="true">
                <span className="t8-slamdunk-brand__ball" />
              </span>
              <div className="min-w-0">
                <h1 className="t8-slamdunk-brand__title text-[14px] font-black leading-none">
                  {t('shell:brand.slamDunk')}
                </h1>
                <div className="t8-slamdunk-brand__sub text-[9px] font-bold tracking-wide leading-none mt-0.5">
                  FULL COURT CANVAS / BUZZER BEATER READY
                </div>
              </div>
              <span className="t8-slamdunk-brand__score" aria-hidden="true">T8 10 : 08 AI</span>
            </div>
          ) : isSoccer ? (
            <div className="t8-soccer-brand flex items-center gap-2">
              <span className="t8-soccer-brand__mark" aria-hidden="true">
                <span className="t8-soccer-brand__jersey" />
              </span>
              <div className="min-w-0">
                <h1 className="t8-soccer-brand__title text-[14px] font-black leading-none">
                  {t('shell:brand.soccer')}
                </h1>
                <div className="t8-soccer-brand__sub text-[9px] font-bold tracking-wide leading-none mt-0.5">
                  CAPTAIN TSUBASA CANVAS / GOLDEN GOAL READY
                </div>
              </div>
              <span className="t8-soccer-brand__score" aria-hidden="true">Japan 3:2 Brazil</span>
            </div>
          ) : isDragonBall ? (
            <div className="t8-dragonball-brand flex items-center gap-2">
              <span className="t8-dragonball-brand__mark" aria-hidden="true">
                <span className="t8-dragonball-brand__orb" />
              </span>
              <div className="min-w-0">
                <h1 className="t8-dragonball-brand__title text-[14px] font-black leading-none">
                  {shenronModeActive ? t('shell:brand.shenron') : t('shell:brand.dragonBall')}
                </h1>
                <div className="t8-dragonball-brand__sub text-[9px] font-bold tracking-wide leading-none mt-0.5">
                  {shenronModeActive ? 'SHENRON MODE ONLINE / DRAGON RADAR LOCKED' : 'CAPSULE CORP CANVAS / DRAGON RADAR ONLINE'}
                </div>
              </div>
              <span className="t8-dragonball-brand__stars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : isSaintSeiya ? (
            <div className="t8-saint-brand flex items-center gap-2">
              <span className="t8-saint-brand__mark" aria-hidden="true">
                {hadesModeActive ? <Crown size={16} /> : <Shield size={16} />}
              </span>
              <div className="min-w-0">
                <h1 className="t8-saint-brand__title text-[14px] font-black leading-none">
                  {hadesModeActive ? t('shell:brand.hades') : t('shell:brand.saintSeiya')}
                </h1>
                <div className="t8-saint-brand__sub text-[9px] font-bold tracking-wide leading-none mt-0.5">
                  {hadesModeActive ? 'HADES CHAPTER / ATHENA RESCUED' : 'SANCTUARY CANVAS / COSMO READY'}
                </div>
              </div>
              <span className="t8-saint-brand__zodiac" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          ) : isPixel ? (
            <>
              <h1 className="px-title text-[14px] font-bold tracking-wide leading-none">
                {t('shell:appName')}
              </h1>
              <span className="px-chip px-chip--pink text-[10px]">{t('shell:coopEdition')}</span>
            </>
          ) : (
            <h1 className="text-sm font-semibold">{t('shell:appNameCoop')}</h1>
          )}
          <span
            className={
              isPixel
                ? 'px-chip px-chip--mint text-[10px]'
                : `t8-topbar-status-chip text-[10px] px-1.5 py-0.5 rounded ${
                    isDark ? 'bg-white/10 text-white/60' : 'bg-black/5 text-zinc-500'
                  }`
            }
          >
            v{__APP_VERSION__}
          </span>
          {/* 后端状态 */}
          {isPixel ? (
            <span
              className={`px-chip ${
                backendStatus === 'ok'
                  ? 'px-chip--mint'
                  : backendStatus === 'error'
                    ? 'px-chip--pink'
                    : 'px-chip--yellow'
              }`}
            >
              {backendStatus === 'ok' ? <Wifi size={11} /> : <WifiOff size={11} />}
              {backendStatus === 'ok' && t('shell:backend.connected')}
              {backendStatus === 'error' && t('shell:backend.disconnected')}
              {backendStatus === 'checking' && t('shell:backend.checking')}
            </span>
          ) : (
            <div
              className={`t8-topbar-status-chip flex items-center gap-1.5 text-[11px] ${
                backendStatus === 'ok'
                  ? 'text-emerald-400'
                  : backendStatus === 'error'
                    ? 'text-red-400'
                    : 'text-yellow-400'
              }`}
            >
              {backendStatus === 'ok' ? <Wifi size={12} /> : <WifiOff size={12} />}
              {backendStatus === 'ok' && t('shell:backend.connected')}
              {backendStatus === 'error' && t('shell:backend.disconnected')}
              {backendStatus === 'checking' && t('shell:backend.checking')}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* 「图图打标器」推广按钮: 放在插件安装左侧, 点击后展示说明与获取链接 */}
          <div ref={zhaotutuWrapRef} className="relative">
            <button
              onClick={() => {
                setZhaotutuOpen((v) => !v);
                setApiAcquisitionOpen(false);
                setPluginInstallOpen(false);
                setCanvasTutorialOpen(false);
              }}
              className={
                isPixel
                  ? 'px-btn px-btn--sm px-btn--mint'
                  : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      isDark
                        ? zhaotutuOpen
                          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.32)]'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                        : zhaotutuOpen
                          ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                          : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                    }`
              }
              title={t('shell:promotions.tagger.title')}
            >
              <ExternalLink size={14} />
              <span className="text-[11px]">{t('shell:promotions.tagger.label')}</span>
            </button>

            {zhaotutuOpen && (
              <div
                className={
                  isPixel
                    ? 'absolute right-0 top-full mt-2 z-[60] w-[360px] px-panel rounded-2xl p-3 animate-[fadeIn_.18s_ease-out]'
                    : `absolute right-0 top-full mt-2 z-[60] w-[360px] max-w-[calc(100vw-24px)] rounded-xl p-3 border shadow-2xl backdrop-blur-md animate-[fadeIn_.18s_ease-out] ${
                        isDark
                          ? 'bg-zinc-900/95 border-emerald-400/20 shadow-emerald-500/10'
                          : 'bg-white/95 border-emerald-200 shadow-emerald-500/10'
                      }`
                }
                style={{ zoom: 1.25 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={`flex items-center gap-2 ${isPixel ? '' : isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                  <ExternalLink size={16} className={isPixel ? '' : 'shrink-0'} />
                  <span className={`text-sm font-bold ${isPixel ? 'px-title' : ''}`}>{t('shell:promotionDetails.tagger.heading')}</span>
                </div>

                <div
                  className={`mt-2 text-[12px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/75' : 'text-zinc-700'
                  }`}
                >
                  {uiLocale === 'en-US' ? t('shell:promotionDetails.tagger.description') : ZHAOTUTU_TAGGER_TRAINER_LABEL.replace('：点击获取', '')}
                </div>

                <button
                  type="button"
                  onClick={handleOpenZhaotutuTaggerTrainer}
                  className={
                    isPixel
                      ? 'mt-3 px-btn px-btn--mint w-full justify-center'
                      : `mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition-all ${
                          isDark
                            ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-300/60'
                            : 'bg-emerald-50 border-emerald-400 text-emerald-700 hover:bg-emerald-100'
                        }`
                  }
                >
                  <ExternalLink size={13} />
                  <span>{t('shell:promotionDetails.tagger.open')}</span>
                </button>
              </div>
            )}
          </div>

          {/* 「API获取」按钮: 紧邻图图打标器，以短标题展示四套 API 注册入口 */}
          <div ref={apiAcquisitionWrapRef} className="relative">
            <button
              onClick={() => {
                setApiAcquisitionOpen((v) => !v);
                setZhaotutuOpen(false);
                setPluginInstallOpen(false);
                setCanvasTutorialOpen(false);
              }}
              className={
                isPixel
                  ? 'px-btn px-btn--sm px-btn--yellow'
                  : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      isDark
                        ? apiAcquisitionOpen
                          ? 'bg-violet-500/20 border-violet-400/50 text-violet-200 shadow-[0_0_12px_rgba(139,92,246,0.32)]'
                          : 'bg-violet-500/10 border-violet-500/30 text-violet-300 hover:bg-violet-500/20'
                        : apiAcquisitionOpen
                          ? 'bg-violet-100 border-violet-400 text-violet-800'
                          : 'bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100'
                    }`
              }
              title={t('shell:promotions.apiKeys.title')}
            >
              <KeyRound size={14} />
              <span className="text-[11px]">{t('shell:promotions.apiKeys.label')}</span>
            </button>

            {apiAcquisitionOpen && (
              <div
                className={
                  isPixel
                    ? 'absolute left-0 top-full mt-2 z-[60] w-[540px] max-w-[calc(100vw-24px)] px-panel rounded-2xl p-3 animate-[fadeIn_.18s_ease-out]'
                    : `absolute left-0 top-full mt-2 z-[60] w-[540px] max-w-[calc(100vw-24px)] rounded-xl p-3 border shadow-2xl backdrop-blur-md animate-[fadeIn_.18s_ease-out] ${
                        isDark
                          ? 'bg-zinc-900/95 border-violet-400/20 shadow-violet-500/10'
                          : 'bg-white/95 border-violet-200 shadow-violet-500/10'
                      }`
                }
                style={{ zoom: 1.25 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={`flex items-center gap-2 ${isPixel ? '' : isDark ? 'text-violet-300' : 'text-violet-700'}`}>
                  <KeyRound size={16} className={isPixel ? '' : 'shrink-0'} />
                  <span className={`text-sm font-bold ${isPixel ? 'px-title' : ''}`}>{t('shell:promotionDetails.api.heading')}</span>
                </div>
                <div className={`mt-1 text-[11px] leading-relaxed ${isPixel ? '' : isDark ? 'text-white/65' : 'text-zinc-600'}`}>
                  {t('shell:promotionDetails.api.description')}
                </div>

                <div className="mt-3 grid max-h-[70vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {API_ACQUISITION_LINKS.map((item) => (
                    <section
                      key={item.id}
                      className={
                        isPixel
                          ? 'flex min-h-[142px] flex-col rounded-xl border-2 border-black bg-[#FFF8D6] p-2 shadow-[3px_3px_0_#111]'
                          : `flex min-h-[142px] flex-col rounded-lg border p-2.5 ${
                              isDark
                                ? 'bg-violet-400/10 border-violet-300/20'
                                : 'bg-violet-50/80 border-violet-200'
                            }`
                      }
                    >
                      <h3 className={`text-[12px] font-bold leading-snug ${isPixel ? '' : isDark ? 'text-violet-100' : 'text-violet-950'}`}>
                        {uiLocale === 'en-US' ? item.titleEn : item.title}
                      </h3>
                      <p className={`mt-1.5 flex-1 text-[10px] leading-relaxed ${isPixel ? '' : isDark ? 'text-white/70' : 'text-zinc-700'}`}>
                        {uiLocale === 'en-US' ? item.descriptionEn : item.description}
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleOpenApiAcquisition(item.url)}
                        className={
                          isPixel
                            ? 'mt-2 px-btn px-btn--mint w-full justify-center'
                            : `mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] font-semibold transition-all ${
                                isDark
                                  ? 'bg-violet-500/15 border-violet-400/40 text-violet-100 hover:bg-violet-500/25 hover:border-violet-300/60'
                                  : 'bg-violet-100 border-violet-300 text-violet-800 hover:bg-violet-200'
                              }`
                        }
                        title={uiLocale === 'en-US' ? item.actionEn : item.action}
                      >
                        <ExternalLink size={12} />
                        <span>{uiLocale === 'en-US' ? item.actionEn : item.action}</span>
                      </button>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 「插件安装」说明按钮: 放在画布教程左侧, 汇总需要宿主软件单独加载的联动插件 */}
          <div ref={pluginInstallWrapRef} className="relative">
            <button
              onClick={() => {
                setPluginInstallOpen((v) => !v);
                setApiAcquisitionOpen(false);
                setCanvasTutorialOpen(false);
              }}
              className={
                isPixel
                  ? `px-btn px-btn--sm px-btn--mint`
                  : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      isDark
                        ? pluginInstallOpen
                          ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.32)]'
                          : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20'
                        : pluginInstallOpen
                          ? 'bg-cyan-100 border-cyan-400 text-cyan-800'
                          : 'bg-cyan-50 border-cyan-300 text-cyan-700 hover:bg-cyan-100'
                    }`
              }
              title={t('shell:promotions.plugins.title')}
            >
              <Puzzle size={14} />
              <span className="text-[11px]">{t('shell:promotions.plugins.label')}</span>
            </button>

            {pluginInstallOpen && (
              <div
                className={
                  isPixel
                    ? 'absolute right-0 top-full mt-2 z-[60] w-[560px] max-w-[calc(100vw-24px)] px-panel rounded-2xl p-3 animate-[fadeIn_.18s_ease-out]'
                    : `absolute right-0 top-full mt-2 z-[60] w-[560px] max-w-[calc(100vw-24px)] rounded-xl p-3 border shadow-2xl backdrop-blur-md animate-[fadeIn_.18s_ease-out] ${
                        isDark
                          ? 'bg-zinc-900/95 border-cyan-400/20 shadow-cyan-500/10'
                          : 'bg-white/95 border-cyan-200 shadow-cyan-500/10'
                      }`
                }
                style={{ zoom: 1.25 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={`flex items-center gap-2 ${isPixel ? '' : isDark ? 'text-cyan-300' : 'text-cyan-700'}`}>
                  <Puzzle size={16} className={isPixel ? '' : 'shrink-0'} />
                  <span className={`text-sm font-bold ${isPixel ? 'px-title' : ''}`}>{t('shell:promotionDetails.plugins.heading')}</span>
                </div>

                <div
                  className={`mt-2 text-[12px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/75' : 'text-zinc-700'
                  }`}
                >
                  {t('shell:promotionDetails.plugins.description')}
                </div>

                <div className="mt-3 grid max-h-[70vh] gap-2 overflow-y-auto pr-1">
                  {CANVAS_PLUGIN_INSTALL_GUIDES.map((guide) => (
                    <div
                      key={guide.name}
                      className={
                        isPixel
                          ? 'rounded-xl border-2 border-black bg-[#FFF8D6] p-2 shadow-[3px_3px_0_#111]'
                          : `rounded-lg border p-2 ${
                              isDark
                                ? 'bg-cyan-400/10 border-cyan-300/20'
                                : 'bg-cyan-50/80 border-cyan-200'
                            }`
                      }
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-[12px] font-bold ${isPixel ? '' : isDark ? 'text-cyan-100' : 'text-cyan-950'}`}>
                          {uiLocale === 'en-US' ? guide.nameEn : guide.name}
                        </span>
                        <span
                          className={
                            isPixel
                              ? 'rounded border border-black px-1 text-[9px]'
                              : `rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                  isDark
                                    ? 'bg-cyan-400/15 text-cyan-100'
                                    : 'bg-cyan-100 text-cyan-900'
                                }`
                          }
                        >
                          {uiLocale === 'en-US' ? guide.targetEn : guide.target}
                        </span>
                      </div>
                      <div className={`mt-1 grid gap-1 text-[10px] leading-relaxed ${isPixel ? '' : isDark ? 'text-white/70' : 'text-zinc-700'}`}>
                        <div>
                          {t('shell:promotionDetails.plugins.development')}：<code className={isPixel ? '' : isDark ? 'text-cyan-100' : 'text-cyan-900'}>{guide.devPath}</code>
                        </div>
                        <div>
                          {t('shell:promotionDetails.plugins.packaged')}：<code className={isPixel ? '' : isDark ? 'text-cyan-100' : 'text-cyan-900'}>{guide.packagedPath}</code>
                        </div>
                        <div>{t('shell:promotionDetails.plugins.install')}：{uiLocale === 'en-US' ? guide.installEn : guide.install}</div>
                        <div>{t('shell:promotionDetails.plugins.usage')}：{uiLocale === 'en-US' ? guide.useEn : guide.use}</div>
                        <div>{t('shell:promotionDetails.plugins.safety')}：{uiLocale === 'en-US' ? guide.safetyEn : guide.safety}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 「画布教程」教程合集按钮: 放在最新应用左侧, 方便新用户按版本学习 */}
          <div ref={canvasTutorialWrapRef} className="relative">
            <button
              onClick={() => {
                setCanvasTutorialOpen((v) => !v);
                setApiAcquisitionOpen(false);
                setPluginInstallOpen(false);
              }}
              className={
                isPixel
                  ? `px-btn px-btn--sm px-btn--yellow`
                  : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      isDark
                        ? canvasTutorialOpen
                          ? 'bg-amber-500/20 border-amber-400/50 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.35)]'
                          : 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                        : canvasTutorialOpen
                          ? 'bg-amber-100 border-amber-400 text-amber-800'
                          : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                    }`
              }
              title={t('shell:promotions.tutorials.title')}
            >
              <BookOpen size={14} />
              <span className="text-[11px]">{t('shell:promotions.tutorials.label')}</span>
            </button>

            {canvasTutorialOpen && (
              <div
                className={
                  isPixel
                    ? 'absolute right-0 top-full mt-2 z-[60] w-[520px] max-w-[calc(100vw-24px)] px-panel rounded-2xl p-3 animate-[fadeIn_.18s_ease-out]'
                    : `absolute right-0 top-full mt-2 z-[60] w-[520px] max-w-[calc(100vw-24px)] rounded-xl p-3 border shadow-2xl backdrop-blur-md animate-[fadeIn_.18s_ease-out] ${
                        isDark
                          ? 'bg-zinc-900/95 border-amber-400/20 shadow-amber-500/10'
                          : 'bg-white/95 border-amber-200 shadow-amber-500/10'
                      }`
                }
                style={{ zoom: 1.25 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className={`flex items-center gap-2 ${isPixel ? '' : isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                  <BookOpen size={16} className={isPixel ? '' : 'shrink-0'} />
                  <span className={`text-sm font-bold ${isPixel ? 'px-title' : ''}`}>{t('shell:promotionDetails.tutorials.heading')}</span>
                </div>

                <div
                  className={`mt-2 text-[12px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/75' : 'text-zinc-700'
                  }`}
                >
                  {t('shell:promotionDetails.tutorials.description')}
                </div>

                <div className="mt-3 grid gap-2 max-h-[70vh] overflow-y-auto pr-1">
                  {CANVAS_TUTORIALS.map((tutorial, index) => (
                      <div
                        key={tutorial.bilibili}
                        className={
                          isPixel
                            ? 'rounded-xl border-2 border-black bg-[#FFF8D6] p-2 shadow-[3px_3px_0_#111]'
                            : `rounded-lg border p-2 ${
                                isDark
                                  ? 'bg-white/5 border-white/10'
                                  : 'bg-amber-50/70 border-amber-200'
                              }`
                        }
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={
                              isPixel
                                ? 'px-chip px-chip--yellow shrink-0'
                                : `inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[10px] font-bold ${
                                    isDark
                                      ? 'bg-amber-400/20 text-amber-200'
                                      : 'bg-amber-200 text-amber-900'
                                  }`
                            }
                          >
                            {index + 1}
                          </span>
                          <div className={`text-[12px] font-bold leading-snug ${isPixel ? '' : isDark ? 'text-white' : 'text-zinc-900'}`}>
                            {uiLocale === 'en-US' ? t('shell:promotionDetails.tutorials.episode', { index: index + 1 }) : tutorial.title}
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          <a
                            href={tutorial.bilibili}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setCanvasTutorialOpen(false)}
                            title={t('shell:promotionDetails.tutorials.bilibiliTitle', { url: tutorial.bilibili })}
                            className={
                              isPixel
                                ? 'px-btn px-btn--sm px-btn--pink justify-start min-w-0'
                                : `flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                                    isDark
                                      ? 'border-pink-400/30 bg-pink-500/10 text-pink-200 hover:bg-pink-500/20'
                                      : 'border-pink-300 bg-white text-pink-700 hover:bg-pink-50'
                                  }`
                            }
                          >
                            <span
                              className={
                                isPixel
                                  ? 'inline-flex items-center justify-center w-4 h-4 rounded-sm bg-white text-black text-[10px] font-black border border-black shrink-0'
                                  : 'inline-flex items-center justify-center w-4 h-4 rounded-sm bg-pink-600 text-white text-[10px] font-black shrink-0'
                              }
                            >
                              B
                            </span>
                            <span className="min-w-0">
                              <span className="block leading-tight">{t('shell:promotionDetails.tutorials.bilibili')}</span>
                              <span className="block truncate text-[9px] opacity-70">{tutorial.bilibili}</span>
                            </span>
                            <ExternalLink size={10} className="ml-auto shrink-0 opacity-70" />
                          </a>

                          <a
                            href={tutorial.youtube}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setCanvasTutorialOpen(false)}
                            title={t('shell:promotionDetails.tutorials.youtubeTitle', { url: tutorial.youtube })}
                            className={
                              isPixel
                                ? 'px-btn px-btn--sm px-btn--mint justify-start min-w-0'
                                : `flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                                    isDark
                                      ? 'border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'
                                      : 'border-red-300 bg-white text-red-700 hover:bg-red-50'
                                  }`
                            }
                          >
                            <Youtube size={14} className="shrink-0" />
                            <span className="min-w-0">
                              <span className="block leading-tight">{t('shell:promotionDetails.tutorials.youtube')}</span>
                              <span className="block truncate text-[9px] opacity-70">{tutorial.youtube}</span>
                            </span>
                            <ExternalLink size={10} className="ml-auto shrink-0 opacity-70" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
            )}
          </div>

          {/* 「最新应用」推广按钮: 同款胶囊, 主调 橙桃色(区分于 violet/mint/yellow/pink) */}
          <div ref={appWrapRef} className="relative">
            <button
              onClick={() => setAppOpen((v) => !v)}
              className={
                isPixel
                  ? `px-btn px-btn--sm px-btn--peach`
                  : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      isDark
                        ? appOpen
                          ? 'bg-orange-500/20 border-orange-400/50 text-orange-200 shadow-[0_0_12px_rgba(249,115,22,0.35)]'
                          : 'bg-orange-500/10 border-orange-500/30 text-orange-300 hover:bg-orange-500/20'
                        : appOpen
                          ? 'bg-orange-100 border-orange-400 text-orange-800'
                          : 'bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100'
                    }`
              }
              title={t('shell:promotions.latestApps.title')}
            >
              <Rocket size={14} />
              <span className="text-[11px]">{t('shell:promotions.latestApps.label')}</span>
            </button>

            {/* 推广浮层 */}
            {appOpen && (
              <div
                className={
                  isPixel
                    ? 'absolute right-0 top-full mt-2 z-[60] w-[360px] px-panel rounded-2xl p-3 animate-[fadeIn_.18s_ease-out]'
                    : `absolute right-0 top-full mt-2 z-[60] w-[360px] rounded-xl p-3 border shadow-2xl backdrop-blur-md animate-[fadeIn_.18s_ease-out] ${
                        isDark
                          ? 'bg-zinc-900/95 border-orange-400/20 shadow-orange-500/10'
                          : 'bg-white/95 border-orange-200 shadow-orange-500/10'
                      }`
                }
                style={{ zoom: 1.5 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* 标题 */}
                <div className={`flex items-center gap-2 ${isPixel ? '' : isDark ? 'text-orange-300' : 'text-orange-700'}`}>
                  <Rocket size={16} className={isPixel ? '' : 'shrink-0'} />
                  <span className={`text-sm font-bold ${isPixel ? 'px-title' : ''}`}>{t('shell:promotionDetails.latestApps.heading')}</span>
                </div>

                {/* 副标 */}
                <div
                  className={`mt-2 text-[12px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/80' : 'text-zinc-700'
                  }`}
                >
                  {t('shell:promotionDetails.latestApps.description')} ✨
                </div>

                {/* 国内站跳转按钮 */}
                <a
                  href="https://www.runninghub.cn/user-center/1819214514410942465/webapp?inviteCode=rh-v1121"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setAppOpen(false)}
                  className={
                    isPixel
                      ? 'mt-3 px-btn px-btn--peach w-full justify-center'
                      : `mt-3 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all border ${
                          isDark
                            ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/20 border-orange-400/40 text-orange-200 hover:from-orange-500/30 hover:to-amber-500/30 hover:border-orange-400/60 hover:shadow-[0_0_16px_rgba(249,115,22,0.35)]'
                            : 'bg-gradient-to-r from-orange-500 to-amber-500 border-amber-600 text-white hover:from-orange-600 hover:to-amber-600 hover:shadow-lg'
                        }`
                  }
                >
                  <Globe size={14} className={isPixel ? '' : 'shrink-0'} />
                  <span>{t('shell:promotionDetails.latestApps.china')}</span>
                  <ExternalLink size={11} className="opacity-70" />
                </a>

                {/* 海外站跳转按钮 */}
                <a
                  href="https://www.runninghub.ai/user-center/1907375370302308353/webapp?inviteCode=rh-v1121"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setAppOpen(false)}
                  className={
                    isPixel
                      ? 'mt-2 px-btn px-btn--yellow w-full justify-center'
                      : `mt-2 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all border ${
                          isDark
                            ? 'bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border-amber-400/40 text-amber-200 hover:from-amber-500/30 hover:to-yellow-500/30 hover:border-amber-400/60 hover:shadow-[0_0_16px_rgba(245,158,11,0.35)]'
                            : 'bg-gradient-to-r from-amber-400 to-yellow-400 border-amber-500 text-amber-900 hover:from-amber-500 hover:to-yellow-500 hover:shadow-lg'
                        }`
                  }
                >
                  <Globe size={14} className={isPixel ? '' : 'shrink-0'} />
                  <span>{t('shell:promotionDetails.latestApps.global')}</span>
                  <ExternalLink size={11} className="opacity-70" />
                </a>

                {/* 推荐标语 */}
                <div
                  className={`mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed ${
                    isPixel
                      ? 'px-chip px-chip--mint w-full justify-start py-1.5 px-2'
                      : isDark
                        ? 'text-emerald-200/90 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-2 py-1.5'
                        : 'text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-md px-2 py-1.5'
                  }`}
                >
                  <Sparkles
                    size={12}
                    className={`mt-0.5 shrink-0 ${
                      isPixel ? '' : isDark ? 'text-emerald-300' : 'text-emerald-600'
                    }`}
                  />
                  <span>
                    {t('shell:promotionDetails.latestApps.invitePrefix')}
                    <span className={isPixel ? 'font-bold' : `font-semibold ${isDark ? 'text-emerald-200' : 'text-emerald-900'}`}> rh-v1121 </span>
                    {t('shell:promotionDetails.latestApps.inviteSuffix')}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 「AIX产品」推广按钮: 同款胶囊, 主调 青蓝色 */}
          <div ref={aixWrapRef} className="relative">
            <button
              onClick={() => setAixOpen((v) => !v)}
              className={
                isPixel
                  ? `px-btn px-btn--sm px-btn--sky`
                  : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      isDark
                        ? aixOpen
                          ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.35)]'
                          : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20'
                        : aixOpen
                          ? 'bg-cyan-100 border-cyan-400 text-cyan-800'
                          : 'bg-cyan-50 border-cyan-300 text-cyan-700 hover:bg-cyan-100'
                    }`
              }
              title={t('shell:promotions.aix.title')}
            >
              <Sparkles size={14} />
              <span className="text-[11px]">{t('shell:promotions.aix.label')}</span>
            </button>

            {/* 推广浮层 */}
            {aixOpen && (
              <div
                className={
                  isPixel
                    ? 'absolute right-0 top-full mt-2 z-[60] w-[300px] px-panel rounded-2xl p-3 animate-[fadeIn_.18s_ease-out]'
                    : `absolute right-0 top-full mt-2 z-[60] w-[300px] rounded-xl p-3 border shadow-2xl backdrop-blur-md animate-[fadeIn_.18s_ease-out] ${
                        isDark
                          ? 'bg-zinc-900/95 border-cyan-400/20 shadow-cyan-500/10'
                          : 'bg-white/95 border-cyan-200 shadow-cyan-500/10'
                      }`
                }
                style={{ zoom: 1.5 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* 标题 */}
                <div className={`flex items-center gap-2 ${isPixel ? '' : isDark ? 'text-cyan-300' : 'text-cyan-700'}`}>
                  <Sparkles size={16} className={isPixel ? '' : 'shrink-0'} />
                  <span className={`text-sm font-bold ${isPixel ? 'px-title' : ''}`}>{t('shell:promotionDetails.aix.heading')}</span>
                </div>

                {/* 副标 */}
                <div
                  className={`mt-2 text-[12px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/80' : 'text-zinc-700'
                  }`}
                >
                  {t('shell:promotionDetails.aix.description')}
                </div>

                {/* 主行动 CTA: 跳转链接(新窗口) */}
                <a
                  href="https://aix.studio?partnerCode=10562"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setAixOpen(false)}
                  className={
                    isPixel
                      ? 'mt-3 px-btn px-btn--sky w-full justify-center'
                      : `mt-3 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all border ${
                          isDark
                            ? 'bg-gradient-to-r from-cyan-500/20 to-sky-500/20 border-cyan-400/40 text-cyan-200 hover:from-cyan-500/30 hover:to-sky-500/30 hover:border-cyan-400/60 hover:shadow-[0_0_16px_rgba(34,211,238,0.35)]'
                            : 'bg-gradient-to-r from-cyan-500 to-sky-500 border-cyan-600 text-white hover:from-cyan-600 hover:to-sky-600 hover:shadow-lg'
                        }`
                  }
                >
                  <ExternalLink size={13} />
                  <span>{t('shell:promotionDetails.aix.open')}</span>
                </a>
              </div>
            )}
          </div>

          {/* 「贞贞工坊」推广按钮: 同款胶囊, 主调 紫色(区分于 mint/yellow/pink) */}
          <div ref={zhenWrapRef} className="relative">
            <button
              onClick={() => setZhenOpen((v) => !v)}
              className={
                isPixel
                  ? `px-btn px-btn--sm px-btn--violet`
                  : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      isDark
                        ? zhenOpen
                          ? 'bg-violet-500/20 border-violet-400/50 text-violet-200 shadow-[0_0_12px_rgba(139,92,246,0.35)]'
                          : 'bg-violet-500/10 border-violet-500/30 text-violet-300 hover:bg-violet-500/20'
                        : zhenOpen
                          ? 'bg-violet-100 border-violet-400 text-violet-800'
                          : 'bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100'
                    }`
              }
              title={t('shell:promotions.workshop.title')}
            >
              <Wand2 size={14} />
              <span className="text-[11px]">{t('shell:promotions.workshop.label')}</span>
            </button>

            {/* 推广浮层 */}
            {zhenOpen && (
              <div
                className={
                  isPixel
                    ? 'absolute right-0 top-full mt-2 z-[60] w-[340px] px-panel rounded-2xl p-3 animate-[fadeIn_.18s_ease-out]'
                    : `absolute right-0 top-full mt-2 z-[60] w-[340px] rounded-xl p-3 border shadow-2xl backdrop-blur-md animate-[fadeIn_.18s_ease-out] ${
                        isDark
                          ? 'bg-zinc-900/95 border-violet-400/20 shadow-violet-500/10'
                          : 'bg-white/95 border-violet-200 shadow-violet-500/10'
                      }`
                }
                style={{ zoom: 1.5 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* 标题 */}
                <div className={`flex items-center gap-2 ${isPixel ? '' : isDark ? 'text-violet-300' : 'text-violet-700'}`}>
                  <Wand2 size={16} className={isPixel ? '' : 'shrink-0'} />
                  <span className={`text-sm font-bold ${isPixel ? 'px-title' : ''}`}>{t('shell:promotionDetails.workshop.heading')}</span>
                </div>

                {/* 副标 */}
                <div
                  className={`mt-2 text-[12px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/80' : 'text-zinc-700'
                  }`}
                >
                  {t('shell:promotionDetails.workshop.description')}
                </div>

                {/* 海外站跳转按钮 */}
                <a
                  href="https://ai.t8star.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setZhenOpen(false)}
                  className={
                    isPixel
                      ? 'mt-3 px-btn px-btn--violet w-full justify-center'
                      : `mt-3 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all border ${
                          isDark
                            ? 'bg-gradient-to-r from-violet-500/20 to-purple-500/20 border-violet-400/40 text-violet-200 hover:from-violet-500/30 hover:to-purple-500/30 hover:border-violet-400/60 hover:shadow-[0_0_16px_rgba(139,92,246,0.35)]'
                            : 'bg-gradient-to-r from-violet-500 to-purple-500 border-purple-600 text-white hover:from-violet-600 hover:to-purple-600 hover:shadow-lg'
                        }`
                  }
                >
                  <Globe size={14} className={isPixel ? '' : 'shrink-0'} />
                  <span>{t('shell:promotionDetails.workshop.global')}</span>
                  <ExternalLink size={11} className="opacity-70" />
                </a>

                {/* Discord 跳转按钮 */}
                <a
                  href="https://discord.gg/sAK2THPWhZ"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setZhenOpen(false)}
                  className={
                    isPixel
                      ? 'mt-2 px-btn px-btn--sky w-full justify-center'
                      : `mt-2 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all border ${
                          isDark
                            ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-400/60 hover:shadow-[0_0_16px_rgba(99,102,241,0.3)]'
                            : 'bg-indigo-50 border-indigo-400 text-indigo-700 hover:bg-indigo-100'
                        }`
                  }
                >
                  <MessageCircle size={14} className={isPixel ? '' : 'shrink-0'} />
                  <span>{t('shell:promotionDetails.workshop.discord')}</span>
                  <ExternalLink size={11} className="opacity-70" />
                </a>

                {/* 公告 */}
                <div
                  className={`mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed ${
                    isPixel
                      ? 'px-chip px-chip--yellow w-full justify-start py-1.5 px-2'
                      : isDark
                        ? 'text-amber-200/90 bg-amber-500/10 border border-amber-500/30 rounded-md px-2 py-1.5'
                        : 'text-amber-800 bg-amber-50 border border-amber-300 rounded-md px-2 py-1.5'
                  }`}
                >
                  <CalendarDays
                    size={12}
                    className={`mt-0.5 shrink-0 ${
                      isPixel ? '' : isDark ? 'text-amber-300' : 'text-amber-600'
                    }`}
                  />
                  <span>
                    {t('shell:promotionDetails.workshop.noticePrefix')}
                    <span className={isPixel ? 'font-bold' : `font-semibold ${isDark ? 'text-amber-200' : 'text-amber-900'}`}> {t('shell:promotionDetails.workshop.noticeDate')} </span>
                    {t('shell:promotionDetails.workshop.noticeSuffix')}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 「视频教程」推广按钮: 与右侧【在线画布/主题/风格】同款胶囊, 主调 红色(B 站 / Youtube 调性) */}
          <div ref={videoWrapRef} className="relative">
            <button
              onClick={() => setVideoOpen((v) => !v)}
              className={
                isPixel
                  ? `px-btn px-btn--sm px-btn--mint`
                  : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      isDark
                        ? videoOpen
                          ? 'bg-rose-500/20 border-rose-400/50 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.35)]'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
                        : videoOpen
                          ? 'bg-rose-100 border-rose-400 text-rose-800'
                          : 'bg-rose-50 border-rose-300 text-rose-700 hover:bg-rose-100'
                    }`
              }
              title={t('shell:promotions.videoTutorials.title')}
            >
              <PlayCircle size={14} />
              <span className="text-[11px]">{t('shell:promotions.videoTutorials.label')}</span>
            </button>

            {/* 推广浮层 */}
            {videoOpen && (
              <div
                className={
                  isPixel
                    ? 'absolute right-0 top-full mt-2 z-[60] w-[320px] px-panel rounded-2xl p-3 animate-[fadeIn_.18s_ease-out]'
                    : `absolute right-0 top-full mt-2 z-[60] w-[320px] rounded-xl p-3 border shadow-2xl backdrop-blur-md animate-[fadeIn_.18s_ease-out] ${
                        isDark
                          ? 'bg-zinc-900/95 border-rose-400/20 shadow-rose-500/10'
                          : 'bg-white/95 border-rose-200 shadow-rose-500/10'
                      }`
                }
                style={{ zoom: 1.5 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* 标题 */}
                <div className={`flex items-center gap-2 ${isPixel ? '' : isDark ? 'text-rose-300' : 'text-rose-700'}`}>
                  <PlayCircle size={16} className={isPixel ? '' : 'shrink-0'} />
                  <span className={`text-sm font-bold ${isPixel ? 'px-title' : ''}`}>{t('shell:promotionDetails.videoTutorials.heading')}</span>
                </div>

                {/* 副标 */}
                <div
                  className={`mt-2 text-[12px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/80' : 'text-zinc-700'
                  }`}
                >
                  {t('shell:promotionDetails.videoTutorials.description')}
                </div>

                {/* B 站 跳转按钮 */}
                <a
                  href="https://space.bilibili.com/385085361"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setVideoOpen(false)}
                  className={
                    isPixel
                      ? 'mt-3 px-btn px-btn--pink w-full justify-center'
                      : `mt-3 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all border ${
                          isDark
                            ? 'bg-gradient-to-r from-pink-500/20 to-rose-500/20 border-pink-400/40 text-pink-200 hover:from-pink-500/30 hover:to-rose-500/30 hover:border-pink-400/60 hover:shadow-[0_0_16px_rgba(236,72,153,0.35)]'
                            : 'bg-gradient-to-r from-pink-500 to-rose-500 border-rose-600 text-white hover:from-pink-600 hover:to-rose-600 hover:shadow-lg'
                        }`
                  }
                >
                  {/* 小伊主机图标(荷包未内置专用 B 站 logo, 用 PlayCircle + “B” 文字代替) */}
                  <span
                    className={
                      isPixel
                        ? 'inline-flex items-center justify-center w-4 h-4 rounded-sm bg-white text-black text-[10px] font-black border border-black'
                        : 'inline-flex items-center justify-center w-4 h-4 rounded-sm bg-white text-rose-600 text-[10px] font-black'
                    }
                  >
                    B
                  </span>
                  <span>{t('shell:promotionDetails.videoTutorials.bilibili')}</span>
                  <ExternalLink size={11} className="opacity-70" />
                </a>

                {/* YouTube 跳转按钮 */}
                <a
                  href="https://space.bilibili.com/385085361"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setVideoOpen(false)}
                  className={
                    isPixel
                      ? 'mt-2 px-btn px-btn--mint w-full justify-center'
                      : `mt-2 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all border ${
                          isDark
                            ? 'bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20 hover:border-red-400/60 hover:shadow-[0_0_16px_rgba(239,68,68,0.3)]'
                            : 'bg-red-50 border-red-400 text-red-700 hover:bg-red-100'
                        }`
                  }
                >
                  <Youtube size={14} className={isPixel ? '' : 'shrink-0'} />
                  <span>{t('shell:promotionDetails.videoTutorials.youtube')}</span>
                  <ExternalLink size={11} className="opacity-70" />
                </a>

                {/* 关注提示 */}
                <div
                  className={`mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/70' : 'text-zinc-600'
                  }`}
                >
                  <Bell
                    size={11}
                    className={`mt-0.5 shrink-0 ${
                      isPixel ? '' : isDark ? 'text-amber-300' : 'text-amber-600'
                    }`}
                  />
                  <span>
                    {t('shell:promotionDetails.videoTutorials.followPrefix')} <span className={isPixel ? 'font-bold' : `font-semibold ${isDark ? 'text-rose-300' : 'text-rose-700'}`}>T8</span>{t('shell:promotionDetails.videoTutorials.followMiddle')}
                    <span className={isPixel ? 'font-bold' : `font-semibold ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}> {t('shell:promotionDetails.videoTutorials.freeUpdates')} </span>
                    {t('shell:promotionDetails.videoTutorials.followSuffix')}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 「在线画布」推广按钮: 与右侧主题/风格按钮同款外观, 点击展开浮层 */}
          <div ref={cloudWrapRef} className="relative">
            <button
              onClick={() => setCloudOpen((v) => !v)}
              className={
                isPixel
                  ? `px-btn px-btn--sm ${cloudOpen ? 'px-btn--mint' : 'px-btn--yellow'}`
                  : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all border ${
                      isDark
                        ? cloudOpen
                          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                        : cloudOpen
                          ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                          : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                    }`
              }
              title={t('shell:promotions.cloudCanvas.title')}
            >
              <Cloud size={14} />
              <span className="text-[11px]">{t('shell:promotions.cloudCanvas.label')}</span>
            </button>

            {/* 推广浮层 */}
            {cloudOpen && (
              <div
                className={
                  isPixel
                    ? 'absolute right-0 top-full mt-2 z-[60] w-[320px] px-panel rounded-2xl p-3 animate-[fadeIn_.18s_ease-out]'
                    : `absolute right-0 top-full mt-2 z-[60] w-[320px] rounded-xl p-3 border shadow-2xl backdrop-blur-md animate-[fadeIn_.18s_ease-out] ${
                        isDark
                          ? 'bg-zinc-900/95 border-emerald-400/20 shadow-emerald-500/10'
                          : 'bg-white/95 border-emerald-200 shadow-emerald-500/10'
                      }`
                }
                style={{ zoom: 1.5 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* 标题 */}
                <div className={`flex items-center gap-2 ${isPixel ? '' : isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                  <Cloud size={16} className={isPixel ? '' : 'shrink-0'} />
                  <span className={`text-sm font-bold ${isPixel ? 'px-title' : ''}`}>{t('shell:promotionDetails.cloudCanvas.heading')}</span>
                </div>

                {/* 副标 + 鹅卵石提示 */}
                <div
                  className={`mt-2 text-[12px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/80' : 'text-zinc-700'
                  }`}
                >
                  {t('shell:promotionDetails.cloudCanvas.descriptionPrefix')} <span className={isPixel ? 'font-bold' : `font-semibold ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>{t('shell:promotionDetails.cloudCanvas.product')}</span>
                  <span
                    className={
                      isPixel
                        ? 'inline-flex items-center gap-1 ml-1 px-chip px-chip--yellow'
                        : `inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700'
                          }`
                    }
                  >
                    <Gift size={10} /> {t('shell:promotionDetails.cloudCanvas.gift')}
                  </span>
                </div>

                {/* 主行动 CTA: 跳转链接(新窗口) */}
                <a
                  href="https://cloud.pebbling.cn/user/?invite=T8STAR"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setCloudOpen(false)}
                  className={
                    isPixel
                      ? 'mt-3 px-btn px-btn--mint w-full justify-center'
                      : `mt-3 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-semibold transition-all border ${
                          isDark
                            ? 'bg-gradient-to-r from-emerald-500/20 to-sky-500/20 border-emerald-400/40 text-emerald-200 hover:from-emerald-500/30 hover:to-sky-500/30 hover:border-emerald-400/60 hover:shadow-[0_0_16px_rgba(16,185,129,0.35)]'
                            : 'bg-gradient-to-r from-emerald-500 to-sky-500 border-emerald-600 text-white hover:from-emerald-600 hover:to-sky-600 hover:shadow-lg'
                        }`
                  }
                >
                  <ExternalLink size={13} />
                  <span>{t('shell:promotionDetails.cloudCanvas.open')}</span>
                </a>

                {/* 微信号 + 一键复制 */}
                <div
                  className={`mt-3 rounded-lg p-2 ${
                    isPixel
                      ? 'border-2 border-black bg-[#FFFBF0]'
                      : isDark
                        ? 'bg-white/5 border border-white/10'
                        : 'bg-zinc-50 border border-zinc-200'
                  }`}
                >
                  <div className={`text-[10px] mb-1 ${isPixel ? '' : isDark ? 'text-white/50' : 'text-zinc-500'}`}>
                    {t('shell:promotionDetails.cloudCanvas.group')}
                  </div>
                  <div className="flex items-center gap-2">
                    <code
                      className={`flex-1 text-xs font-mono px-2 py-1 rounded ${
                        isPixel
                          ? 'bg-white border border-black'
                          : isDark
                            ? 'bg-zinc-800 text-emerald-300'
                            : 'bg-white text-emerald-700 border border-zinc-200'
                      }`}
                    >
                      Lovexy_0222
                    </code>
                    <button
                      onClick={handleCopyWx}
                      className={
                        isPixel
                          ? `px-btn px-btn--sm ${wxCopied ? 'px-btn--mint' : 'px-btn--ghost'}`
                          : `flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors border ${
                              wxCopied
                                ? isDark
                                  ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                                  : 'bg-emerald-100 border-emerald-300 text-emerald-700'
                                : isDark
                                  ? 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10'
                                  : 'bg-white border-zinc-300 text-zinc-600 hover:bg-zinc-50'
                            }`
                      }
                      title={wxCopied ? t('shell:promotionDetails.cloudCanvas.copied') : t('shell:promotionDetails.cloudCanvas.copyTitle')}
                    >
                      {wxCopied ? <Check size={11} /> : <Copy size={11} />}
                      <span>{wxCopied ? t('shell:promotionDetails.cloudCanvas.copied') : t('shell:promotionDetails.cloudCanvas.copy')}</span>
                    </button>
                  </div>
                </div>

                {/* 致谢 */}
                <div
                  className={`mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed ${
                    isPixel ? '' : isDark ? 'text-white/60' : 'text-zinc-500'
                  }`}
                >
                  <Heart
                    size={11}
                    className={`mt-0.5 shrink-0 ${
                      isPixel ? '' : isDark ? 'text-pink-400' : 'text-pink-500'
                    }`}
                  />
                  <span>
                    {t('shell:promotionDetails.cloudCanvas.thanks')}<span className="text-base">🐧</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 主题模板 */}
          <button
            onClick={() => setThemeManagerOpen(true)}
            className={
              isPixel
                ? 'px-btn px-btn--sm px-btn--pink max-w-[150px]'
                : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                    isDark
                      ? 'bg-sky-500/10 border-sky-500/30 text-sky-300 hover:bg-sky-500/20'
                      : 'bg-sky-50 border-sky-300 text-sky-700 hover:bg-sky-100'
                  }`
            }
            title={t('shell:themeTemplate')}
          >
            <Palette size={14} />
            <span className="text-[11px] truncate">{localizeThemeName(currentTemplate, uiLocale)}</span>
          </button>
          {isDragonBall && shenronUnlockedAt && (
            <div className="t8-dragonball-mode-switch" role="group" aria-label={t('shell:themeModes.dragonBallGroup')}>
              <button
                type="button"
                className={`t8-dragonball-mode-switch__option ${!shenronModeActive ? 'is-active' : ''}`}
                aria-pressed={!shenronModeActive}
                onClick={() => handleDragonBallModeSwitch(false)}
                title={t('shell:themeModes.dragonBallTitle')}
              >
                {t('shell:themeModes.dragonBall')}
              </button>
              <button
                type="button"
                className={`t8-dragonball-mode-switch__option ${shenronModeActive ? 'is-active' : ''}`}
                aria-pressed={shenronModeActive}
                onClick={() => handleDragonBallModeSwitch(true)}
                title={t('shell:themeModes.shenronTitle')}
              >
                <Sparkles size={12} />
                {t('shell:themeModes.shenron')}
              </button>
            </div>
          )}
          {isSaintSeiya && hadesUnlockedAt && (
            <div className="t8-saint-mode-switch" role="group" aria-label={t('shell:themeModes.saintGroup')}>
              <button
                type="button"
                className={`t8-saint-mode-switch__option ${!hadesModeActive ? 'is-active' : ''}`}
                aria-pressed={!hadesModeActive}
                onClick={() => handleSaintSeiyaModeSwitch(false)}
                title={t('shell:themeModes.sanctuaryTitle')}
              >
                {t('shell:themeModes.sanctuary')}
              </button>
              <button
                type="button"
                className={`t8-saint-mode-switch__option ${hadesModeActive ? 'is-active' : ''}`}
                aria-pressed={hadesModeActive}
                onClick={() => handleSaintSeiyaModeSwitch(true)}
                title={t('shell:themeModes.hadesTitle')}
              >
                <Sparkles size={12} />
                {t('shell:themeModes.hades')}
              </button>
            </div>
          )}
          <LocalTopbarSlot isPixel={isPixel} isDark={isDark} />
          <AchievementButton isPixel={isPixel} isDark={isDark} />
          <button
            onClick={() => setResourceOpen(true)}
            className={
              isPixel
                ? 'px-btn px-btn--sm px-btn--mint'
                : `flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                    isDark
                      ? 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/20'
                      : 'bg-fuchsia-50 border-fuchsia-300 text-fuchsia-700 hover:bg-fuchsia-100'
                  }`
            }
            title={t('shell:resources')}
          >
            <Library size={14} />
            <span className="text-[11px]">{t('shell:resources')}</span>
          </button>
          <AppUpdaterButton isPixel={isPixel} isDark={isDark} />
          <label
            className={
              isPixel
                ? 'px-btn px-btn--sm px-btn--ghost flex items-center gap-1'
                : `flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${isDark ? 'border-white/15 bg-white/5' : 'border-black/10 bg-black/[0.03]'}`
            }
            title={t('shell:locale.label')}
          >
            <Globe size={13} />
            <select
              className="nodrag bg-transparent text-[11px] outline-none"
              data-i18n-skip
              value={uiLocale}
              aria-label={t('shell:locale.label')}
              onChange={(event) => changeUiLocale(event.target.value as 'zh-CN' | 'en-US')}
            >
              <option value="zh-CN">{t('shell:locale.zhCN')}</option>
              <option value="en-US">{t('shell:locale.enUS')}</option>
            </select>
          </label>
          <button
            onClick={() => setSettingsOpen(true)}
            className={
              isPixel
                ? 'px-btn px-btn--icon px-btn--ghost'
                : `p-2 rounded-md ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`
            }
            title={t('shell:settings')}
          >
            <Settings size={isPixel ? 14 : 16} />
          </button>
          <button
            onClick={toggleTheme}
            className={
              isPixel
                ? 'px-btn px-btn--icon px-btn--ghost'
                : `p-2 rounded-md ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`
            }
            title={isDark ? t('shell:theme.toLight') : t('shell:theme.toDark')}
          >
            {isDark ? <Sun size={isPixel ? 14 : 16} /> : <Moon size={isPixel ? 14 : 16} />}
          </button>
        </div>
      </header>

      {/* 主体两栏布局 */}
      <div
        className={`t8-main-layout flex-1 flex overflow-hidden relative${sidebarCollapsed ? ' t8-main-layout--sidebar-collapsed' : ''}`}
        data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
      >
        {!sidebarCollapsed && <Sidebar onAddNode={handleAddNode} />}
        <button
          type="button"
          className={`t8-sidebar-toggle t8-mini-icon-button${sidebarCollapsed ? ' is-collapsed' : ''}`}
          aria-label={sidebarCollapsed ? t('shell:sidebar.show') : t('shell:sidebar.hide')}
          title={`${sidebarCollapsed ? t('shell:sidebar.show') : t('shell:sidebar.hide')} (H)`}
          aria-pressed={sidebarCollapsed}
          onClick={toggleSidebarCollapsed}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <ErrorBoundary fallbackTitle={t('shell:canvasError')}>
          <Suspense fallback={<InfiniteCanvasBootLoading />}>
            <Canvas onAddNodeRef={addNodeRef} onInsertWorkflowRef={insertWorkflowRef} themeStyleOverride={appliedThemeStyle} />
          </Suspense>
        </ErrorBoundary>
      </div>

      {/* API 设置弹窗 */}
      <Suspense fallback={null}>
        {settingsOpen && <ApiSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
        <LocalModalSlot />
        {themeManagerOpen && (
          <ThemeTemplateManager open={themeManagerOpen} onClose={() => setThemeManagerOpen(false)} />
        )}
        {resourceOpen && (
          <ResourceLibraryDrawer
            open={resourceOpen}
            onClose={() => setResourceOpen(false)}
            onInsertMaterial={handleInsertResource}
          />
        )}
      </Suspense>
      <MaterialContextMenu />
      <AchievementDrawer />
      <AchievementCeremonyLayer />
      <AchievementToast />
      <AgentControlPairingModal />
      <AgentControlApprovalModal />
    </div>
    </RHToolsProvider>
  );
}

export default App;
