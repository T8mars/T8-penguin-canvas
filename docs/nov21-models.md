# Kling 长图、Gemini TTS、H3 Token、HeyGen 与 Miora

2026-11-22：在原有节点中新增十个平价小屋模型。开发与工作流已完成；八个模型已有实网成功结果，HeyGen 两档原任务仍在上游处理中，不能认定真实出片通过。已随 v3.5.5 发布，详见[发布专题](release-v3.5.5.md)。

## 入口与合同

依据本轮重新下载的[官方 API 文档](https://api.seedance.nz/docs/llms.txt)，并只读核对 `ComfyUI_Seedance/core/nov21_models.py`、`core/h3_token.py` 及其测试。参考项目未修改。

| 原节点 / 分类 | 新增模型 | 关键输入 |
| --- | --- | --- |
| 图像 / Kling Image | `kling-v4-long-image` | 电商 1–3 张商品图；网页可无图，或按风格→主体排序，各一张 |
| 音频 / Gemini 2.5 TTS（新分类） | `zhenzhen/gm-2.5-pro-tts`、`zhenzhen/gm-2.5-flash-tts` | 文本 1–5000 字符，30 音色，表达指令最多 1000 字符，WAV |
| 视频 / Minimax H3 Lowprice | `minimax-h3-comfyui-max-10020-token`、`minimax-h3-comfyui-max-10021-token` | 1–6 图，可选 0–3 段音频；JY 另可选 1 个 MP4 |
| 视频 / Minimax H3 Lowprice | `minimax-h3-comfyui-charswap-token` | 1–3 图、恰好 1 个源 MP4；秒数与帧数二选一 |
| 视频 / Minimax H3 Lowprice | `minimax-h3-comfyui-digital-human-token` | 恰好 1 图、1 音频；输出时长覆盖音频 |
| 视频 / HeyGen Avatar 6（新分类） | `heygen-avatar-6-turbo`、`heygen-avatar-6` | 官方可用形象；台词+音色，或恰好 1 段音频 |
| 3D / Miora 3D（新分类） | `miora-3d` | 无图为文生；有图仅使用图片，最多 8 个有序视图 |

- 长图：`skill=ecommerce|webpage`；电商才发送 `length`。网页使用 `image_with_roles`，按 style、subject 排列；单图可选用途。宽 1k/2k，不发送常规比例、n、width/height。JPEG/PNG 单张 ≤30 MB，每边至少 300 px，比例 2:5–5:2；语言加权提示词上限与引用编号在提交前验证。
- H3 Token：沿用 `/v1/video/generations`，固定 768p，不发送 seed、提示词扩写或常规分辨率参数。图、音频分别按每文件 10 MiB 校验；MP4 ≤50 MiB。角色替换可选 22–362 帧、步长 17；数字人不支持帧数模式。
- HeyGen：1080p/2k，五种比例；形象、音色名称取官方当前可用列表，不猜造型 ID。有音频时不发送台词与音色；不发送 seconds、seed 或图片。复用上传器，验证 MP3/WAV/M4A；不把 ADTS AAC 误当 MP3。
- Miora：顶层 `generate_type=normal|geometry`、`face_count=3000..1500000`，纹理模式可选 PBR。图片最多 8 张，依次 front/left/right/back/top/bottom/front-left/front-right，单张 ≤10 MB。保留 GLB/OBJ 主模型及全部 ZIP、MTL、贴图；附属 MTL 按文本资产登记，避免当作可渲染网格。

旧模型、节点类型、已有渠道和默认值保留。使用共享 schema、Creator/CLI 目录、RunIntent/Run/Attempt、原任务恢复和可信 Provider 下载；媒体超时继续使用全局最低 15 分钟策略。完整目录为 408 项，节点仍为 85 个。

## 工作流

保存 14 份可导入片段，均不含密钥、真实任务身份或结果地址。上传节点由使用者提供自己的素材。

- [长图电商](workflows/kling-v4-long-image-ecommerce.json)、[长图网页](workflows/kling-v4-long-image-webpage.json)。
- [Gemini Pro](workflows/zhenzhen-gm-2.5-pro-tts.json)、[Gemini Flash](workflows/zhenzhen-gm-2.5-flash-tts.json)。
- [H3 WF](workflows/minimax-h3-comfyui-max-10020-token.json)、[H3 JY](workflows/minimax-h3-comfyui-max-10021-token.json)、[H3 角色替换](workflows/minimax-h3-comfyui-charswap-token.json)、[H3 数字人](workflows/minimax-h3-comfyui-digital-human-token.json)。
- [HeyGen Turbo 文本](workflows/heygen-avatar-6-turbo-text.json)、[Turbo 音频](workflows/heygen-avatar-6-turbo-audio.json)、[标准文本](workflows/heygen-avatar-6-text.json)、[标准音频](workflows/heygen-avatar-6-audio.json)。
- [Miora 文生](workflows/miora-3d-text.json)、[Miora 图生](workflows/miora-3d-image.json)。

生成入口：`scripts/generate-nov21-workflows.cjs`。导入测试验证每份工作流的真实模型、端口连接和所需平价小屋凭据。

## 实网验证

密钥仅经隐藏 stdin 进入测试进程环境，不写入源码、工作流或日志。先检查同账号；本轮新提交先估算，并使用已有 submit-once 受理日志。受理过的任务仅 GET，不重复创建。

| 路径 | 本轮验证 | 结果 |
| --- | --- | --- |
| 长图电商 / 网页 | 复用参考项目已受理任务，经本项目生产查询器下载并完整解码 | PNG 1024×4663 / 1024×5376 |
| Gemini Pro / Flash | 原任务生产查询、下载、完整解码与非静音验证 | 24 kHz 单声道 WAV，约 2.65 / 2.09 秒 |
| H3 WF / JY | 原任务生产查询、下载、完整视频解码 | 各约 5.17 秒 |
| H3 角色替换 / 数字人 | 查询之前尚未完成的原任务；本次均已成功，下载并完整解码 | 约 0.92 / 3.04 秒；角色替换原测试使用短帧模式 |
| Miora 图生白模 | 原任务生产查询、共享 3D 下载器与 GLB 结构检查 | 36,772 bytes，自包含 GLB，有网格 |
| Miora 文生纹理 | 同上，逐个保存和验证全部文件 | GLB 25,328,948；ZIP 18,672,397；MTL 88；PNG 10,862,012 bytes |
| 本项目新 Gemini Flash 提交 | 生产 builder → POST → GET → 下载 → 完整解码 | 24 kHz 单声道非静音 WAV，约 3.01 秒 |
| 本项目新长图网页提交 | 生产 builder → POST → GET → 下载 → 完整解码 | PNG 1024×5376 |
| HeyGen Turbo / 标准音频驱动 | 只查参考项目已受理原任务 | HTTP 200、仍 IN_PROGRESS，无成片；未重交 |

合计 14 条验证路径：12 条已完成（覆盖 8 个模型），2 条仍待上游返回。两条本项目新提交已通过，不将参考项目的 POST 当作本项目发出的 POST。HeyGen 完整画布夹具通过也不代表实网出片通过。

私有证据：`local-private/nov21-models-20261122/live-report.json`、`*.verified.json`、`live-exit.json`。模型与输出摘要不含敏感地址；原任务身份仅留在本机私有受理记录。原参考项目另一个文生白模失败案例未重交，未计入成功。

## 本地验证与边界

- `tests/nov21Models.test.cjs`：模式排斥、必填素材、完整枚举/边界、禁止不支持参数、上传前完整验证、3D 附件、身份一致性、GET 恢复及错误传播。
- `tests/nov21Ui.test.ts`：执行生产控件处理器，覆盖事件清空后值保持、14 工作流真实导入与权威身份、凭据体检、历史复用、有序重复素材、双语与主题。
- 相邻原生回归 54 项、前端回归 19 项，以及新增目录合同检查通过；旧 Nov19/加密工厂验证也通过。type-check、双语、feature-sync、公开边界、工作树及 diff 门通过。证据见私有目录的 `adjacent-native2.log`、`adjacent-ui2.log`、`catalog-test2.log`、`typecheck-final.log`。
- `scripts/verify-nov21-canvas.cjs`：真实 Electron App/Canvas、新建 TEMP SQLite、生产路由/账本/上传/原任务轮询/下载落盘，只有外部 Provider 边界为确定性夹具。14 次真实节点操作、14 次 POST、14 次 GET、20 个下载通过；Miora 四文件均保留，保存重载和旧 Mai/Qwen 配置保持。
- 完整 App 成功回执：`artifacts/history-low-load-runner/1d10d97ba925476f944ac1df5d60ea31.json`；报告与截图在私有专题目录。资源限制未提高：CPU 10%、Job 4 GiB、Node/Electron 768 MiB、Go 512 MiB、BelowNormal。成功测试库正常关闭后清理，强制终止及残留均为 0。
- 首次预检发现 G 盘不足 10 GiB，改用空间充足的 E 盘；补齐浏览器依赖路径后测试。夹具首轮漏导入 CASES 的失败报告和临时环境保留，修正后完整通过。发现并补齐 Gemini/HeyGen 凭据体检，以及长图在生成目录中误落入 Seedream 的分类；未修改用户库。
- 相邻回归发现新增查询辅助函数与既有超分辅助函数重名，已分离命名；54/19 回归与带源码散列的实网 GET/下载复验通过。修订后完整 App 复验被 CPU=50% 资源门拒绝，已申请负载降低后再验一次，未自动重试。上面的完整 App 记录对应修正前已完成的 14 条路径，不冒认为本次复验。
- 未实测全部音色、最大图数/体积、全部形象、2K 长图/HeyGen 和所有 H3 比例/时长组合；未执行安装版、用户设备、F8–F10 外部验收。3D 本轮验证文件与结构，未新增预览器实现。
- HeyGen 两条原任务仅继续查询；真实成片前保持未验收。开发阶段未进行发布操作。
