# v3.3.5 Strata 本地 LLM 发布

2026-10-19，用户明确授权更新根手册、features、Electron打包、推送GitHub及自动更新Release；外部证据后补，Mac仅GitHub额度不足可延期。版本3.3.4→3.3.5，已完成同源双平台正式发布。

## 范围与发布前事实

- 仅包含[Strata接入](strata-llm.md)及两轮独立20轮审查累计8项修复；沿用现有节点、Run和持久化，不增加数据库schema，不修改Strata或全局默认来源。
- 最新源码315/315限定回归、TypeScript、能力清单、i18n、public、diff与上下文预算门通过。最新完整开发App/Canvas/后端/临时SQLite隔离验收16项通过，Run/NodeRun/Attempt成功、停止、失败一致；runner/child退出0，强制0、残留0。重叠旧测试不累加。
- 发布合同27/27通过。首轮26/27失败是测试仍将本次新版本列为拒绝项，已同步精确授权版本，并保留旧版/未来版/错误授权拒绝断言；没有放宽损坏证据门。正式构建此前未开始。
- 前轮真实模型文字/多轮/JSON/视觉/取消及画布13项证据保留；本轮冷启动上游503/WinError5未通过，不能冒称已修。用户明确其他人在使用，暂不操作该服务，不重启或卸载模型。
- 外部证据仅对精确版本`owner-approved-post-release-v3.3.5`允许缺失清单延期；过期/损坏/不匹配仍拒绝，27/32及F8–F10不变。
- 固定源码推送及正式Tag之后只运行一次Windows正式链：保留私有侧车、加密、运行时、原生依赖、NSIS、asar、provenance、sealed recovery和完整回下载门。后续事实补记不移Tag、不重建。
- Mac同正式Tag、真实macos-15 arm64、ad-hoc未公证预览。额度API404/缺scope不能当作不足，正常尝试工作流；结果后补。

## 发布完成

- 固定源码、annotated `v3.3.5` 的peeled commit与Release target均为`ff02c6e6f9b47d16b94a01fa10833ec9b1b25e53`。后续只补记发布事实，不移动Tag、不重建。
- [正式Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.5)于北京时间2026-10-19 01:44:50发布，非草稿、非预发布、为Latest。
- Windows唯一一次正式链exit0：单核BelowNormal、3GiB有限堆、零压缩、独立临时目录、系统7-Zip；全量TypeScript/Vite（3023模块）、加密后端/私有侧车、运行时、native rebuild、NSIS、9文件asar合同、provenance和sealed recovery均通过。草稿三资产完整回下载后才发布，最终恢复记录已正常清理。
- 实际win-unpacked加密包内探针通过：Strata/共享deadline模块可加载、地址/认证门、84节点及旧模型前端保留，新建系统临时数据库保存/备份/正常关闭重开通过（event-loop ticks=58），0网络请求；不触及用户/历史库，不代表安装现场。
- 真实macos-15 arm64 [workflow 39151023820](https://github.com/T8mars/T8-penguin-canvas/actions/runs/39151023820)成功，同正式Tag完成原生依赖、合同、构建/加密、Mach-O/媒体/ad-hoc签名检查、DMG/ZIP/清单、追加上传与runner完整回下载；本机随后独立完整下载Mac三资产并核对ZIP size/SHA-512。未因额度延期，仍未Apple公证。
- Windows发布后也独立完整下载三资产通过；Mac追加后本地原始字节与远端metadata再次一致。六资产、两个更新清单、Tag、target、Latest一致；Windows追加前后ID/size/digest未变，旧v3.3.4的六资产和Tag也未变。
- GitHub服务端未启用immutable Release，实际是发布器禁止覆盖；不能宣称服务端强制不可变。Actions Node运行时迁移与arm64排队提示未导致失败，不顺带升级无关CI依赖。

## 六资产

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.3.5.exe` | 1379748894 | `c733cbb43fa4c2d1b7e1e124d051b5ead4eac95d8b6af156215ec49d65354eec` |
| `T8-PenguinCanvas-Setup-3.3.5.exe.blockmap` | 1439891 | `ac6a2456afca143850af88781ec5725504a87da47ed37e0f49b98c6de75651fa` |
| `latest.yml` | 362 | `0dd4fe0d79783ad07ff376e679716a39a53e68db5ea74b3e207b279b0148ec74` |
| `T8-PenguinCanvas-3.3.5-mac-arm64.dmg` | 519395473 | `7f6552297ed803a5c184ff94c0a299aa01e40e22d6fdd139db576ca035253cb9` |
| `T8-PenguinCanvas-3.3.5-mac-arm64.zip` | 511243589 | `cc0638067c9ff2a4e0f0e8b6d8b93ec637f8ed646248d4845efcdc3a05783b5d` |
| `latest-mac.yml` | 536 | `eb1fa03fd5a5e55c70be330b7ca4b1fbac4d91dc039a1f08b0c007866e493c0d` |

## 证据与未覆盖

本地`local-private/strata-llm-audit-20261019-round2/`保留独立R01–R20审查、失败冷启动及最新`canvas-fixture/canvas-ui.json`；同次低负载回执`35a9755ab72745da86fee928a7bfdc8f.json`已核对正常退出、强制0、残留0，峰值Job约1.49GiB。正式证据集中在ignored `local-private/release-v3.3.5/`：[Windows正式链](../local-private/release-v3.3.5/windows-formal.log)、[包内探针](../local-private/release-v3.3.5/packaged-probe.log)、[合同27/27](../local-private/release-v3.3.5/packaging-tests-final.log)、[Windows独立完整下载](../local-private/release-v3.3.5/windows-independent-verify.log)、[Mac工作流](../local-private/release-v3.3.5/mac-workflow.log)、[Mac独立完整下载](../local-private/release-v3.3.5/mac-independent-verify.log)、[追加后Windows复核](../local-private/release-v3.3.5/windows-after-mac-metadata.log)、[最终资产快照](../local-private/release-v3.3.5/final-assets.json)。原始日志/私有源码/密钥不公开。

Strata冷启动、LAN、其他GPU、逐个消费者长任务、安装升级、用户现场及F8–F10未验收。Creator、原生视频/ASR、Strata引擎管理和在线世界生成不在本版范围。
