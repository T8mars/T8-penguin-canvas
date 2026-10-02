# v3.2.4 Seedream Flash 发布

日期：2026-10-02。用户明确授权更新手册与功能记录、固定源码、唯一正式 Windows Electron/NSIS 构建、推送 GitHub 新版本及稳定自动更新 Release。Mac 从同一正式 Tag 在真实 Apple Silicon runner 构建，仅确认 GitHub 额度不足时延期；仍为 ad-hoc 未公证技术预览。

当前状态：正式源码与 Tag 固定为 `ecbb4312a55c1bf386f8850c0170117a3b037012` / `v3.2.4`。Windows 唯一正式构建及[稳定 Latest 发布](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.2.4)、Mac [同源任务36971772927](https://github.com/T8mars/T8-penguin-canvas/actions/runs/36971772927)均成功，非草稿、非预发布。六资产和两个更新清单已独立完整回下载验证；本轮未因额度延期 Mac，不冒称已读取账号余额。此前 Tag、源码与资产保持冻结。

本版包含开发提交 `e0fd14381a4ced856384c446ef139f3b3d9c3917`：六个国内/海外 Seedream Flash 模型、完整有序分层、共享模型身份与可信 COS GET 恢复；保留 Pro 默认及限制。六个真实任务成功，13/13 图片下载、完整解码并查看；263/263 专项及相邻回归、类型、双语、能力同步门通过。合同、六份无凭据工作流与脱敏证据见[功能专题](seedream-v5-flash.md)，用户可见内容见[Release notes](../release-notes/v3.2.4.md)。

版本号由 package 同步至 lock、README、features、Electron 标题/日志/IPC、Vite 宏及后端注入。后补证据仅限定 `owner-approved-post-release-v3.2.4`：缺失证据可按授权延期，已有无效证据继续失败关闭；用户安装升级、旧画布及 F8–F10 不记通过。构建需保留私有前后端、两份运行时归档、包内启动/安全检查、provenance 和 sealed recovery；正式资产只追加、不覆盖，草稿资产完整回下载后才发布 Latest。

后续事实提交不得移动本版 Tag、覆盖远端同名资产或重建安装包。

发布准备检查：Windows、Mac、zcanvas 资源与版本级后补证据合同 27/27 通过；后补授权仅适用于本版且仅允许缺失证据，旧版、未来版本、错误授权及已有无效证据继续拒绝。私有前后端存在、RH 工具箱 15 项/12 分类、Music3 官方资源 1022 文件和能力同步门通过，两份 core 保护文件散列不变。正式 Windows 链沿用 BelowNormal、单核、Node 3 GiB 与零压缩；安装器的大归档使用依赖支持的 `USE_SYSTEM_7ZA` 与已安装 7-Zip 24.06，不修改源/core 运行时或依赖代码。

## Windows 正式链

一次正式 `dist:release` 完成 2990 模块生产构建、Electron 33.4.11 字节码加密、私有前后端、两份运行时归档、native rebuild、NSIS、8 项 asar 启动依赖及包内安全门。provenance 与 sealed recovery 绑定固定源码；草稿三资产完整回下载和更新清单 SHA-512 通过后发布稳定 Latest，最终元数据检查通过并清除本版 recovery。包内 `seedreamNzContract.json` 与源码逐字节一致，SHA-256 为 `8c6da622b892b0d66c2c24fe2576b410861179d2db92984ad4cf0c735e5e7129`。

| Windows 资产 | 字节 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.2.4.exe` | 1,375,893,465 | `3ce16de65ecbd37330567b9203446c506eba66f52d93481cb8cf965751dcfd6a` |
| `T8-PenguinCanvas-Setup-3.2.4.exe.blockmap` | 1,435,101 | `252b3b8e5cb67b5acda466ba475b656abf4658a9f7486c46073437fa4ae373ee` |
| `latest.yml` | 362 | `4d0dccb5413384e2b5b593a81b1a62ee453bdf5dccff10286c9809baaded4c6a` |

## Mac 同源链与最终验证

真实 macos-15 arm64 runner 从同一正式 Tag 完成私有源恢复、原生依赖、生产构建、加密、ad-hoc 签名、8 项 asar 启动依赖、媒体工具及 DMG/ZIP/更新清单检查。三资产追加到同一 Release 后 runner 完整回下载通过，任务于 `2026-10-02T06:11:03Z`（北京时间14:11:03）完成。Mac 未使用 Apple Developer ID、未公证，仍为技术预览；清单可验证不代表已覆盖实际 Mac 安装或自动更新。

| Mac 资产 | 字节 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-3.2.4-mac-arm64.dmg` | 514,498,907 | `9226aef6c7bb06bec2e26edea1a5f1d6059428d9677c15fb29dee0b338ff1c11` |
| `T8-PenguinCanvas-3.2.4-mac-arm64.zip` | 506,479,823 | `b53a499ef42765415ae3c1345b35e25bedd1bbd3a1c7aa301e8c5081fa0e370e` |
| `latest-mac.yml` | 536 | `70f4b7e760a3375a72f5985ae8bb1326fc0dc74c2ed7c0ea283e37b7884fa0e9` |

本机独立再次完整下载 Mac 三资产，核对 GitHub size/SHA-256 和 ZIP size/SHA-512；追加后的 Windows 三资产也再次完整下载，与正式本地产物及追加前散列一致，`latest.yml` 的安装包 size/SHA-512 通过。Release target、Tag peeled commit、两端源码与 Latest 一致，两份 core 保护文件字节及散列未变。临时验证下载由验证器清理，仅保留忽略的脱敏日志：[Windows正式链](../local-private/release-v3.2.4/windows-formal.log)、[Mac独立验证](../local-private/release-v3.2.4/mac-independent-verify.log)、[Windows最终验证](../local-private/release-v3.2.4/windows-final-verify.log)。安装升级、旧画布、真实设备及 F8–F10 仍按本版授权后补，不记为通过。
