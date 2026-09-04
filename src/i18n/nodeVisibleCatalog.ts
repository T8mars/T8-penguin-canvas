import { enUS, zhCN } from './resources';
import type { WorkbenchVisibleCatalog } from './workbenchVisibleCatalog';

type LooseRecord = Record<string, unknown>;

const RH_TOOLBOX_MAKER_DEV_ENTRIES: ReadonlyArray<readonly [string, string]> = import.meta.env?.DEV ? [
  ['RH工具箱制作器', 'RH Toolbox Builder'],
  ['维护者专用 · 开发环境可见 · 用户包不打入', 'Maintainer only · development builds only · excluded from user packages'],
  ['基础信息', 'Basic information'],
  ['工具标题', 'Tool title'],
  ['稳定 ID', 'Stable ID'],
  ['RunningHub 站点', 'RunningHub site'],
  ['大类', 'Primary category'],
  ['小类', 'Subcategory'],
  ['保存时按该小类入库', 'Saved under this subcategory'],
  ['说明', 'Description'],
  ['能力标签（换行或逗号分隔）', 'Capability tags (newline or comma separated)'],
  ['分类管理', 'Category management'],
  ['新分类名', 'New category name'],
  ['分类 ID', 'Category ID'],
  ['所属大类', 'Primary category'],
  ['+ 新建', '+ New'],
  ['保存', 'Save'],
  ['删除', 'Delete'],
  ['上游输入映射', 'Upstream input mapping'],
  ['+ 输入', '+ Input'],
  ['字段', 'Field'],
  ['用户可调参数', 'User-adjustable parameters'],
  ['+ 参数', '+ Parameter'],
  ['固定参数', 'Fixed parameters'],
  ['+ 固定', '+ Fixed'],
  ['输出声明', 'Output declarations'],
  ['+ 输出', '+ Output'],
  ['运行与显示', 'Runtime and display'],
  ['实例类型', 'Instance type'],
  ['保存后该应用默认使用所选实例', 'The saved app uses this instance by default'],
  ['默认', 'Default'],
  ['轮询 ms', 'Polling ms'],
  ['最大轮询', 'Maximum polls'],
  ['节点显示', 'Node display'],
  ['图像快捷', 'Image shortcut'],
  ['视频快捷', 'Video shortcut'],
  ['文本快捷', 'Text shortcut'],
  ['音频快捷', 'Audio shortcut'],
  ['启用工具', 'Enable tool'],
  ['读取 RH 应用字段', 'Read RH app fields'],
] : [];

