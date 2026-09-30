# v3.2.3 RH 参数与本地化启动反馈发布

日期：2026-10-01。用户已明确授权升级、Windows 唯一正式构建、GitHub 源码/Tag、稳定 Latest 和自动更新；Mac 同源追加，仅确认 GitHub 额度不足时可延期。当前为发布准备，未声称构建或上传完成。

本版包含修复提交 `276a2c61edec464589ff3aa5dfb495aa8f74b335`，范围、81/81 回归、现场复验与未定位原因见[Issue 专题](github-issues-20261001.md)；用户可见说明见[Release notes](../release-notes/v3.2.3.md)。先固定正式源码和 `v3.2.3`，再走一次低资源 Windows 发布链，同一 Tag 构建 Mac。

外部证据按 `owner-approved-post-release-v3.2.3` 后补，不记通过；无效既存证据仍失败关闭。Windows/macOS 安装升级、RH 受影响应用实网、#31 具体输入变更来源及 F8–F10 均未完成。Mac 仍为 ad-hoc 未公证技术预览。

固定源码、工作流、资产字节/散列、完整回下载及两个更新清单结果在实际完成后追加于本专题；事实提交不得移动已发布 Tag 或重建安装包。

发布前补充检查：锁定 Electron / TypeScript loader、BelowNormal、1.5 GiB 堆、串行运行 Windows/Mac 包合同及证据后补门，26/26 通过。版本来自 package 的 Electron 标题/日志/IPC、Vite 宏与 backend 注入合同不变；文档预算、公开边界、RH工具箱和能力清单检查通过。私有发布源配置仅核对存在，不公开值。
