# 平价小屋 Topaz 视频高清修复

更新：2026-10-11。已随 v3.3.2 双平台发布；一次真实 API 生成与结果完整解码、六资产和两个更新清单完整回下载通过，详见[发布专题](release-v3.3.2.md)。

## 入口与合同

视频节点 → 贞贞的平价AI小屋 → 独立 **Topaz** Tab，模型精确为 `Topaz-Upscale-LowPirce`（保留官方拼写和大小写）。与已有 Vosr2/其他超分同属视频修复用途，但参数和协议不同，因此不混用其选项。既有默认模型、来源、节点类型、端口及本地 Topaz 节点不变。

依据为[官方 llms.txt](https://api.seedance.nz/docs/llms.txt)的 Topaz 章节与只读参考项目 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance` 的 `skill.md`、`nodes.py::TopazVideoUpscale`、`tests/test_topaz.py`。用户给出的[模型页](https://api2.seedance.nz/pricing/Topaz-Upscale-LowPirce)本轮网页读取失败，没有据此猜测额外字段。前后端共享 [topazVideoContract.json](../backend/src/shared/topazVideoContract.json)。

使用平价小屋 Key 设置 `zhenzhenSd2ApiKey`，不混用工坊 Key。上游提交 `POST /v1/video/generations`，原任务查询 `GET /v1/video/generations/{id}`：

```json
{
  "model": "Topaz-Upscale-LowPirce",
  "metadata": {
    "video_url": ["<public MP4 URL>"],
    "resolution": "1080p",
    "quality": "Max"
  }
}
```

- `resolution`：`720p / 1080p / 2K / 4K`，默认 `1080p`。大小写严格保留；是总像素预算，保持源视频宽高比，不承诺固定输出高度。
- 界面“修复模型”：`Ultra / Max / High / Medium / Low`，默认 `Max`，映射 `metadata.quality`，不是顶层 `model`。
- 恰好一个 MP4 来源：连接/拖入/本地素材与公开 HTTP(S) 直链二选一；多来源及重复槽拒绝，不静默取第一个。
- 本地 MP4 经共享上传器上传，校验 MIME、`ftyp` 与 50 MiB 上限；公开直链直接交给 Provider，不先下载重传，也不套用本地上传大小限制。直链拒绝畸形 URL、内嵌凭据、字面量内网及本地域名；本应用没有为直链发起下载。普通非受信 URL 下载的严格安全规则不变。
- 不发送 Prompt、比例、时长、Seed、图片、音频或 `metadata.content`。没有添加未经官方确认的时长/源分辨率限制。

## 运行、保存及恢复

复用现有 Run/Attempt/Provider submission、提交幂等标识和取消信号；媒体请求使用共享至少 15 分钟超时，节点轮询沿用 60 分钟窗口。受理不明不自动重放生成 POST；`topaz` 恢复描述符固定查询原任务。

结果同时支持 `result_url`、嵌套 `data.content.video_urls` 和兼容字段；完整列表保留顺序与重复槽。结果经共享可信 Provider 下载、格式验证、原子落盘和完成记录后才进入节点；下载失败保留原任务，不重新生成，后续查询复用已完成文件。历史参数只增加显式 `topazQuality`，保留当前参考；视频直链不是可直接填回的标量参数。完整历史输入草稿尚未为 Topaz 开放，不能冒认为支持。

Creator 执行器已分发到精确 Topaz 适配器及原任务查询；通用 LLM 动作参数仍为原有 ratio/duration/resolution 范围，未扩展为修复模型编辑器，缺省使用 `Max`。本轮没有声称完成 Creator 端到端实网。

## 两份可导入工作流

- [本地 MP4 → Topaz → 输出](workflows/topaz-video-local.json)：`720p / Low`，与真实测试规格一致；导入后上传自己的 MP4。
- [公开直链 → Topaz → 输出](workflows/topaz-video-url.json)：`1080p / Max`；导入后填写自己的公开 MP4 直链。

两份均通过生产工作流解析器、RunIntent 模型来源权威和凭据预检，不含 Key、真实任务身份、输入/结果 URL 或测试素材。重新生成：`npm run workflows:topaz`。

## 实际验证及边界

2026-10-11（北京时间），使用用户本轮提供的 Key，经生产提交/查询适配器、Electron 系统网络可信下载和共享落盘实现完成一次真实任务。不是模拟响应，也没有将参考项目的测试冒认为本项目证据。

| 项目 | 实测结果 |
| --- | --- |
| 输入 | 本地 MP4，320×240，24 fps，1 秒 |
| 请求 | `720p / Low`；仅一次生成 POST |
| 终态 | `succeeded`，上游 HTTP 200，76 次原任务查询 |
| 产物 | H.264，1112×832，1 秒，535,359 字节；共享格式判定保存为 `.mov` |
| 完整性 | ffprobe 解析、视频流完整 FFmpeg 解码和 SHA-256 记录通过 |
| 查询至完整解码 | 781,558 ms（约 13 分钟）；不是承诺固定生成耗时 |

`720p` 是请求档位，不能把它写成实际输出高 720 像素。输出以真实格式保存，不强行改后缀。

- 前端/协议及相邻回归 **157/157**：含 20 个分辨率×修复模型白名单组合、默认/非法参数、MP4/大小边界、直链不上传、受理不明不重交、全结果/恢复、两份工作流、历史参考保护和真实生产 React 处理器事件回归。
- 独立 Electron Node 后端：Topaz 路由、RunIntent、重启恢复与 Creator 共 **42/42** 通过；能力清单同步后单独复验 **10/10** 通过。中途三项能力摘要漂移失败已保留日志，生成清单后复验闭合，未将失败日志改写成全绿。
- TypeScript、双语键、能力清单同步通过；313 个运行条目、83 个节点，未新增节点类型。
- 私有证据：[真实报告](../local-private/topaz-live-20261011/report.json)、[157项回归](../local-private/topaz-live-20261011/regression-tests.log)、[后端本轮记录](../local-private/topaz-live-20261011/backend-tests.log)、[能力10项复验](../local-private/topaz-live-20261011/capability-tests.log)。真实任务身份及产物留本地忽略目录，不公开。

边界：只有 `720p / Low` 本地输入完成本轮付费实网；直链与其余参数组合为协议/路由回归，未逐一付费生成。没有完成浏览器端到端、浅/深色/像素/窄屏目视、安装版、用户现场或 F8–F10 验收，不记通过，也不构成修复效果评测。

复验：`npm run verify:topaz:live`，隐藏 stdin 输入凭据后仅进入子进程环境 `SEEDANCE_NZ_API_KEY`。默认复用本轮私有任务状态，已有身份只查询，受理不明拒绝重交。明确需要新一轮付费测试时才设置新且唯一的 `T8_TOPAZ_VERIFY_RUN`；不得把 Key 放入命令行、源码或工作流。
