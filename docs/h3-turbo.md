# MiniMax H3 Lowprice / H3 Image / Qwen Image 2.1 Turbo

2026-11-11：三个模型开发完成，六条实网路径成功并完成原文件下载、完整解码。未升级版本、打包、推送或发布。完整 App 功能断言通过，严格退出验收受本机第三方输入法进程影响，未计作通过。

## 来源与入口

核对 [官方文档](https://api.seedance.nz/docs/llms.txt) 当日快照及只读参考 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance\core\h3_turbo.py`、`nodes.py` 的 `_H3TurboContract`；参考项目未修改。全部使用已有的**贞贞的平价AI小屋**渠道设置。

| 现有节点中的分类 | 模型 | 协议 |
| --- | --- | --- |
| 视频 → Minimax H3 Lowprice | `minimax-h3-comfyui-max` | POST/GET `/v1/video/generations[/{id}]` |
| 图像 → Minimax H3 Image | `minimax-h3-image` | POST/GET `/v1/image/generations[/{id}]` |
| 图像 → Qwen Image 2.1 Turbo | `qwen-image-2.1-turbo` | 同上 |

仅扩展既有节点分类，不创建节点类型、不替换旧 H3/Qwen 模型；保留原目录首项及旧节点的模型、渠道和参数。共享参数合同为 `backend/src/shared/h3TurboContract.json` / `.mjs`，同步前后端、schema、RunIntent 身份、恢复、能力目录及中英文。

## 参数

- **H3 视频**：必填提示词；`seconds` 为 `3`–`15` 的整数字符串，默认 `5`。分辨率 `480p`（默认）、`608p`、`768p`、`896p`、`1088p`、`1280p`、`1440p`；比例 `16:9`（默认）或 `9:16`。0–9 张 PNG/JPEG/WebP，每张 ≤10 MiB、合计 ≤50 MiB；0–3 段 MP3/WAV，合计 ≤10 MiB。音频位于 `metadata.audio_urls`。不发送旧 H3 的 Seed、驱动模式或生成音频开关，不接受视频参考。
- **H3 Image**：0 张参考图为文生图，1–16 张为编辑；每次一张结果。分辨率 `1k/2k/4k`，默认 `2k`；格式 `jpeg/png/webp`，默认 `jpeg`。比例 `1:1/2:3/3:2/3:4/4:3/9:16/16:9/21:9/1:3/3:1`。
- **Qwen Turbo**：0–4 张参考图；文生图 `1k/2k`，默认 `1k`；有参考图时另支持 `720p`。比例为上述前八项；提示词最多 **8192 UTF-8 字节**。不发送旧 Qwen 的尺寸、megapixels、数量或输出格式。
- 两个图像模型的 `metadata.seed` 允许 `0`–`2147483647`；界面 `-1` 表示不传，`0` 有效。图像和视频参数分别构建，不带入其他分类的隐藏配置。

提交前检查全部素材、数量、格式和实际字节；图像实际解码检查，音频本地解码检查，之后才开始上传。沿用共享收集、排序、运行总线、取消和终态；有序重复参考槽不去重或静默截断。媒体全链路复用至少十五分钟超时。完成结果复用受信 Provider 系统网络与原子下载器，保留 PNG/WebP 等原文件；图像节点提供“保存原文件”。恢复仅 GET 原任务，不重新生成。

## 实网证据

六次提交均成功，无重交。调用生产 Provider、Electron Chromium 系统网络和生产结果下载器；文件均完整解码，不能以 HTTP 200 或非空文件代替成功。

| 场景 | 实际结果 |
| --- | --- |
| H3 Image 文生图 | PNG，1024×1024，1,031,309 bytes |
| H3 Image 双参考图编辑 | WebP，1024×1024，139,884 bytes |
| Qwen Turbo 文生图 | PNG，1088×1088，1,163,421 bytes |
| Qwen Turbo 双参考图编辑，720p | PNG，736×736，618,319 bytes |
| H3 文生视频，3 秒、480p | MP4，864×480，73 帧，299,100 bytes |
| H3 图片＋WAV 参考视频，3 秒、480p | MP4，864×480，73 帧，220,445 bytes |

私有证据：`local-private/h3-turbo-20261111/live-report.json`、`live.log`、逐次提交保护记录、下载文件与 SHA-256。密钥只在进程内使用，不写设置或测试输出。高分辨率、参考数量上限、全部比例及三个音频混合仅合同校验，未额外付费生成。

## 可导入工作流

以下六份位于 `docs/workflows/`，含上传占位、生成和输出节点；无密钥、任务身份、结果地址。导入后上传自己的素材，并在设置中填写渠道 Key。

- `minimax-h3-image-t2i.json`
- `minimax-h3-image-i2i.json`（双参考图）
- `qwen-image-2.1-turbo-t2i.json`
- `qwen-image-2.1-turbo-i2i.json`（双参考图、720p）
- `minimax-h3-comfyui-max-t2v.json`
- `minimax-h3-comfyui-max-image-audio.json`

`scripts/generate-h3-turbo-workflows.cjs` 可重生成这些示例；`scripts/verify-h3-turbo-live.cjs --launch --confirm-live` 仅从进程环境读取 `SEEDANCE_NZ_API_KEY`，先写受理保护记录、最多六次创建；受理不明拒绝重放。既有成功任务只恢复查询/下载。

## 验证边界

87 项专项与相邻回归通过；type-check、中英文、能力同步、公开边界、文档预算和差异检查通过。合同专项覆盖 UTF-8 边界、所有比例/分辨率、时长字符串、Seed 0、参考上限/顺序/重复、上传前失败、精确端点、任务身份与恢复路由。前端专项执行实际 JSX 处理器并覆盖事件清空、连续选择；工作流导入、端口及双语控件通过。相邻模型、历史、恢复与超时回归见私有 `frontend.log`、`regressions-ts.log`、`regressions-cjs.log`。

完整 App 夹具脚本 `scripts/verify-h3-turbo-canvas.cjs` 使用新 TEMP 数据库、真实节点/路由/共享账本，替换外部 HTTP，阻止付费和非夹具外网；入口为 `scripts/run-history-low-load.ps1 -Mode H3TurboCanvas`。首次预检 CPU 52%，在创建画布夹具前拒绝执行（`ui-run.log`）；用户随后明确同意低负载复验，保留原资源限额。

实画布发现并修复了两个新图像分类遗漏平价白名单的问题，并补充执行实际生产下拉表达式的回归。最终功能断言覆盖三个分类/连续切换、Seed 0、Qwen 条件 720p、六条生产路由和共享账本执行、图片/音频上传、原文件保存、刷新恢复及中英文/深浅主题，无页面错误（`canvas-ui.json`、`canvas-ui.png`、`ui-mouse-overview.log`）。六次外部 HTTP 均为夹具，不再收费。

严格资源回执 `artifacts/history-low-load-runner/b417074d209c4648a6a6a33634ef102c.json` 为 verifier 退出 0、runner 退出 1：Job 收尾发现 `SGTool`、`SogouCloud` 两个搜狗输入法辅助进程并进行了测试清理，最终残留 0。仅将键盘全览改为界面按钮后仍存在，因此不归因于快捷键或产品退出失败；未修改系统输入法、资源限额或放宽失败门，严格 UI 退出验收保持未通过。失败截图、报告和受控临时目录按规则保留。

安装版、真实用户代理/GPU、像素/窄屏矩阵未验收；本机实网及限定功能断言不能替代这些证据。
