# v3.2.3 RH 参数与本地化启动反馈发布

日期：2026-10-01。正式源码与 Tag 固定为 `1d5fc6774bfaa1e332d36be92eec9826e0e2cadc` / `v3.2.3`。Windows 唯一正式构建及 [Latest 发布](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.2.3)、Mac [同源任务36759071469](https://github.com/T8mars/T8-penguin-canvas/actions/runs/36759071469) 均成功，非草稿、非预发布。六资产齐全，本机独立 Mac 三资产与追加后的 Windows 三资产完整回下载通过，两个更新清单一致；本轮未因额度延期 Mac，不冒称已读取账号余额。

本版包含修复提交 `276a2c61edec464589ff3aa5dfb495aa8f74b335`，范围、81/81 回归、现场复验与未定位原因见[Issue 专题](github-issues-20261001.md)；用户可见说明见[Release notes](../release-notes/v3.2.3.md)。先固定正式源码和 `v3.2.3`，再走一次低资源 Windows 发布链，同一 Tag 构建 Mac。

外部证据按 `owner-approved-post-release-v3.2.3` 后补，不记通过；无效既存证据仍失败关闭。Windows/macOS 安装升级、RH 受影响应用实网、#31 具体输入变更来源及 F8–F10 均未完成。Mac 仍为 ad-hoc 未公证技术预览。

事实提交不得移动已发布 Tag 或重建安装包。Windows 正式链以 BelowNormal、单核、Node 3 GiB 和零压缩完成前端生产构建、Electron 字节码加密、运行时归档、native rebuild、NSIS、包内启动/安全/私有扩展门、provenance 和 sealed recovery。草稿三资产完整回下载、GitHub size/SHA-256 与清单 SHA-512 通过，正式 Latest 再核验后清除本版 recovery；源/core 两份保护文件散列不变。

发布前补充检查：锁定 Electron / TypeScript loader、BelowNormal、1.5 GiB 堆、串行运行 Windows/Mac 包合同及证据后补门，26/26 通过。版本来自 package 的 Electron 标题/日志/IPC、Vite 宏与 backend 注入合同不变；文档预算、公开边界、RH工具箱和能力清单检查通过。私有发布源配置仅核对存在，不公开值。

| Windows 资产 | 字节 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.2.3.exe` | 1,375,888,268 | `241f8abdd0b7a50e164fff2bb4903f875d5a93d4d7bd0dd176e638249a078fd9` |
| `T8-PenguinCanvas-Setup-3.2.3.exe.blockmap` | 1,434,646 | `46a63e625526ece42029f99019b53f75d09b2a0a9a1a7250476eb9e95484be7a` |
| `latest.yml` | 362 | `02790e86e7d384aa8c4e90d2f1168f5f7cb93c210c3d947f3920f914c0897abf` |

Mac 真实 macos-15 arm64 runner 完成同源原生构建、ad-hoc 签名、8 项 asar 启动依赖、媒体工具样例与 DMG/ZIP/更新清单检查；追加资产后 runner 完整回下载通过，workflow 于 `2026-09-30T18:39:36Z` 完成。本机独立下载三资产，验证 GitHub size/SHA-256 及 ZIP size/SHA-512；Windows 三资产再次完整下载通过、散列与追加前相同。Release target、Tag、两端源码及 Latest 一致。Mac 未使用 Apple Developer ID、未公证，不冒称 Apple 已认证包。

| Mac 资产 | 字节 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-3.2.3-mac-arm64.dmg` | 514,517,714 | `0f2275fcda71fb968859312c9053edb64bee4527e8619c585cef40c34f00b25b` |
| `T8-PenguinCanvas-3.2.3-mac-arm64.zip` | 506,474,079 | `4478343ce05259de887e4ec6bbda8ba2c088a33988709ac12c32010a174d4d11` |
| `latest-mac.yml` | 536 | `fd1d9fc82af8ccd397e05c4f6c470db776da8cff90158396e326f2ab34ace4d0` |

CI 有第三方 action Node 20 弃用、自动切换 Node 24 及 runner 容量提示，本次任务实际成功；未通过改动已冻结源码或重构建掩盖这些提示。
