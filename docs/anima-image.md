# Anima v1 文生图

在图像节点选择「贞贞的平价 AI 小屋 → Anima」。API 模型 ID 为 `Anima-v1-t2i`，保留大写 A。每次根据提示词生成一张图。比例可选 1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9，默认 1:1。界面只提供比例，参考图需要移除后再运行。[官方 API 文档](https://api.seedance.nz/docs/llms.txt)

请求走现有 `POST /v1/image/generations` 与原任务 `GET /v1/image/generations/{id}`，发送 `model`、`prompt` 和 `metadata.ratio`。ComfyUI 参考目录未找到 Anima 的独立实现，接入沿用已有文生图的异步提交、查询和落盘链路。

[导入示例工作流](workflows/anima-v1-t2i.json)。示例包含图像节点和输出节点，比例设为 3:2。导入后用自己的平价小屋 API Key 运行。

## 验证记录

2026-11-27 使用真实接口核对模型目录，生产适配器提交一次，原任务查询成功并经共用结果下载器落盘。PNG 为 1760×1184、500,753 字节，完整解码通过。私有摘要位于 `local-private/anima-20261127/live-report.json`。工作流只保存节点、参数和连线。

本地专项测试覆盖工作流导入、两种语言的比例控件、历史参数和原任务恢复。扩展回归保留三条既有失败。隔离 Electron 的完整画布测试未进入生成阶段，调整测试端口后触发了资源预检。
