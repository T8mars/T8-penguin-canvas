# 平价小屋：香蕉 2.1、Flux 图像与 Vidu Q4

更新：2026-10-10。已随 v3.3.1 双平台发布，六资产及两个自动更新清单完整回下载通过；固定源码与资产见[发布专题](release-v3.3.1.md)。

## 范围与依据

全部使用“贞贞的平价AI小屋”来源、`zhenzhenSd2ApiKey`，不混用 AI 工坊的模型身份或 Key。

- 图像节点既有“香蕉2”Tab：追加 `zhenzhen-image-nb-2.1`，旧默认仍为 `zhenzhen-image-nb-2`。
- 图像节点新增“Flux”Tab：`flux-3-image`，仅平价小屋可选。
- 视频节点既有“Vidu”Tab：追加海外与国内的四个 Q4 模型，原 Q3 默认及协议不变。
- 不改节点类型、ID、端口、旧节点来源及旧工作流；来源选择不批量修改现有节点。

双重合同为[官方 llms.txt](https://api.seedance.nz/docs/llms.txt)及只读参考项目 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance` 的 `skill.md`、对应实现。前后端共用 [nb21FluxViduQ4Contract.json](../backend/src/shared/nb21FluxViduQ4Contract.json)，不按模型名称猜参数。

## 参数合同

### 香蕉 2.1

`POST /v1/image/generations`、`GET /v1/image/generations/{id}`。

- Prompt 5–5000 字符；无图为文生图，有图为编辑，最多 14 个有序图片槽，保留重复引用。
- 单次 `n=1`；`metadata.resolution` 为 `1k/2k/4k`，不提供旧香蕉2的 0.5K。
- `size` 为 `auto/1:1/2:3/3:2/3:4/4:3/4:5/5:4/9:16/16:9/21:9`。
- 不发送 `output_format` 或 Seed，不沿用旧模型的极端比例。

### Flux 图像

与香蕉使用同一图像任务端点，参数为独立白名单：

- Prompt 必填；0–10 张有序参考图；单次 `n=1`。
- 顶层 `resolution`：`768sq/1k/1.5k/2k/4k`，默认 `1k`。
- 顶层 `aspect_ratio`：`auto/16:9/1:1/1:2/21:9/2:1/2:3/3:2/3:4/4:3/4:5/5:4/5:7/7:5/9:16/9:21`，默认 `auto`。
- 顶层 `grounding` 默认 `true`、`safety_tolerance` 为整数 0–4、默认 2；前端提供独立控件，保留 `false` 与 `0`。
- 不发送其他图像模型遗留的格式、Seed、质量等参数。

### Vidu Q4

四个模型是 `vidu-q4-preview-global-i2v`、`vidu-q4-preview-global-r2v`、`vidu-q4-preview-i2v`、`vidu-q4-preview-r2v`。

Q4 使用 `POST /v1/video/generations`、`GET /v1/video/generations/{id}`；Q3 保留 `/v1/videos`，不得混用。

- `seconds` 为字符串形式的整数 3–16，默认 5。
- `metadata.resolution`：`540p/720p/1080p/2k/4k`，默认 `720p`。
- `metadata.generate_audio=true`、`metadata.is_rec=true`、`metadata.watermark=false` 为默认值，均可显式关闭/开启。
- I2V：恰好 1 张图片，Prompt 可选；不发送比例和参考音频。界面显示“原图比例（无需设置）”。
- R2V：Prompt 必填、1–15 张有序图片；比例 `16:9/9:16/1:1/4:3/3:4`；可选最多 3 段音频。
- R2V 参考音频经共享 FFmpeg 队列真正编码为 MP3，再以 `audio/mpeg` 上传，URL 写入 `metadata.audio_urls`，不只是更改文件后缀。单文件上限 50 MiB；图片沿用 Vidu 的格式与 30 MiB 上限。
- 视频参考不支持；Seed 不发送。数量/标量校验在上传前完成，不静默截断超限引用。

## 八份可导入工作流

在画布导入对应 JSON，选择平价小屋并保存 Key。带上传节点的模板需要填入自己的素材；R2V 不使用音频时删除或断开可选音频上传节点。

| 路径 | 工作流 |
| --- | --- |
| 香蕉 2.1 文生图 | [banana21-t2i.json](workflows/banana21-t2i.json) |
| 香蕉 2.1 图生图 | [banana21-i2i.json](workflows/banana21-i2i.json) |
| Flux 文生图 | [flux3-t2i.json](workflows/flux3-t2i.json) |
| Flux 图生图 | [flux3-i2i.json](workflows/flux3-i2i.json) |
| Vidu Q4 海外图生视频 | [vidu-q4-preview-global-i2v.json](workflows/vidu-q4-preview-global-i2v.json) |
| Vidu Q4 海外参考生视频 | [vidu-q4-preview-global-r2v.json](workflows/vidu-q4-preview-global-r2v.json) |
| Vidu Q4 国内图生视频 | [vidu-q4-preview-i2v.json](workflows/vidu-q4-preview-i2v.json) |
| Vidu Q4 国内参考生视频 | [vidu-q4-preview-r2v.json](workflows/vidu-q4-preview-r2v.json) |

全部经过生产工作流解析器与 RunIntent 权威模型/来源校验，不含 Key、真实任务身份、签名 URL、测试素材或实网结果地址。重新生成模板使用 `npm run workflows:nb21-flux-viduq4`。

## 运行与恢复

节点继续使用共享 Run/Attempt、提交幂等标识和原任务恢复链；媒体全链路复用至少 15 分钟的共享超时。完成结果经共享可信 Provider 下载器、格式验证与原子落盘，不复制逐模型下载实现。

Q4 恢复描述符保留精确模型，通过只读状态路由的 `model` 参数选定原协议；清空进程内任务缓存后仍能查询原任务。下载失败只重试原结果 GET，不重复生成。前端预检只检查平价小屋 Key，不接受工坊 Key 代替。历史标量选项保留显式值，未归档的旧值不套用新默认。

## 本轮验证

使用用户本轮提供的 Key，2026-10-10（北京时间）完成八次真实生成；每条仅提交一次，全部终态 `succeeded`、上游 HTTP 200。四图、四视频全部使用生产可信下载与落盘实现，图片完整解码、视频完整视频流解码并核对 ffprobe；两个 R2V 均从本地 WAV 经生产上传器转 MP3 测试。

| 路径 | 实测请求规格 | 实际解码产物 |
| --- | --- | --- |
| 香蕉 T2I / I2I | 1K / 1:1 | 各 1 张 JPEG，1024×1024 |
| Flux T2I / I2I | 768sq / 1:1 | 各 1 张 PNG，768×768 |
| 四条 Vidu Q4 | 3 秒 / 540p；R2V 含 1 段音频 | 各 1 个 H.264/AAC 视频，720×720、约 3.042 秒 |

Vidu 的 540p 请求本轮实际返回 720×720，记录的是解码结果，不把请求档位当作实际像素。以上不等于所有尺寸、时长的逐组合实网验收，也不构成模型效果评测。

- 159/159 模型/路由/工作流/历史/来源预检/恢复/真实前端处理器专项及相邻回归通过。
- 49/49 独立 Electron Node 后端测试通过：RunIntent 权威、重启恢复、Creator 执行器和能力清单；仅新建系统临时库，未读取用户历史库。两组单独记录，不混作真实客户端现场证据。
- TypeScript、双语键、能力清单同步、上下文预算与差异门通过。能力清单为 312 个运行条目，节点仍为 83 个。
- 私有证据：[实网报告](../local-private/nb21-flux-viduq4-live-20261010/report.json)、[159项回归日志](../local-private/nb21-flux-viduq4-live-20261010/regression-tests.log)。凭据、任务身份和产物仅留本地忽略目录，不发布。

实网复验命令：`npm run verify:nb21-flux-viduq4:live`。凭据可通过隐藏 stdin 输入，启动器仅传给子进程环境 `SEEDANCE_NZ_API_KEY`；不得放入命令行参数、源码或工作流。默认复用本轮证据目录，已验证项不再次付费；原任务身份存在时仅查询，受理不明时拒绝再次提交。只有明确需要新一轮付费测试时才设置新且唯一的 `T8_NB21_FLUX_VIDU_VERIFY_RUN` 目录名。

边界：未完成浏览器端到端、安装升级、用户真实环境及 F8–F10 验收；按本次发布授权后补，不记通过。没有用模拟结果替代实网成功。