const EXTRA_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ['上传图像', 'Upload images'],
  ['上传视频', 'Upload videos'],
  ['上传音频', 'Upload audio'],
  ['上传文本', 'Upload text'],
  ['图像', 'Image'],
  ['视频', 'Video'],
  ['音频', 'Audio'],
  ['文本', 'Text'],
  ['项', 'items'],
  ['→ 输出', '→ Output'],
  ['端口色', 'port color'],
  ['译', 'Translate'],
  ['导入剧本', 'Import script'],
  ['4K放大', '4K upscale'],
  ['扩图', 'Outpaint'],
  ['消除', 'Remove'],
  ['首尾', 'Frames'],
  ['抠像', 'Cutout'],
  ['极速', 'Fast'],
  ['质量', 'Quality'],
  ['极速超分', 'Fast upscale'],
  ['质量超分', 'Quality upscale'],
  ['停', 'Stop'],
  ['处理中，点击取消', 'Processing; click to cancel'],
  ['RH 工具箱处理中，点击取消', 'Processing in RH Toolbox; click to cancel'],
  ['调用 RH工具箱 高清抠图，并把结果输出为新素材节点', 'Use RH Toolbox HD Cutout and output the result as a new material node'],
  ['调用 RH工具箱 高清放大4K，并把结果输出为新素材节点', 'Use RH Toolbox 4K Upscale and output the result as a new material node'],
  ['调用 RH工具箱 扩图能力；先选择目标分辨率，再把结果输出为新素材节点', 'Use RH Toolbox Outpainting; choose a target resolution and output a new material node'],
  ['调用 RH工具箱 消除主体能力，并把结果输出为新素材节点', 'Use RH Toolbox object removal and output the result as a new material node'],
  ['获取视频首帧和尾帧，并输出为图片素材节点', 'Extract the first and last video frames as image material nodes'],
  ['调用 RH工具箱 视频抠像，并把透明背景视频输出为新素材节点', 'Use RH Toolbox video cutout and output a transparent-background video node'],
  ['调用 RH工具箱 英伟达极速超分，并把高清视频输出为新素材节点', 'Use RH Toolbox fast NVIDIA upscaling and output a new HD video node'],
  ['调用 RH工具箱 FlashVsr慢速超分，并把高清视频输出为新素材节点', 'Use RH Toolbox FlashVSR quality upscaling and output a new HD video node'],
  ['智能翻译：中英文自动互译，其他语言译为中文', 'Smart Translation: automatically translate between Chinese and English; translate other languages to Chinese'],
  ['RH工具箱', 'RH Toolbox'],
  ['维护者精选 RunningHub 工具', 'Curated RunningHub tools'],
  ['已完成', 'Completed'],
  ['搜索工具 / 能力...', 'Search tools or capabilities...'],
  ['全部', 'All'],
  ['翻译', 'Translation'],
  ['抠图', 'Cutout'],
  ['图生视频', 'Image to video'],
  ['图像编辑', 'Image editing'],
  ['文生视频', 'Text to video'],
  ['消除主体', 'Object removal'],
  ['电商', 'E-commerce'],
  ['视频去水印', 'Video watermark removal'],
  ['扩图', 'Outpainting'],
  ['视频超分', 'Video upscaling'],
  ['视频抠像', 'Video cutout'],
  ['移除主体', 'Remove object'],
  ['智能翻译', 'Smart Translation'],
  ['悬停工具查看说明，点击进入', 'Hover for details; click to open'],
  ['悬停工具查看说明，点击进入 · 共', 'Hover for details; click to open ·'],
  ['个可用工具', 'tools available'],
  ['载入制作器编辑名称和分类', 'Load into the builder to edit its name and category'],
  ['可见', 'Visible'],
  ['保存名称', 'Saved name'],
  ['输入', 'Input'],
  ['画布', 'Canvas'],
  ['个', 'items'],
  ['保存并显示', 'Save and show'],
  ['可以显示到 RH工具箱', 'Can be shown in RH Toolbox'],
  ['点击“保存并显示”后，右侧 RH工具箱会自动清空筛选并打开这个工具。', 'After selecting “Save and show”, RH Toolbox clears its filters and opens this tool automatically.'],
  ['RH 字段助手', 'RH Field Assistant'],
  ['用户参数', 'User parameters'],
  ['固定', 'Fixed'],
  ['草稿库', 'Draft library'],
  ['补输入', 'Add input'],
  ['图像抠图', 'Image cutout'],
  ['图像放大', 'Image upscale'],
  ['图像扩图', 'Image outpainting'],
  ['图像修复', 'Image restoration'],
  ['背景处理', 'Background processing'],
  ['色彩调整', 'Color adjustment'],
  ['视频编辑', 'Video editing'],
  ['视频放大', 'Video upscale'],
  ['视频插帧', 'Video frame interpolation'],
  ['视频去背景', 'Video background removal'],
  ['视频变速', 'Video speed change'],
  ['视频取图', 'Video frame extraction'],
  ['MiniMax H3 Max 文生视频；提示词必填，5-15 秒，480P/768P，使用六种固定比例。', 'MiniMax H3 Max text-to-video; prompt required, 5-15 seconds, 480P/768P, with six fixed aspect ratios.'],
  ['MiniMax H3 Max 图生视频；提示词与首帧必填，可选尾帧，5-15 秒，480P/768P。', 'MiniMax H3 Max image-to-video; prompt and first frame required, optional last frame, 5-15 seconds, 480P/768P.'],
  ['MiniMax H3 Max Turbo 文生视频；提示词必填，5-15 秒，480p/768p，使用六种固定比例。', 'MiniMax H3 Max Turbo text-to-video; prompt required, 5-15 seconds, 480p/768p, with six fixed aspect ratios.'],
  ['MiniMax H3 Max Turbo 图生视频；提示词与首帧必填，可选尾帧，5-15 秒，480p/768p。', 'MiniMax H3 Max Turbo image-to-video; prompt and first frame required, optional last frame, 5-15 seconds, 480p/768p.'],
  ['H3 Max 文生视频必须填写提示词，不发送参考素材；比例会随请求提交。', 'H3 Max text-to-video requires a prompt and sends no reference media; the selected aspect ratio is submitted.'],
  ['H3 Max 图生视频必须填写提示词并使用第 1 张首帧图，可选第 2 张尾帧图；比例跟随输入图片且不会发送。', 'H3 Max image-to-video requires a prompt and first frame, with an optional second last frame; aspect ratio follows the input frames and is not submitted.'],
  ['H3 Max Turbo 文生视频必须填写提示词，不发送参考素材；比例会随请求提交。', 'H3 Max Turbo text-to-video requires a prompt and sends no reference media; the selected aspect ratio is submitted.'],
  ['H3 Max Turbo 图生视频必须填写提示词并使用第 1 张首帧图，可选第 2 张尾帧图；比例跟随输入图片且不会发送。', 'H3 Max Turbo image-to-video requires a prompt and first frame, with an optional second last frame; aspect ratio follows the input frames and is not submitted.'],
  ['贞贞的平价AI小屋 API · 5-15 秒 · 480P / 768P', 'Zhenzhen Budget AI House API · 5-15 seconds · 480P / 768P'],
  ['贞贞的平价AI小屋 API · 5-15 秒 · 480p / 768p', 'Zhenzhen Budget AI House API · 5-15 seconds · 480p / 768p'],
  ['素材集', 'Material Set'],
  ['选择类型或收集上游素材', 'Choose a type or collect upstream materials'],
  ['拖入或选择同类型素材', 'Drop or choose materials of the same type'],
  ['导入素材集', 'Import material set'],
  ['导出素材集', 'Export material set'],
  ['暂无素材', 'No materials'],
  ['待填充', 'Waiting for output'],
  ['把结果准确放到这里', 'Place the result here precisely'],
  ['比例', 'Aspect ratio'],
  ['尺寸', 'Size'],
  ['替换到框内', 'Replace inside target'],
  ['保留版本', 'Keep versions'],
  ['Grok 分割编辑', 'Grok Segmentation Editor'],
  ['Grok Image · 专用对象工作流', 'Grok Image · dedicated object workflow'],
  ['智能分割', 'Smart segmentation'],
  ['区域编辑', 'Region editing'],
  ['源任务 ID', 'Source task ID'],
  ['包含 mask RLE（数据量更大）', 'Include mask RLE (larger payload)'],
  ['执行智能分割', 'Run smart segmentation'],
  ['ComfyUI超市', 'ComfyUI Store'],
  ['本地工作流', 'Local workflows'],
  ['ComfyUI 实例', 'ComfyUI instance'],
  ['新建', 'New'],
  ['分类', 'Category'],
  ['导入', 'Import'],
  ['导出', 'Export'],
  ['我的工作流', 'My workflows'],
  ['图像生成', 'Image generation'],
  ['视频工作流', 'Video workflows'],
  ['基础文生图样例', 'Basic text-to-image example'],
  ['用于学习字段映射和首次连通测试；运行前把 Checkpoint 改成本机已安装的模型文件名。', 'Use this to learn field mapping and test the first connection. Set Checkpoint to a model installed locally before running.'],
  ['ComfyUI应用制作工具', 'ComfyUI App Builder'],
  ['上传 API Workflow JSON，自动生成可复用应用', 'Upload an API Workflow JSON to create a reusable app'],
  ['上传 JSON', 'Upload JSON'],
  ['载入样例', 'Load example'],
  ['应用名称', 'App name'],
  ['需要 ComfyUI 开启 dev mode 后导出的 API workflow，不是普通前端 workflow。', 'Requires an API workflow exported with ComfyUI dev mode, not a regular frontend workflow.'],
  ['自动映射排除规则（可选）', 'Automatic mapping exclusion rules (optional)'],
  ['导出规则', 'Export rules'],
  ['导入规则', 'Import rules'],
  ['排除采样器参数', 'Exclude sampler parameters'],
  ['排除模型加载', 'Exclude model loaders'],
  ['排除尺寸批量', 'Exclude batch size fields'],
  ['自动识别结果', 'Auto-detected results'],
  ['保存到超市', 'Save to Store'],
  ['复制 JSON', 'Copy JSON'],
  ['导出 JSON', 'Export JSON'],
  ['火山引擎', 'Volcengine'],
  ['即梦 CLI', 'Jimeng CLI'],
  ['模型类型', 'Model type'],
  ['FlashVSR 视频超分', 'FlashVSR video upscaling'],
  ['本地 Prompt(可选)', 'Local prompt (optional)'],
  ['本地 ComfyUI', 'Local ComfyUI'],
  ['顺序', 'Order'],
  ['上移', 'Move up'],
  ['下移', 'Move down'],
  ['输出 图像', 'Output image'],
  ['输出 视频', 'Output video'],
  ['输出 音频', 'Output audio'],
  ['输出 文本', 'Output text'],
  ['重置类型', 'Reset type'],
  ['限制输出图片长边；保持原始宽高比，不裁剪。再次点击已选尺寸可恢复原图。', 'Limit the output image long edge while preserving aspect ratio without cropping. Select the active size again to restore the original.'],
  ['双击编辑（裁剪 / 宫格切分） · Ctrl+拖拽可送到其他节点', 'Double-click to edit (crop / grid split) · Ctrl-drag to send to another node'],
  ['下载素材', 'Download material'],
  ['继续添加同类型文件', 'Add more files of this type'],
  ['清空文件', 'Clear files'],
  ['放大编辑 (Alt+Enter)', 'Expand editor (Alt+Enter)'],
  ['放大编辑', 'Expand editor'],
  ['可接入文本 / 图像 / 视频 / 音频，上游同类型可收集到素材集', 'Accepts text, image, video, or audio; upstream items of the same type can be collected into this set'],
  ['请先加入素材', 'Add material first'],
  ['清空素材集', 'Clear material set'],
  ['反转当前素材顺序', 'Reverse material order'],
  ['按文件名 / 文本名排序', 'Sort by file or text name'],
  ['随机打乱顺序', 'Shuffle order'],
  ['导入 t8-material-set 素材集 JSON', 'Import a t8-material-set JSON'],
  ['导出 t8-material-set 素材集 JSON', 'Export the t8-material-set JSON'],
  ['目标框标题', 'Target title'],
  ['输入提示词，或连接文本节点...', 'Enter a prompt or connect a text node...'],
  ['文生视频必须填写提示词，不发送画布中的参考图；比例会随请求提交。', 'Text-to-video requires a prompt and does not send canvas reference images; the aspect ratio is included in the request.'],
  ['贞贞的平价AI小屋 API · 按次计费 · 6 / 10 秒 · 768p / 1080p（1080p 仅 6 秒）', 'Zhenzhen Budget AI House API · pay per request · 6 / 10 sec · 768p / 1080p (1080p supports 6 sec only)'],
  ['Wan 3.0 I2V 使用第 1 张首帧图和可选第 2 张尾帧图；提示词可选。', 'Wan 3.0 I2V uses image 1 as the first frame and optional image 2 as the last frame; the prompt is optional.'],
  ['Wan 3.0 R2V 必须填写提示词；最多 10 图、5 视频、5 音频，并可附加文件或网页 URL。', 'Wan 3.0 R2V requires a prompt; it accepts up to 10 images, 5 videos, and 5 audio files, plus an optional file or web URL.'],
  ['贞贞的平价AI小屋 · auto / 2-30 秒 · 480P / 720P / 1080P', 'Zhenzhen Budget AI House · auto / 2–30 sec · 480P / 720P / 1080P'],
  ['启用思考（仅 Global 标准版支持）', 'Enable thinking (Global standard models only)'],
  ['文件 URL（可选）', 'File URL (optional)'],
  ['网页 URL（可选）', 'Web URL (optional)'],
  ['Seed（0-2147483647）', 'Seed (0–2147483647)'],
  ['本地 Prompt（必填）', 'Local prompt (required)'],
  ['Wan 3.0 提示词不能超过 20000 字符', 'Wan 3.0 prompts cannot exceed 20,000 characters'],
  ['Wan 3.0 I2V 必须提供 1-2 张图片（首帧/可选尾帧）', 'Wan 3.0 I2V requires 1–2 images (first frame / optional last frame)'],
  ['Wan 3.0 I2V 只接受首帧与可选尾帧图片', 'Wan 3.0 I2V accepts only a first-frame image and an optional last-frame image'],
  ['Wan 3.0 R2V 最多支持 10 张图片、5 个视频和 5 个音频', 'Wan 3.0 R2V supports up to 10 images, 5 videos, and 5 audio files'],
  ['Wan 3.0 R2V 的文件 URL 与网页 URL 不能同时填写', 'Wan 3.0 R2V cannot use a file URL and a web URL at the same time'],
  ['文件 URL 必须是 http(s) 地址', 'The file URL must use HTTP(S)'],
  ['网页 URL 必须是 http(s) 地址', 'The web URL must use HTTP(S)'],
  ['上次智能翻译已完成', 'The last smart translation completed'],
  ['自动识别中英文并互译，其他语言默认翻译为中文', 'Detect Chinese and English automatically and translate between them; other languages default to Chinese'],
  ['例如 智能抠图', 'For example: Smart Cutout'],
  ['例如 image-cutout-v1', 'For example: image-cutout-v1'],
  ['例如 图像修复', 'For example: Image Restoration'],
  ['可留空自动生成', 'Leave blank to generate automatically'],
  ['优先从上游自动读取', 'Read from upstream first'],
  ['输入待增强的视频提示词（1-7000 字符）', 'Enter the video prompt to enhance (1–7000 characters)'],
  ['标签分类', 'Tag category'],
  ['标签来源', 'Tag source'],
  ['多类型输入：文本 / 图片 / 视频 / 音频', 'Multi-type input: text / image / video / audio'],
  ['多类型输出：文本 / 图片 / 视频 / 音频', 'Multi-type output: text / image / video / audio'],
  ['搜索 ComfyUI 应用', 'Search ComfyUI apps'],
  ['新建分类', 'New category'],
  ['管理分类', 'Manage categories'],
  ['导入 ComfyUI 应用备份', 'Import a ComfyUI app backup'],
  ['导出本地自定义应用和分类', 'Export local custom apps and categories'],
  ['设置应用分类', 'Set app category'],
  ['内置应用不能删除', 'Built-in apps cannot be deleted'],
  ['例如 Anima 文生图', 'For example: Anima text-to-image'],
  ['留空会按名称自动生成', 'Leave blank to generate from the name'],
  ['给自己看的简短说明', 'A short note for yourself'],
  ['粘贴 ComfyUI API Workflow JSON，例如 {"1":{"class_type":"CLIPTextEncode","inputs":{"text":""}}}', 'Paste a ComfyUI API Workflow JSON, for example {"1":{"class_type":"CLIPTextEncode","inputs":{"text":""}}}'],
  ['导出当前排除规则 JSON', 'Export the current exclusion rules JSON'],
  ['导入排除规则 JSON', 'Import exclusion rules JSON'],
  ['每行一个：seed、steps、class:KSampler、CLIPTextEncode.text、#86.batch_size', 'One per line: seed, steps, class:KSampler, CLIPTextEncode.text, #86.batch_size'],
  ['执行此节点', 'Run this node'],
  ['取消选中 (隐藏操作栏)', 'Deselect (hide action bar)'],
  ['专业剧本解析、稳定素材绑定、多轨时间线与能力感知 PromptPack 编译工作台', 'Professional script parsing, stable material binding, multitrack timeline, and capability-aware PromptPack compilation workbench'],
  ['起于上游任意节点的 文本/图像/视频/音频/3D模型 结果预览(原始宽高比 + 文本双击编辑)', 'Preview text, image, video, audio, or 3D output from any upstream node (original aspect ratio + double-click text editing)'],
  ['Phase 1 占位 · 业务逻辑将于 Phase 2/3 接入', 'Phase 1 placeholder · workflow logic will be connected in Phase 2/3'],
  ['条规则 · 已排除', 'rules · excluded'],
  ['个字段', 'fields'],
  ['支持 source/字段名/节点类名/节点编号，例如 source:cfg、field:width、class:KSampler、node:86、#86.width。', 'Supports source, field name, node class, and node number, such as source:cfg, field:width, class:KSampler, node:86, or #86.width.'],
  ['个 · 排除后', 'fields · after exclusions'],
  ['个 · 图片输入', '· image inputs'],
  ['· 视频输入', '· video inputs'],
  ['· 音频输入', '· audio inputs'],
  ['· 输出节点', '· output nodes'],
  ['1 个应用', '1 app'],
  ['(端口色', '(port color'],
];

