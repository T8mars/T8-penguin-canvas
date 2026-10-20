# v3.3.7 DSH 原生接入可靠性发布

2026-10-20，用户明确授权更新根手册、features、Electron打包、GitHub推送及自动更新Release；证据后补，Mac仅GitHub额度不足可延期。版本3.3.6→3.3.7，已完成同源双平台正式发布。

## 固定范围与门禁

- 纳入[DSH画布侧接管](dsh-native-integration-20261020.md)：安装资源兼容查找、有界实例发现、凭据写入并发事务、单计划单操作、原审批/意图GET恢复、素材精确摘要/导入/放置/Patch恢复、Seedance模糊付费写入不重放。修正导入限额声明及无效operationId进入审批队列两项实证问题。
- 开发态23文件193项限定回归及DSH真实路由/临时SQLite组合已通过；组合审批为模拟IPC、网关回执为夹具、Provider调用0，不代表真实窗口/付费生成通过。精确兼容与CLI摘要见接管专题，不自动修改DSH信任pin。
- 本版仅将外部证据按精确版本`owner-approved-post-release-v3.3.7`后补；损坏/过期/不匹配证据继续拒绝，27/32及F8–F10不变。保留原权限、人工批准、CAS/ACK与共享RunIntent权威链，不修改用户数据库或Strata服务。
- 源码固定、推送main及annotated正式Tag后，Windows只执行一次完整正式链，保留私有加密侧车、运行时、native rebuild、NSIS、asar、provenance、sealed recovery、草稿完整回下载门；失败保留原证据及封存产物，不移动Tag/覆盖资产。
- Mac使用同Tag、真实macos-15 arm64，ad-hoc未公证预览；额度API不可用不等于额度不足。完成后分别完整回下载两个平台资产并验证更新清单，复核旧v3.3.6 Tag/资产未变。

## 当前状态

本轮发布/打包合同22项与证据门/原生HTTP8项分别通过（后4项与既有193项重叠，不相加）；双语5126键、能力同步39/319/84、公开/密钥预检通过。私有证据目录：`local-private/release-v3.3.7/`，不公开或打包。

固定源码、annotated `v3.3.7` peeled commit与Release target为`dc4893656379c743bd67d5de2de764b7f2d163ff`。[正式Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.7)于北京时间2026-10-20 17:03:43发布为非草稿、非预发布Latest；Tag及产物不再重建或移动。

- Windows唯一正式链退出0：单核BelowNormal、3GiB有限堆、零压缩、系统7-Zip；3028模块TypeScript/Vite、后端及私有侧车加密、运行时、native rebuild、NSIS、9文件asar合同、provenance和sealed recovery通过。草稿三资产完整回下载后才发布，恢复记录已正常清理。
- 实际win-unpacked加密包探针通过：导入限额、operationId守卫、加密资源兼容查找、原生路由、Patch/84节点及旧模型文案；全新系统TEMP数据库保存/备份/关闭重开通过，43次event-loop tick，网络请求0，不触及用户/历史库，不代表安装现场。
- 同Tag的真实macos-15 arm64 [workflow 39397965921](https://github.com/T8mars/T8-penguin-canvas/actions/runs/39397965921)第二次执行成功，完成唯一正式Mac构建、加密、Mach-O/媒体/ad-hoc签名检查、DMG/ZIP/清单、追加上传与runner完整回下载；未因额度延期，仍未Apple公证。
- 本机独立Windows三资产及Mac三资产完整回下载通过，实际字节与GitHub size/SHA-256、两个更新清单的size/SHA-512一致。Mac追加后Windows原始本地字节和远端ID/size/SHA-256再核对未变，旧v3.3.6 Tag及六资产也未变。
- Mac首轮检出源码发生两次curl56接收超时/early EOF；长时间无进展后取消，确认正式构建及上传全部skipped、未生成Mac包，再对同一Tag重试。保留`mac-attempt1.log`/`mac-attempt1-state.json`，不记为额度不足或应用编译失败。
- GitHub服务端未启用immutable Release；实际是发布器禁止覆盖，不能声称服务器强制不可变。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.3.7.exe` | 1379765569 | `1c10e1906692e2e9de705f42745acd97d298a942dd135c091c84340ac9424276` |
| `T8-PenguinCanvas-Setup-3.3.7.exe.blockmap` | 1439247 | `cf9e12ae426175ed1e04af730b52868b0d6370a700f8572986a34c7ab01877da` |
| `latest.yml` | 362 | `abf8c483f04402d3381e011f227b91afee66f9f5ad0322d8bcc19c62322d9bad` |
| `T8-PenguinCanvas-3.3.7-mac-arm64.dmg` | 519556707 | `b858ea9d6b0d827497c1d9568527363defb69646d8810053ef7f0a04b6c367de` |
| `T8-PenguinCanvas-3.3.7-mac-arm64.zip` | 511261244 | `128bc8c30b193c29cbc060cf8afa31036ee2eec594298e24eb04ab825397d517` |
| `latest-mac.yml` | 536 | `3d34a6a6c98a7c56887d25f25dc1ba2df57c3402c84f010330e738c0d3bf91de` |

首次版本门测试中的“下一版拒绝”夹具仍填3.3.7，随本版授权升版同步改为旧3.3.6/未来3.3.8，不放宽断言；原红测日志保留。混合CJS/TS加载器的一次运行输出断言后未退出，已只终止该测试进程树，不能算通过；拆分原测试后两组均正常退出0，原失败日志保留，不操作其他开发服务。

## 验证索引

本机ignored证据：[Windows正式链](../local-private/release-v3.3.7/windows-formal.log)、[加密包探针](../local-private/release-v3.3.7/packaged-probe.log)、[打包合同22项](../local-private/release-v3.3.7/packaging-tests-r2.log)、[证据门/HTTP8项](../local-private/release-v3.3.7/release-gate-tests-r2.log)、[Windows独立下载](../local-private/release-v3.3.7/windows-independent-verify.log)、[Mac工作流](../local-private/release-v3.3.7/mac-workflow.log)、[Mac独立下载](../local-private/release-v3.3.7/mac-independent-verify.log)、[追加后Windows复核](../local-private/release-v3.3.7/windows-after-mac-metadata.log)、[资产快照](../local-private/release-v3.3.7/final-assets.json)、[最终审计](../local-private/release-v3.3.7/final-audit.json)。原始日志及私有配置不公开或打包。

## 验收边界

真人原生审批、实际DSH配对/网关下载、付费任务及账单、完整创作流程、安装升级、用户现场和F8–F10仍未验收。没有向用户实际画布发起配对或执行申请，不存在本轮待用户批准的真实请求。源码或包内探针不能替代这些证据。
