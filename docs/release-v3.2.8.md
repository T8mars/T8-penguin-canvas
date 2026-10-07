# v3.2.8 启动日志保存发布

日期：2026-10-08。用户明确授权更新SKILL/features、Electron打包、推送GitHub和稳定自动更新Release；用户现场、安装升级与F8–F10证据后补，Mac仅实际额度不足可延期。Windows与同源Mac发布、最终独立六资产及两个更新清单验证全部完成。

范围仅为[启动日志](startup-diagnostics.md)。不修改数据库加载、迁移、备份、恢复或历史画布名称；不将日志采集冒称为卡顿修复。

[v3.2.7](release-v3.2.7.md)的前置能力门发现双语资源摘要漂移，尚未构建安装包。保留失败日志及原Tag；生成器仅同步7文件9行摘要，能力仍39动作、306运行时项、83节点，没有新增/删除能力。以3.2.8固定新源码继续，不移动3.2.7或重建旧版。

package/lock/README/features/工作流同步3.2.8，根SKILL保持私有忽略并更新日志合同及发布索引。`owner-approved-post-release-v3.2.8`仅允许本版缺失外部证据延期，旧/未来版本、错误授权及已有无效清单继续阻断。

正式链：精确范围提交固定源SHA → fast-forward推送main及新Tag → canonical core唯一一次 `dist:release` → provenance/sealed recovery → 草稿三资产完整回下载 → 稳定Latest → 同Tag macos-15 arm64追加 → 两平台独立完整回下载 → 追加事实，不移动Tag或重建包。

使用BelowNormal、单核、Node3GiB、零压缩和依赖支持的系统7-Zip，临时目录放E盘；保持技术门、私有前后端和运行时归档，不编辑受保护文件。Mac仍为ad-hoc未公证预览，不覆盖Windows或任何同名远端字节。

本地日志专项17/17、相邻36/36通过，本轮日志及发布五文件47/47通过，组重叠不相加。此前768MiB类型检查内存耗尽保留；既有正式Node3GiB配置的生产类型/Vite门实际通过。原生对话框与安装版未验收；仓库已查为public，本次Mac workflow实际成功，不因额度延期。

## 正式发布事实

- 正式源码与v3.2.8 peeled Tag固定为 `af3530b84ae821695c96c1bce03de432fd1dfb9f`。后续事实提交不移动Tag或重建包；v3.2.7失败Tag也保持冻结。
- Windows唯一一次构建完成：类型/Vite、能力/双语、加密、原生依赖、NSIS、9项app.asar启动合同、私有前后端、两份运行时归档及媒体检查通过。日志模块/主进程/preload包内字节与源码一致；两份保护文件长度和散列未变。
- 代理通道创建草稿两次返回500，随后官方API直连创建同来源、同所有权标记的草稿成功。沿用sealed recovery原字节上传，未重建；直连完整回下载及更新清单校验通过，恢复入口返回0并清除本版recovery。下载完成前尝试停止的保护检查未命中，未实际终止；之后额外恢复入口拒绝已发布版本，没有构建/覆盖。未启用准备的读写分流适配器，系统代理未修改。
- [稳定Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.2.8) 于 `2026-10-07T17:09:33Z` 发布，非草稿/非预发布，target固定为上述源码。
- [同Tag Mac workflow 37657034423](https://github.com/T8mars/T8-penguin-canvas/actions/runs/37657034423) 成功：源绑定、私有源恢复、合同6/6、正式构建/原生依赖、ad-hoc签名、9项app.asar启动合同及DMG/ZIP/清单检查通过，只追加三项Mac资产；runner已完整回下载验证。Mac仍未Apple公证，本轮无额度延期。
- Mac追加前后三项Windows资产的ID/名称/size/SHA-256完全一致。六资产精确名称、bytes和SHA-256集中维护 `features.json#release.assets`；v3.2.6历史资产已移入 `electronReleaseV326.assets`，没有删历史记录。
- 本机 `release:mac:verify` 与Mac追加后的 `release:verify` 均返回0：六资产完整回下载，GitHub size/SHA-256、两个更新清单的版本/size/SHA-512一致，Mac `macSource` 与正式Tag源一致，稳定Latest保持v3.2.8。两次验证仅使用现有代理的进程级环境及E盘临时目录，不改系统设置；仍不替代安装现场/原生对话框/F8–F10。

私有证据：`local-private/release-v3.2.7/windows-formal.log`、本版 `windows-formal.log`、`windows-resume.log`、`draft-api-recovery.log`（失败）、`draft-direct-recovery.log`、`windows-resume-direct.log`（成功）、`windows-recovery-final.log`（拒绝重建）及 `mac-workflow.log`；独立校验日志为 `mac-independent-verify.log`、`windows-final-verify.log`。本地暂存对象读取异常时原坏对象已隔离保留，从完全相同的工作区字节重建；索引校验和、暂存diff及公开门重验通过，没有reset/clean或丢改动。不得公开凭据、恢复nonce或用户数据。