function isRecord(value: unknown): value is LooseRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectPairs(zh: unknown, en: unknown, target: Array<readonly [string, string]>) {
  if (typeof zh === 'string' && typeof en === 'string') {
    if (zh !== en && /[\u3400-\u9fff]/.test(zh)) target.push([zh, en]);
    return;
  }
  if (!isRecord(zh) || !isRecord(en)) return;
  Object.keys(zh).forEach((key) => collectPairs(zh[key], en[key], target));
}

function defineCatalog(entries: ReadonlyArray<readonly [string, string]>): WorkbenchVisibleCatalog {
  const zh: Record<string, string> = {};
  const en: Record<string, string> = {};
  const englishByChinese: Record<string, string> = {};
  entries.forEach(([source, translated], index) => {
    const key = `v${String(index + 1).padStart(4, '0')}`;
    zh[key] = source;
    en[key] = translated;
    englishByChinese[source] = translated;
  });
  return { zh, en, englishByChinese };
}

const RESOURCE_ENTRIES: Array<readonly [string, string]> = [];
collectPairs(zhCN.nodes, enUS.nodes, RESOURCE_ENTRIES);
collectPairs(zhCN.common, enUS.common, RESOURCE_ENTRIES);

export const NODE_VISIBLE_CATALOG = defineCatalog([
  ...RESOURCE_ENTRIES,
  ...EXTRA_ENTRIES,
  ...RH_TOOLBOX_MAKER_DEV_ENTRIES,
]);

