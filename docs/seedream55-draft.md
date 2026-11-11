# Seedream 5.5 与 Seedance 2.5 草稿转高清

2026-11-11：完成开发、八个新模型实网验证及限定完整画布验证；已获v3.5.1发布授权，进度见[发布专题](release-v3.5.1.md)。原有模型、默认渠道、Pro 默认及旧节点参数保持兼容。旧 Flash 合同见 [Seedream Flash](seedream-v5-flash.md)。

## 来源与入口

核对 [官方 llms.txt](https://api.seedance.nz/docs/llms.txt) 当日快照和只读参考 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance` 的 `core/seedream55.py`、`Seedance25DraftToVideo` 及相关测试；参考项目未修改。全部使用**贞贞的平价AI小屋**渠道和已有独立 API Key 设置。

| 入口 | 新增模型 |
| --- | --- |
| 视频节点 → 原 Seedance 2.5 Tab | `seedance-2.5-standard-draft-to-video`、`seedance-2.5-global-standard-draft-to-video` |
| 图像节点 → 原 Seedream Tab → 平价小屋 → 5.5 系列 | `seedream-v5.5-t2i`、`seedream-v5.5-i2i`、`dola-seedream-5.5-t2i`、`dola-seedream-5.5-i2i` |
| 图像节点 → 原 Seedream分层 Tab | `seedream-v5.5-layer-decomposition`、`dola-seedream-5.5-layer-decomposition` |

Seedream 保持原先按连接参考图数量切换 T2I/I2I 的用法；新增国内/海外 5.5 系列，原 Pro / Flash 顺序和默认值保留。视频仅扩展用户要求的既有 Tab，旧独立 Seedance 2.5 节点的六模型目录不改。共享合同位于 `backend/src/shared/seedream55DraftContract.json` / `.mjs`，系列身份继续使用 `seedreamNzContract.json`；同步 schema、RunIntent 身份、运行目录和中英文界面。

## Seedream 5.5

- 生成/编辑提示词 5–5000 个 Unicode 码点；T2I 无参考图，I2I 1–10 图，每张 PNG/JPEG/WebP ≤30 MiB。整批素材先校验，再上传；RGBA 参考图保留透明通道。
- 普通图分辨率 1k / 1.5k / 2k，或成对自定义宽高；每边 240–11520，面积 921600–8294400 像素，宽高比 1:16–16:1。自定义模式不同时发送 resolution，未改变旧 Pro / Flash 尺寸规则。
- 输出 PNG/JPEG；背景 auto / transparent / opaque，透明背景必须 PNG。支持 watermark 布尔和最多64字符的 safety_identifier，不混入 n、seed、视频参数。
- 分层恰好一张源图，可选提示词 ≤2000 字符；分辨率 auto / 1k / 1.5k / 2k；max_images 为 2–100，默认30，含底图；text_recognition 布尔。分层不发送普通图的 background 或自定义宽高。
- 完整保留 `content.image_urls` 的顺序和重复槽，不只取首张。可选 `layers` 元数据必须与 URL 列表逐项对应，转存后替换成对应本地 URL；保留名称、文字、层级、尺寸、边框等已知字段。不同尺寸/透明度的底图与图层分别落盘，下载不齐继续恢复原结果，不重新生成。
- 界面支持保存原图及逐层保存，沿用原文件下载函数；不经缩略图重编码。参数随画布及既有历史输入上下文保存；不宣称扩大原先历史“一键填回”的适用范围。

## 草稿转高清

原 Seedance 2.5 视频模型可勾选“生成480P草稿”，只在主动开启后发送 `metadata.draft=true` 并使用480p。旧节点未设置此项仍按原协议生成。完成后记录草稿 ID 与源模型区域。

选择同区域 `draft-to-video` 模型，连接已完成草稿节点，或输入草稿任务 ID；也可在同一节点切换为高清模型，读取刚完成的草稿 ID。只接受同账号、同区域、7天内的已完成草稿；普通480P视频 URL、其他任务 ID 不会被自动当作草稿。多来源/手填冲突、区域不一致或额外本地素材会在提交前提示。中继与输出素材保留原草稿身份，并在断连/多任务歧义时清空，避免静默选错。

高清请求严格为 `model + metadata.draft_task_id/output_format/return_last_frame`，不发送 prompt、素材 URL、时长、比例、分辨率、音频或种子；成片继承原草稿内容。默认MP4，可选MOV/尾帧；上游若返回尾帧 URL，沿用受信下载和原子物化，界面可保存并纳入运行输出。两地MP4已实测，MOV和尾帧的客户端协议/下载以离线与画布夹具验证，没有额外付费覆盖全部选项组合。

生成提交/响应/轮询/上传/回下载沿用共享媒体至少15分钟策略与 RunIntent → Run → NodeRun → Attempt；恢复只查询原任务，不自动重放受理不明的付费请求。没有另建产品内提交账本。

## 工作流与验证

[八份无凭据工作流](workflows/)的文件名为上表完整模型 ID，由 `scripts/generate-seedream55-draft-workflows.cjs` 生成。两份草稿高清模板包含“480P草稿 → 高清”连接；其余按模式包含图片上传输入。没有密钥、真实任务 ID、签名地址或实网产物。

实网使用 T8 生产 Provider、Electron Chromium 系统网络和生产可信下载/原子物化函数。密钥仅在进程环境；任务/结果原始记录仅在忽略的 `local-private/seedream55-draft-20261111/`。所有返回图片均完整解码，视频完整解码所有视频帧。

| 路径 | 实测结果 |
| --- | --- |
| 国内/海外 T2I | 各1张 PNG，1248×832，带透明通道 |
| 国内/海外 I2I | 各1张 JPEG，1248×832，不透明背景 |
| 国内分层 | 2张：1254×836底图 + 同尺寸透明图层；两项元数据与结果顺序对应 |
| 海外分层 | 2张：1254×836底图 + 1135×924透明图层；两项元数据与结果顺序对应 |
| 国内草稿/高清 | 新建草稿854×480，高清1920×1080；完整MP4下载与解码 |
| 海外高清 | 使用用户提供的已完成海外草稿，只读确认后生成1920×1080，完整MP4下载与解码 |

海外新建草稿及首次海外高清请求曾返回HTTP403且没有任务ID，记录保留，未自动重发。用户补足余额并明确要求继续后，只对海外高清做了一次显式新尝试并成功；没有为了复测重跑已通过的六个图像模型或国内视频。不把403泛称为模型不可用，也不把其他草稿的失败外推为全部草稿不支持。

证据：`live-report.json`（8个新模型成功，另有1条国内草稿源）、`layer-metadata-probes.json`（只读复核两站原分层）、`alpha-audit.json`（两站透明图/图层均有0–255透明度像素）、`canvas-ui.json`、各专项与相邻回归日志。完整 App 用系统 TEMP 新库，Provider HTTP 边界采用确定性数据，实际验证六个图像身份、重复图层槽/元数据、透明PNG原文件下载、480P开关、两地区ID专用提交、尾帧保存、中继/输出素材透传、刷新及中英文/明暗主题；不把这些夹具任务当作实网生成。

限定回归共170项通过：前端/相邻模型60、后端/物化/恢复/超时59、历史输入与放置51，无失败或跳过。功能同步为379 runtime entries，节点数仍为85；i18n、公开边界、JSON/上下文预算与diff检查通过。类型检查结果见同目录 `type-check.log`。

边界：未安装版验证、未额外付费验证100图层/10参考图满容量或全部参数组合；F8–F10外部证据边界保持不变。专项入口：`tests/seedream55DraftContract.test.cjs`、`tests/seedream55DraftModels.test.ts`，UI入口为低资源 runner 的 `Seedream55Canvas` 模式。首次 UI 脚本下载选择器不匹配的诊断证据保留，修正后完整场景通过；成功场景正常退出并清理临时库。
