# v3.3.8 自动更新退出可靠性发布

2026-10-21，用户明确授权更新手册、features、Electron打包、GitHub源码/Tag及自动更新Release；证据后补，Mac仅GitHub额度不足可延期。版本3.3.7→3.3.8，已完成同源双平台正式发布。

## 范围与固定边界

- 仅纳入[自动更新退出修复](auto-update-close-hold-20261021.md)：实际关闭回执与有界等待分离、延迟完成自动续装、批准请求绑定阶段、可见只读故障面板和脱敏关闭日志。原CAS/保存/任务保护及安装器不强杀不变。
- 源码专项/相邻115/115，含真实Electron、TEMP SQLite、真实更新器→无产品载荷测试NSIS→旧进程退出与重开验证。该测试不是正式安装升级或受影响现场证据。
- 仅本版使用`owner-approved-post-release-v3.3.8`后补外部证据；损坏/过期/不匹配证据仍拒绝。27/32及F8–F10、Strata暂缓边界不变，不读取用户或历史数据库。
- 固定源码、推送main与annotated正式Tag后，Windows执行唯一一次正式链：私有前后端、加密、native rebuild、运行时、NSIS、asar、provenance、sealed recovery、草稿完整回下载后发布。
- Mac从相同Tag在真实macos-15 arm64构建ad-hoc未公证预览；额度API不可用不等于不足。完成后独立完整回下载六资产并核对更新清单、旧版Tag/资产和Mac追加期间Windows资产不变。

## 当前状态

固定源码、annotated `v3.3.8` peeled commit和Release target均为`feceae4e2da8d785519a3d64edfd23f9a49abcf7`。[正式Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.8)于北京时间2026-10-21 02:39:14发布为非草稿、非预发布Latest。后续仅提交发布事实，不移动Tag或重建产物。

- Windows唯一正式链退出0：单核BelowNormal、3GiB有限堆、零压缩、系统7-Zip；3028模块TypeScript/Vite、后端与私有侧车加密、运行时、native rebuild、NSIS、9文件asar合同、provenance及sealed recovery通过。草稿三资产完整回下载通过后才公开发布，恢复记录已正常清理。
- 实际win-unpacked加密包探针通过：包内主进程/阶段IPC合同、生产后台全部关闭阶段、真实存储关闭回执；全新系统TEMP库保存/备份/关闭重开通过，231次event-loop tick，网络请求0。原生路由、导入限额、operationId、兼容资源路径、Patch/84节点和旧模型保留检查也通过。PORT=0的临时探针不产生有效实例注册；不触及用户/历史库，不等同安装现场。
- 本轮22项Electron/Mac打包合同、4项证据门通过，与原115项部分重叠，不累计。双语5133键、能力39/319/84、公开/凭据预检、受保护文件和上下文预算门通过。
- 同Tag真实macos-15 arm64 [workflow 39476687213](https://github.com/T8mars/T8-penguin-canvas/actions/runs/39476687213)首次执行成功，唯一正式Mac构建、加密、Mach-O/媒体/ad-hoc签名检查、DMG/ZIP/清单、上传及runner完整回下载通过。未因额度延期；仍未Apple公证。Actions运行时与arm64排队提示未导致失败，未顺带修改CI依赖。
- 本机独立Windows三资产及Mac三资产完整回下载通过，实际字节与GitHub size/SHA-256、两个更新清单的size/SHA-512一致。Mac追加后Windows原始本地字节和远端ID/size/SHA-256未变；旧v3.3.7 Tag及六资产也未变。
- GitHub服务器未启用immutable Release；实际为发布器禁止覆盖，不能声称服务器强制不可变。正式构建前新增本地Git对象曾校验异常，已保留损坏副本、按完整工作文件重建同一对象ID并通过`git fsck`；没有回滚源码，不据此判断物理磁盘健康。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.3.8.exe` | 1379767853 | `7aca0f72827a1a6475f6b849fe8e43aa33d9d4d7d50d347c06d0003893af218e` |
| `T8-PenguinCanvas-Setup-3.3.8.exe.blockmap` | 1439453 | `f024363249e27f94d171bc71f008e34fd11da83c0ef62dd59aa5803468eb9ce1` |
| `latest.yml` | 362 | `340613a96035038bd730a117d153852757fc6c415bdacb559d5bb0a2a2b73608` |
| `T8-PenguinCanvas-3.3.8-mac-arm64.dmg` | 519514182 | `80923ca14efaf4a71bebc45999ebd4d63615800b5401ef47d4c3b74515fa177e` |
| `T8-PenguinCanvas-3.3.8-mac-arm64.zip` | 511263611 | `288dd3381c2f84068777383b582962709fc4c8be6d16b8a327d9142bc3ff986b` |
| `latest-mac.yml` | 536 | `e75de232893b63e32f176b990c7c851cfa3f3a0545e0d17d7740a2e58b7e85f4` |

## 验证索引

本机ignored证据：`local-private/release-v3.3.8/`下的[正式Windows链](../local-private/release-v3.3.8/windows-formal.log)、[加密包探针](../local-private/release-v3.3.8/packaged-probe.log)、[22项打包合同](../local-private/release-v3.3.8/packaging-tests.log)、[4项证据门](../local-private/release-v3.3.8/release-gate-tests.log)、[Windows独立下载](../local-private/release-v3.3.8/windows-independent-verify.log)、[Mac workflow](../local-private/release-v3.3.8/mac-workflow.log)、[Mac独立下载](../local-private/release-v3.3.8/mac-independent-verify.log)、[追加后Windows复核](../local-private/release-v3.3.8/windows-after-mac-metadata.log)、[六资产快照](../local-private/release-v3.3.8/final-assets.json)及[最终审计](../local-private/release-v3.3.8/final-audit.json)。原115项的边界与证据见[修复专题](auto-update-close-hold-20261021.md)。原始日志、私有配置与根手册不公开或打包。

## 交付提醒

修复只有运行本版后才生效；旧版若已卡住，应正常退出后手动运行本版完整安装包，不删除用户数据。不能声称所有磁盘、权限、卸载器或用户后台任务故障已根治。
