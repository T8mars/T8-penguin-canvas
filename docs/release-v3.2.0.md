# v3.2.0 Qwen Image Global 2.1 / Animate Motion Transfer 发布

日期：2026-09-22 至 2026-09-23。v3.2.0 已从固定源码 `dfb388c2d2dbae4df3186ea268f69cca96d793ac` 完成 Windows 与 macOS 同 Tag 正式发布：[GitHub Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.2.0)。Release 非草稿、非预发布且为 Latest；Tag、Release target 与两平台源码一致且保持冻结。

## 固定范围

- 图像节点新增独立 Qwen 2.1 Tab，模型固定 `qwen-image-global-2.1`；严格使用官方 Prompt、0–10 张有序参考图、1K/2K/4K、8 种比例和可选 Seed 合同。
- 视频节点新增独立 Animate Motion Transfer Tab，模型固定 `animate-motion-transfer`；只接受 1 张角色图 + 1 个动作视频，完整保留官方动作参数且不发 Prompt、Seed 或音频。
- 新增四份无凭据工作流，并完整接入提交、轮询、运行恢复、历史与受信 Provider 结果落盘。
- 完整保留 v3.1.9 及更早节点、模型、默认值、Provider 协议、工作流和已保存画布。

## 发布前已有证据

- 新模型合同/UI/工作流 26/26，Seedance Provider/受信结果/恢复 86/86，发布证据与 Electron/自动更新/macOS/运行时合同 35/35，TypeScript、i18n、能力同步、公开目录、RH 工具箱、上下文门与 2,985 模块生产构建通过。
- Qwen T2I、Qwen I2I、Animate 真实 Provider 任务均到达 `succeeded`；Animate 产物完整下载为 219,482 bytes、H.264、480×848、2 秒。Qwen 两次结果下载在终态后遇到本机 Node TLS 断开，没有重发付费提交。
- API Key 只通过隐藏标准输入/进程环境使用，源码、工作流和脱敏报告不保存凭据、任务身份、签名 URL 或原始 Provider 响应。

## 正式发布结果

- Windows 唯一正式链完成 2,985 模块生产构建、190 个后端源码与 4 个私有文件加密、两套运行时、Electron 原生模块重建、NSIS、七文件 `app.asar` 启动合同、post-build、provenance、sealed recovery、上传与发布前完整回下载；发布成功后 recovery 已清除。
- GitHub Release 于 `2026-09-22T15:58:45Z` 发布。仓库未启用 GitHub immutable releases，因此继续由发布器的精确所有权、固定 target 和禁止覆盖门保护。
- 真实 Apple Silicon `macos-15` [workflow 35751218655](https://github.com/T8mars/T8-penguin-canvas/actions/runs/35751218655) 于 `2026-09-22T16:06:18Z` 成功结束，从同一个 `v3.2.0` Tag 完成私有源恢复、原生依赖、ad-hoc 签名、DMG/ZIP/更新清单、追加上传及 runner 完整回下载。GitHub 额度充足，未使用 Mac 延期。
- 本机独立验证再次完整下载 Mac 三资产并核对 GitHub SHA-256、ZIP size 与 `latest-mac.yml` SHA-512；随后再次完整下载 Windows 三资产，确认追加 Mac 后原 Windows 字节和散列未改变。Release 最终为六资产。

## 资产清单

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.2.0.exe` | 1,378,616,565 | `1013df706477f64563890c580437e03e9ab5f402a1c59817d13b81e59d4b74c4` |
| `T8-PenguinCanvas-Setup-3.2.0.exe.blockmap` | 1,437,932 | `d3e898c3448a2a1fde837d47bd1a76a0c345250228e59922845eefb97e8a1526` |
| `latest.yml` | 362 | `71bb02f994b613909a7d6de78f32edbb0fb59bb7f700819f0ca96a6cf11f7895` |
| `T8-PenguinCanvas-3.2.0-mac-arm64.dmg` | 514,463,422 | `0b82ebbbf3f598680fdf98f0bb80320d7b0a00e87045b61fcdb92d3e89869b81` |
| `T8-PenguinCanvas-3.2.0-mac-arm64.zip` | 506,459,843 | `64b0491834f73be14f8a5ad8ae2a73c20a5b89102fb8b3fcb9c2e5fb612df885` |
| `latest-mac.yml` | 536 | `debdf7517f310ec33ad3ba58f7c3200065052adbaf9c4d1022beb7c92d411bca` |

## 保留边界

- Mac 包仅做 ad-hoc 完整性签名，尚未使用 Apple Developer ID，也未公证，仍是明确的技术预览。
- 真实受影响用户、安装升级、外部设备和 F8–F10 证据继续按 `owner-approved-post-release-v3.2.0` 后补；延期不等于通过。
- 发布后事实提交只更新文档与功能记录，不移动 `v3.2.0` Tag，不重建或覆盖任何正式资产。
