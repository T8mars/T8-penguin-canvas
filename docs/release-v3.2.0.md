# v3.2.0 Qwen Image Global 2.1 / Animate Motion Transfer 发布

日期：2026-09-22。用户已明确授权版本升级、唯一一次正式 Electron/NSIS 打包、推送 GitHub 新版本与更新自动更新 Release；真实受影响用户、安装环境和 F8–F10 证据按 `owner-approved-post-release-v3.2.0` 后补，Mac 仅在 GitHub 额度不足时可延期。

## 固定范围

- 图像节点新增独立 Qwen 2.1 Tab，模型固定 `qwen-image-global-2.1`；严格使用官方 Prompt、0–10 张有序参考图、1K/2K/4K、8 种比例和可选 Seed 合同。
- 视频节点新增独立 Animate Motion Transfer Tab，模型固定 `animate-motion-transfer`；只接受 1 张角色图 + 1 个动作视频，完整保留官方动作参数且不发 Prompt、Seed 或音频。
- 新增四份无凭据工作流，并完整接入提交、轮询、运行恢复、历史与受信 Provider 结果落盘。
- 完整保留 v3.1.9 及更早节点、模型、默认值、Provider 协议、工作流和已保存画布。

## 发布前已有证据

- 新模型合同/UI/工作流 26/26，Seedance Provider/受信结果/恢复 86/86，发布证据与 Electron/自动更新/macOS/运行时合同 35/35，TypeScript、i18n、能力同步、公开目录、RH 工具箱、上下文门与 2,985 模块生产构建通过。
- Qwen T2I、Qwen I2I、Animate 真实 Provider 任务均到达 `succeeded`；Animate 产物完整下载为 219,482 bytes、H.264、480×848、2 秒。Qwen 两次结果下载在终态后遇到本机 Node TLS 断开，没有重发付费提交。
- API Key 只通过隐藏标准输入/进程环境使用，源码、工作流和脱敏报告不保存凭据、任务身份、签名 URL 或原始 Provider 响应。

## 待正式链回填

本节只在固定源码、Windows 唯一正式包、Tag、稳定 Latest、自动更新资产和远端完整下载真实收敛后回填；不预写 commit、时间、workflow 或散列。