const DYNAMIC_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['文生标准', 'text standard'], ['文生 Pro', 'text Pro'], ['图生标准', 'image standard'],
  ['图生 Pro', 'image Pro'], ['Fast 图生', 'Fast image-to-video'], ['Fast Pro 图生', 'Fast Pro image-to-video'],
  ['H3 文生视频', 'H3 text-to-video'], ['H3 首尾帧图生视频', 'H3 first/last-frame video'],
  ['H3 多模态参考', 'H3 multimodal reference'], ['H3 海外文生视频', 'H3 global text-to-video'],
  ['H3 海外首尾帧', 'H3 global first/last frames'], ['H3 海外多模态', 'H3 global multimodal'],
  ['H3 Max 文生视频', 'H3 Max text-to-video'], ['H3 Max 首尾帧图生视频', 'H3 Max first/last-frame video'],
  ['H3 Max Turbo 文生视频', 'H3 Max Turbo text-to-video'], ['H3 Max Turbo 首尾帧图生视频', 'H3 Max Turbo first/last-frame video'],
  ['MiniMax H3 OW 文生视频', 'MiniMax H3 OW text-to-video'],
  ['MiniMax H3 OW 参考生视频', 'MiniMax H3 OW reference-to-video'],
  ['MiniMax H3 OW 图生视频', 'MiniMax H3 OW image-to-video'],
  ['MiniMax H3 OW Fast 首帧图生视频', 'MiniMax H3 OW Fast first-frame video'],
  ['MiniMax H3 OW Fast 参考生视频', 'MiniMax H3 OW Fast reference-to-video'],
  ['参考图音频驱动 Fast', 'reference-image audio-drive Fast'],
  ['首帧音频驱动 Fast', 'first-frame audio-drive Fast'],
  ['MiniMax H3 OW Fast 文生视频', 'MiniMax H3 OW Fast text-to-video'],
  ['首尾帧图生视频', 'first/last-frame image-to-video'],
  ['多模态参考生视频', 'multimodal reference-to-video'],
];

