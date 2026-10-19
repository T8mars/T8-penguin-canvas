# v3.3.6 画布保存稳定性发布

2026-10-19，用户明确授权更新根手册、features、Electron打包、推送GitHub及自动更新Release；外部证据后补，Mac仅GitHub额度不足可延期。版本3.3.5→3.3.6，已完成同源双平台正式发布。

## 固定范围与发布门

- 包含[画布保存修复](canvas-save-conflict-20261019.md)与两次20主题独立复查；运行、媒体、默认来源、数据库schema与Strata服务不变。仅修有实证的问题，保留真实冲突选择及CAS/ACK保护。
- 最终源码215/215限定回归、类型/双语/能力门通过，完整开发App/Canvas/真实HTTP与新临时SQLite 25项通过；低负载runner退出0、强制0、残留0。源码与原始红绿证据见功能专题，不重复累加旧测试。
- 本次缺失外部证据仅对精确版本 `owner-approved-post-release-v3.3.6` 延期；损坏、过期或不匹配仍拒绝，27/32及F8–F10不变。
- Windows在固定源码、远端main及正式Tag之后只执行一次完整正式链，保留加密私有侧车、运行时、native rebuild、NSIS、asar、provenance、sealed recovery及完整回下载门；发布后事实提交不移Tag或重建。
- Mac同Tag、真实macos-15 arm64、ad-hoc未公证预览。额度查询返回404/缺scope不证明额度不足，需正常尝试工作流；不跳过Mac构建而冒认完成。

## 当前状态与证据

固定源码、annotated `v3.3.6` 的peeled commit与Release target均为 `dadb10e6521dfbca7d888ceec3dbd7d5de7284a2`。[正式Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.6)于北京时间2026-10-19 22:01:16发布，非草稿、非预发布、为Latest；后续只补记事实，不移动Tag或重建。

- Windows唯一一次正式链退出0：单核BelowNormal、3GiB有限堆、零压缩、独立临时目录与系统7-Zip。TypeScript/Vite（3028模块）、加密私有侧车、运行时归档、native rebuild、NSIS、9文件asar启动合同、provenance、sealed recovery均通过。草稿三资产完整回下载后才发布，恢复记录已正常清理。
- 实际win-unpacked加密包内探针通过：移动及逆操作、受保护坐标拒绝、84节点和前端保存恢复文案/旧模型保留；全新系统临时库保存、备份、正常关闭重开通过（event-loop ticks=53），0网络请求，不触及用户/历史库，不代表安装现场。
- 真实macos-15 arm64 [workflow 39265271861](https://github.com/T8mars/T8-penguin-canvas/actions/runs/39265271861)成功，同Tag完成构建/加密、Mach-O/媒体/ad-hoc签名检查、DMG/ZIP/清单、追加上传与runner完整回下载。未因额度延期，仍未Apple公证。
- 本机独立完整下载Windows三资产和Mac三资产均通过；两个更新清单的size/SHA-512与实际字节一致。Mac追加后Windows原始本地字节与远端metadata再核对，ID/size/SHA-256未变；旧v3.3.5的六资产与Tag也未变。
- GitHub服务端未启用immutable Release，实际为发布器禁止覆盖，不能宣称服务端强制不可变。Actions Node运行时迁移及arm64排队提示未导致失败，未改动无关CI依赖。

## 六资产

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.3.6.exe` | 1379752207 | `457abe01ba1ca57fbcde1687b50fee014bbdc2ed8606ca3aa94773989e2b5a4a` |
| `T8-PenguinCanvas-Setup-3.3.6.exe.blockmap` | 1439772 | `0f4a6d588fa15f82b226568117bce29b4564c4ae2c550afa043e167fdfa0847b` |
| `latest.yml` | 362 | `1fa186fbeaf4dff49758a5ea6cd17b5ced8b0b2a656ede4fa3d418c6cbe0ef4f` |
| `T8-PenguinCanvas-3.3.6-mac-arm64.dmg` | 519419164 | `63eb8f0cb68a11713ee660a75cd385ad20e902bfbb395aa8219f1fdca619059c` |
| `T8-PenguinCanvas-3.3.6-mac-arm64.zip` | 511247660 | `06a8181fef1356ccd96d2e280a8824839d9458e2b17154feb5d9b485656336c0` |
| `latest-mac.yml` | 536 | `86dec0bc0f944068d92e4c11cb4226519a9fdc5a2066fbc607d0b71fccf6fde8` |

## 验证索引与未覆盖

正式证据保存在ignored `local-private/release-v3.3.6/`：[Windows正式链](../local-private/release-v3.3.6/windows-formal.log)、[包内探针](../local-private/release-v3.3.6/packaged-probe.log)、[合同26/26](../local-private/release-v3.3.6/packaging-tests.log)、[Windows独立完整下载](../local-private/release-v3.3.6/windows-independent-verify.log)、[Mac工作流](../local-private/release-v3.3.6/mac-workflow.log)、[Mac独立完整下载](../local-private/release-v3.3.6/mac-independent-verify.log)、[追加后Windows复核](../local-private/release-v3.3.6/windows-after-mac-metadata.log)、[最终资产快照](../local-private/release-v3.3.6/final-assets.json)。原始日志、私有源码及凭据不公开。

安装升级、用户现场、实体多设备及F8–F10仍未验收；既有Strata用户暂缓的上游冷启动问题仍未复查，本版未操作该服务。只读接口可达、源码或包内探针不替代真实业务和外部证据。
