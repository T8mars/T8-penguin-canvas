# v3.2.6 RH 媒体与工坊香蕉2.1发布

日期：2026-10-07。用户明确授权更新 SKILL/features、Electron打包、推送GitHub新版本和稳定自动更新Release；外部证据后补，Mac仅实际额度不足可延期。Windows正式链、同源Mac发布及最终独立六资产校验均已完成。

范围与证据：[RH媒体修复](rh-media-field-validation-20261007.md)、[工坊新模型](nano-banana21-workshop.md)。两个生产改动分别为共享媒体类型优先判定及目录追加一个模型；旧枚举、默认参数、旧节点和启动逻辑保持不变。已取得限定实网证据，不冒认全部应用、安装版或用户现场通过。

package/lock/README/features/工作流同步3.2.6，主进程及Vite版本由package动态读取。根SKILL保持私有、忽略，仅更新当前发布索引。`owner-approved-post-release-v3.2.6`只允许本版缺失外部证据延期，旧/未来版本、错误授权及已有无效清单继续阻断。

正式链：精确文件提交并固定源SHA → fast-forward推送origin/main及新Tag → canonical core唯一一次 `dist:release` → provenance/sealed recovery → 草稿三资产完整回下载 → 稳定Latest → 同Tag macos-15 arm64构建与追加 → 两平台独立完整回下载 → 追加发布事实，不移动Tag或重建包。

使用BelowNormal、单核、Node3GiB、零压缩与依赖支持的系统7-Zip，保持全部技术门、私有前后端和运行时归档，不编辑受保护文件。Mac仍为ad-hoc未公证预览，不覆盖Windows资产或任何同名远端字节。

GitHub仓库已查为public，workflow使用标准macos-15；[官方规则](https://docs.github.com/en/billing/concepts/product-billing/github-actions)说明公开仓库标准runner的Actions分钟免费。当前token缺少user scope，账单API返回404，未查询到余额，不能冒称额度充足；实际workflow如果遇到额度失败才记录延期，不把权限错误当额度不足。

## 本次正式结果

- 固定正式源码与 `v3.2.6` peeled commit：`b3fde7706eb7aca96e90ce6c5a25f1a2aaab3fe0`；精确28文件提交后atomic推送main与新Tag，旧Tag未移动。后续发布事实提交不改变此Tag或重建包。
- Windows唯一一次 `npm run dist:release` 返回0：类型/Vite、能力及双语、加密、原生依赖、NSIS、8项app.asar启动合同、私有前后端、两份运行时归档、FFmpeg/FFprobe媒体检查全部通过；provenance/sealed recovery完成，草稿三资产完整回下载通过后转为稳定Latest，recovery已清除。
- [稳定Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.2.6) 于 `2026-10-07T14:14:43Z` 发布；target固定为上述源码，非草稿、非预发布。`latest.yml`的版本、安装包大小及SHA-512已复核。
- Windows包内模型目录与源码逐字节一致，SHA-256 `f1efe9793e9b9f8c6e128a9f35b25ec8f1d4be5dddba0fc7835994a5d3245b67`；前端生产bundle包含新模型ID。两份保护文件长度及散列未变。
- 本轮发布/RH专项五文件45/45通过，公开边界、上下文预算、diff及精确stage门通过。模型与RH此前限定验证见各自专题，不与本轮数量重复相加。
- [同Tag Mac workflow 37635136926](https://github.com/T8mars/T8-penguin-canvas/actions/runs/37635136926) 成功，绑定上述源码：合同6/6、原生依赖、私有源恢复、ad-hoc签名、8项app.asar启动合同、FFmpeg/FFprobe及DMG/ZIP/清单检查通过；仅追加三项Mac资产，runner完整回下载通过。Release正文保留 `macSource` 精确绑定与未公证边界，本轮未因额度延期。
- 本机 `release:mac:verify` 与Mac追加后的 `release:verify` 均返回0：六资产再次完整回下载并核对GitHub size/SHA-256，两个更新清单的产物size/SHA-512一致；Windows资产追加前后相同，Tag/target固定，Latest保持本版。初次Mac直连下载持续低速，被主动中止并清理其临时目录；保留失败记录后，仅验证进程使用已有系统代理完成重验，未改变系统设置或重建包。

六资产精确名称、bytes和SHA-256保留在 `features.json#electronReleaseV326.assets`（查询：`node scripts/read-project-context.cjs feature electronReleaseV326 assets`）；新发布推进当前release记录后，历史资产仍完整保留，不重复长散列表。

私有过程证据：`local-private/release-v3.2.6/windows-formal.log`、`mac-independent-verify.log`（慢直连中止）、`mac-independent-proxy-verify.log`与`windows-final-verify.log`；不公开凭据、恢复nonce、签名URL或用户数据。用户安装升级、反馈现场及F8–F10仍按上述授权后补，不视为通过。