export function localizeNodeDynamicText(source: string) {
  let match = source.match(/^(\d+) 项$/);
  if (match) return `${match[1]} items`;
  match = source.match(/^删除素材 (\d+)$/);
  if (match) return `Remove material ${match[1]}`;
  if (/^画布 · .+/.test(source)) return source.replace(/^画布/, 'Canvas');
  match = source.match(/^图像 \((\d+)\)$/);
  if (match) return `Images (${match[1]})`;
  match = source.match(/^→ 输出 (图像|视频|音频|文本) \(端口色 (.+)\)$/);
  if (match) {
    const kind = NODE_VISIBLE_CATALOG.englishByChinese[match[1]] || match[1];
    return `→ Output ${kind} (port color ${match[2]})`;
  }
  match = source.match(/^悬停工具查看说明，点击进入 · 共 (\d+) 个可用工具$/);
  if (match) return `Hover for details; click to open · ${match[1]} tools available`;
  match = source.match(/^(全部|图像|视频|音频|3D|文本|翻译|抠图|图生视频|图像编辑|文生视频|消除主体|电商|视频去水印|扩图|视频超分|视频抠像|移除主体) (\d+)$/);
  if (match) return `${NODE_VISIBLE_CATALOG.englishByChinese[match[1]] || match[1]} ${match[2]}`;
  match = source.match(/^(\d+) 个应用 · 本地工作流$/);
  if (match) return `${match[1]} apps · local workflows`;
  match = source.match(/^(\d+) 自定义$/);
  if (match) return `${match[1]} custom`;
  match = source.match(/^(.+)（(.+)）$/);
  if (match) {
    const description = DYNAMIC_REPLACEMENTS.find(([zh]) => zh === match?.[2])?.[1];
    if (description) return `${match[1]} (${description})`;
  }
  return source;
}
