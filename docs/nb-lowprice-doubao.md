# 平价香蕉低价版 / 豆包音色与节点清晰度

更新：2026-10-15。已随v3.3.4完成Windows/Mac发布、六资产及两个自动更新清单独立完整回下载核验，见[发布专题](release-v3.3.4.md)；本功能不在旧v3.3.3安装包中。

## 入口与合同

四个模型全部使用“贞贞的平价AI小屋”Key。依据为当日[官方 API 文档](https://api.seedance.nz/docs/llms.txt)和只读参考项目 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance` 的 `skill.md`、NB Lowprice / Doubao Voice Clone ICL 节点与音频解码实现。共享枚举、类型、范围见 [nbLowpriceDoubaoContract.json](../backend/src/shared/nbLowpriceDoubaoContract.json)，请求前置校验见 [doubaoVoiceContract.js](../backend/src/providers/doubaoVoiceContract.js)。

| 位置 | 新模型 | 用法 |
| --- | --- | --- |
| 图像 → 平价小屋 → 香蕉2 | `zhenzhen-image-nb-pro-lowprice` | 文生图 / 参考图编辑 |
| 同上 | `zhenzhen-image-nb-2.1-lowprice` | 文生图 / 参考图编辑，额外极端比例 |
| 音频 → Seed Audio | `doubao-voice-clone` | 单音频训练，返回试听及音色 ID |
| 同上 | `doubao-seed-icl-2.0` | 使用同账号训练返回的音色 ID 朗读文本 |

旧节点、已有默认模型及端口 ID 不改；不是新增节点类型，总数仍为 83。图像走共享 image generations，音频走共享 audio generations；沿用 RunIntent → Run → Attempt、至少 15 分钟媒体超时、可信结果下载及原子落盘。受理不明不重新付费提交，恢复只 GET 原任务。

香蕉两模型：Prompt 1–5000 字符，固定 n=1，0–14 张有序参考图，重复槽不去重、超限不截断；1K/2K/4K，不传输出格式、Seed 或其他模型遗留参数。Pro 使用 auto 和标准比例；2.1 另支持 1:4、4:1、1:8、8:1。具体枚举以共享合同为准。

训练：一段清晰、已获授权的音频；转换成实际 24kHz/单声道 WAV 后不超过 10 MiB，不靠改扩展名。支持文档定义的裸 PCM 输入，按 24kHz 单声道 s16le 封装。试听文本 4–300 字符，语言须匹配样本；默认省略可选布尔值。自定义音色 ID 与上游训练 ID 是两个字段。只认返回的 `data.result_text`，绝不把请求 ID 或回显字段当训练成功；全部试听按原顺序保存，包括重复 URL。

合成：文本 1–10000 字符；左侧新增文字类型 `speaker` 音色输入，或手动填写训练结果，两者冲突会拒绝。此输入不会混入朗读文本。指定语音模型时隐藏并不提交表达指令；高级参数包含格式/采样率/速度/音量/音高、比特率、语言、过滤、水印、LaTeX、静音等。低 MP3 码率与 Markdown/LaTeX 联动按合同校验；“API 默认”不提交字段。首次合成可能含音色槽费用，不能把字符预览价当首用报价；最终计费以平台账单为准。字幕选项可以请求，但公开结果不保证字幕时间戳。

ICL 裸 PCM 输出按提交时的采样率无损加 WAV 头后落盘播放，不重采样；恢复描述符保存该格式/采样率。帧不完整、错误页或缺少音频/音色结果均不能记成功；不改其他模型下载路径。PCM s16le/单声道定义同时核对了参考客户端和[火山音频格式说明](https://docs.volcengine.com/docs/LakeAIService/ReplicaTextToSpeech?lang=zh)。

## 去掉节点模糊

此前节点滤镜只在部分缩放或拖动状态停用，松手后可恢复，导致文本重新栅格化。现对节点及后代始终关闭 backdrop-filter，对节点 UI/文字祖先关闭 filter；不再依赖缩放、选中、拖动状态。媒体自身滤镜及独立装饰伪元素不由此规则移除，不改画布缩放、主题或布局。

真实 Chromium 使用生产 CSS、主题 token 应用器及生产豆包控件，验证 14 套主题 × 浅/深色 × 6 个缩放 × 4 个交互状态，共 672 组计算样式；连续编辑、保存恢复、条件字段、中英文通过。浅深色截图已人工查看。证据：[ui-report.json](../local-private/nb-lowprice-doubao-live-20261013/ui-report.json)、[深色](../local-private/nb-lowprice-doubao-live-20261013/crisp-controls-dark.png)、[浅色](../local-private/nb-lowprice-doubao-live-20261013/crisp-controls-light.png)。这是软件渲染隔离夹具，不冒认受影响用户 GPU 或完整安装版验收。

## 九份无凭据工作流

| 模型 | 文生图 | 单图 | 14 图 |
| --- | --- | --- | --- |
| NB Pro Lowprice | [模板](workflows/zhenzhen-image-nb-pro-lowprice-t2i.json) | [模板](workflows/zhenzhen-image-nb-pro-lowprice-i2i.json) | [模板](workflows/zhenzhen-image-nb-pro-lowprice-multi-reference.json) |
| NB 2.1 Lowprice | [模板](workflows/zhenzhen-image-nb-2.1-lowprice-t2i.json) | [模板](workflows/zhenzhen-image-nb-2.1-lowprice-i2i.json) | [模板](workflows/zhenzhen-image-nb-2.1-lowprice-multi-reference.json) |

音频：[训练](workflows/doubao-voice-clone.json)、[已有音色合成](workflows/doubao-seed-icl-2.0.json)、[训练→文字音色口→合成](workflows/doubao-training-to-synthesis.json)。

导入后填写自己的平价 Key 与素材；独立合成模板的音色 ID 留空，必须填写本账号真实训练结果。音频模板使用英语样本/试听文本与 language=1；中文使用者需同时改样本、文本和语言，不只改其中一项。模板不包含凭据、真实任务/音色身份或结果 URL。可通过 `npm run workflows:nb-lowprice-doubao` 重建。

## 验证与边界

实网 **8/8** 原任务 succeeded / HTTP 200：两图像模型各有 0、1、14 张参考图，共六图完整下载、Sharp 解码及非空校验；均为 1024×1024。豆包使用安装的英语合成语音作为样本，训练返回三条试听（保留一、三重复槽），三条 WAV 均完整解码及非静音检查；同 Key / 实际返回音色 ID 的 ICL 合成 MP3 成功，24kHz 单声道、0.84 秒。证据：[report.json](../local-private/nb-lowprice-doubao-live-20261013/report.json)。没有重交这些任务。

本地回归：六套 TS 52/52；PCM 生产路由与相邻 Seed Audio 19/19；音色输出防预览文本回退、冷/热端口与相邻派生执行 31/31；四套原生后端共 86 个唯一用例完成验证，其中能力同步与 Creator 最新 59/59，其他运行权威/恢复 27 项见之前同次矩阵。各组重叠不累加。TypeScript、i18n、能力同步和工作流解析门通过；319 个运行条目、83 个节点。

早期失败保留：测试使用了错误的连接校验导出名；新模型运行身份白名单缺项；旧模型目录测试只识别内联字符串、不识别共享 JSON；能力产物未重新生成；UI 夹具返回不可克隆的翻译函数/缺 CSP/主题别名不一致。修正后限定用例通过，不把失败日志改成通过。证据在 `local-private/nb-lowprice-doubao-live-20261013/` 的 regression-final、audio-route-regression、speaker-routing-final、pcm-final、backend-creator-schema-final、backend-final、ui-final-theme 和 type-immutable-final-tree 日志。

边界：2K/4K、全部比例/语言/高级参数组合及真实 PCM 合成不是逐组合实网验收；PCM 格式/原子下载/冷恢复完成本地真实字节验证。完整模型UI端到端、安装版、受影响用户现场和 F8–F10 尚未验收；发布使用后续明确授权，不沿用历史授权。

复验入口：`npm run verify:nb-lowprice-doubao:live`（Key 隐藏 stdin / 子进程环境，原任务状态防重交）、`npm run verify:node-crisp-doubao:ui`（新建系统临时 profile，软件渲染，结束清理）。私有素材、状态和任务/音色身份不公开或打包；不要删除验证状态来触发重复计费。
