# 右键菜单截断与 Agnes 视频 2.5 适配

2026-10-24，开发修复，未打包/推送/发布；package 仍为 3.4.2。

## 已确认原因与修复

- 快速添加菜单原先把全部节点放在 `overflow-hidden` 容器，且按固定 360px 定位，没有可滚动区域。节点增加后在短窗口被截断。
- 抽出生产 `CanvasQuickAddMenu`：固定标题、独立原生滚动列表；按可见画布与视口交集限高/定位，保留边距；ResizeObserver 处理窗口/内容变化，滚轮不冒泡至画布，支持方向键/Home/End/Escape。末项仍按原右键位置添加，不改变新增默认值逻辑。
- Agnes 视频旧适配固定发送 `width/height/num_frames/frame_rate`；官方 2.5 不接受这套字段。用户明确要求移除退役 2.0、换成 2.5。旧默认与旧节点选择仅在 Agnes 视频边界兼容至 `agnes-video-2.5`，不改其他来源、LLM 或图像模型。
- 当前模型 `agnes-video-2.5` / `agnes-video-2.5-flash` 共用前后端 JSON 合同；请求只发 `model/prompt/seconds/mode/size/aspect_ratio` 及对应模式媒体/可选 Seed。时长 4–12 秒；Flash 仅 720P。移除帧数/帧率旧控件，增加自动/文生/首尾帧/参考模式。
- 按官方要求校验公网媒体 URL、素材数量和模式组合，保留有序重复素材，超限不截断；2.5 不支持旧版 Base64 本地图片路径，明确提示先上传公开存储。本轮未新增 Agnes 私有上传协议。
- HTTP 错误展开 `detail/error/message`；仅公开终态完成时接收视频 URL，忽略 pending/internal_status，始终用原 `video_id + model_name` 查询，不重放付费 POST。继续复用媒体最低 15 分钟策略与可信结果下载器。
- 标准 2.5 按量收费；Flash 当前限时推广。设置与节点提示已区分，不再把全部视频宣称免费。

## 协议来源

- [2.5 官方文档](https://wiki.agnes-ai.com/en/docs/agnes-video-25.md)
- [Flash 官方文档](https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash.md)
- [2.0 退役页](https://agnes-ai.com/en/docs/agnes-video-v20)

官网反代的 Markdown/index 当次不可达，使用该站 HTML 声明的官方 Mintlify 源站 `agnestech.mintlify.app` 读取完整同路径文档。旧官方 GitHub 目录仍列 2.0，未据此猜测新协议。

## 验证与边界

- `tests/agnesVideo25.test.ts`、既有 Agnes/扩展 Provider/菜单回归：47 项通过；含双模型比例/分辨率/时长矩阵、旧选择兼容、禁发旧字段、有序重复参考、超限/私有 URL 提交前拒绝、完整400错误、pending URL拒收，以及随机独立端口的真实 HTTP POST→原任务 GET。
- 设置/生成 HTTP 路由与超时护栏：8 项通过；仅使用新建 TEMP 设置目录，不读取历史数据库。
- 最终 type-check、i18n、能力产物同步、public/context/worktree 与 diff 门通过；受保护运行时散列不变，无暂存或合并冲突。
- `scripts/verify-quick-add-agnes-ui.cjs --launch`：生产组件/注册表/Tailwind/主题，隔离软件 Chromium；3 主题×2 模式×2 语言×3 窗口×2 落点共72组通过，实际滚轮、末项键盘定位和点击、窗口变小、Escape关闭及4次真实 Agnes 模式编辑通过。截图与报告：`local-private/quick-add-agnes-20261024/`。
- UI 验证器使用 offscreen renderer，避免隐藏窗口停止绘制、无焦点原生输入与异步窗口尺寸 IPC 造成夹具假失败；不操作用户窗口。
- 用户当次提供的 Agnes Key 只经隐藏 stdin→子进程内存传递，未写入源码、设置、日志或报告。
- `scripts/verify-agnes25-live.cjs --launch` 对两模型各提交一次 `4秒/720P/16:9/text`；均返回 HTTP503“视频队列已满”，无 `video_id`。原始失败回执及受理不明保护保留在同目录 `live/`，**没有自动重交，也没有成功出片、下载、解码证据**。复跑不会重新提交这两条；需明确新测试授权及新场景后再验。
- 上述隔离组件/HTTP 夹具不等于完整安装版画布或真实用户环境验收；没有把上游队列满记为成功。
