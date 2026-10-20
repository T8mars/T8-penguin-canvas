# v3.3.9 Agent连接工具配套发布

2026-10-21，用户明确授权更新手册、features、Electron打包、GitHub源码/Tag及自动更新Release；外部证据后补，Mac仅GitHub额度不足可延期。版本3.3.8→3.3.9。

## 范围和边界

- 纳入[桌面Agent工具配套](agent-tools-installed-cli-compat.md)：设置原生安装/修复入口、当前应用来源绑定、九字段及整包内容验证、同版本刷新、回退副本、缓存隔离和复制中变化拒绝。保留原配对/人工批准、CAS/RunIntent及v3.3.8自动更新关闭保护。
- 95项限定验证通过，含真实Windows Electron设置组件/preload/IPC和TEMP导出、真实HTTP控制面最小待配对；真人批准、完整安装升级、用户现场和F8–F10仍未验收，不读取用户/历史库。
- 仅本版使用`owner-approved-post-release-v3.3.9`后补证据；损坏/过期/版本不匹配继续拒绝。原27/32、Strata暂缓和其他外部验收边界不变。
- 固定源码、推送main及annotated正式Tag后，Windows仅执行唯一正式链：私有前后端/加密、运行时、native rebuild、NSIS、10文件asar合同、provenance、sealed recovery及草稿完整回下载后发布。
- Mac从相同Tag在真实macos-15 arm64构建ad-hoc未公证预览；不能用额度API不可用冒认不足。分别完整回下载六资产与两个更新清单，核对Mac追加期间Windows资产和旧v3.3.8 Tag/资产不变。

## 当前状态

固定源码、annotated `v3.3.9` peeled commit和Release target均为`cfc5d1329f2950432ed3176e32a21f6687f914ac`。[正式Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.9)于北京时间2026-10-21 03:25:17发布为非草稿、非预发布Latest。后续仅提交事实，不移动Tag或重建产物。

- Windows唯一正式链退出0：单核BelowNormal、3GiB有限堆、系统7-Zip；3030模块TypeScript/Vite、后端/私有侧车加密、运行时、native rebuild、NSIS、10文件asar合同、provenance及sealed recovery通过。草稿三资产完整回下载后才公开发布，恢复记录正常清理。
- 实际加密包探针在全新系统TEMP成功修复旧同版本导出：九字段与包内后台一致、完整内容验证、回退副本保留、二次no-op；使用真实导出管理器和加密服务端快照。原数据库保存/备份/关闭重开、完整关闭阶段与存储回执通过，731次event-loop tick，探针记录网络请求0。PORT=0不产生有效实例注册；未触及真实Agent目录、凭据或历史库。
- 同Tag真实macos-15 arm64 [workflow 39483367869](https://github.com/T8mars/T8-penguin-canvas/actions/runs/39483367869)首次执行成功，完成唯一正式Mac构建、加密、Mach-O/媒体/ad-hoc签名检查、DMG/ZIP/清单、上传及runner完整回下载。未因额度延期；仍未Apple公证。Actions运行时/arm64排队提示未导致失败，未顺带改CI依赖。
- 本机独立Windows三资产和Mac三资产完整回下载通过，实际字节与GitHub size/SHA-256及两个更新清单size/SHA-512一致。Mac追加前后Windows本地字节及远端ID/size/SHA-256未变，旧v3.3.8 Tag及六资产未变。GitHub服务器未启用immutable；实际是发布器禁止覆盖。
- 95项限定功能验证、22项打包合同及4项证据门分别通过，不相加冒认整体验收；双语5152键、能力39/319/84、公开/凭据/保护文件/预算门通过。首次打包合同仍期待旧9文件清单，按新增模块补齐10文件强制检查后22/22，未放宽检查；保留原失败日志。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.3.9.exe` | 1379772294 | `678092fbc73a4aaba23ae272b5e4fe06d04ea1c634e1c610bbf55adf66410664` |
| `T8-PenguinCanvas-Setup-3.3.9.exe.blockmap` | 1438955 | `b2e8e94632f6dc6c3fc74c0b167d26eeb5453223f9c2883975b9db15056ce33f` |
| `latest.yml` | 362 | `7f3cd2b8636a3c1f18f5c59d8e74f7f1e5a35f6f512c2fef642fa32872038611` |
| `T8-PenguinCanvas-3.3.9-mac-arm64.dmg` | 519547731 | `032c37c3d516e5f483f0d6b18c680ed533eedafd6386b4e0814c22edf7cfee19` |
| `T8-PenguinCanvas-3.3.9-mac-arm64.zip` | 511268352 | `6bb4ddacf1bfc4ad30095b340b5718081d77e9e265a0b54dbc1c3076ea3acfd2` |
| `latest-mac.yml` | 536 | `1fafa79e2ab994ba6a648f17e3eb2dc7db559095f530efef0f6d3e0a045f2d45` |

## 证据与交付

本机ignored目录`local-private/release-v3.3.9/`保留`windows-formal.log`、`packaged-probe.log`、`packaging-tests-r2.log`、`release-gate-tests.log`、`windows-independent-verify.log`、`mac-workflow.log`、`mac-independent-verify.log`、`windows-after-mac-metadata.log`、`final-assets.json`及`final-audit.json`。95项来源及失败夹具说明见[功能专题](agent-tools-installed-cli-compat.md)；日志与私有配置不公开或打包。

升级并运行本版后，在设置的“Agent连接工具”中安装/修复，再在DSH重新检测并明确审阅所显示的CLI目录。不会自动修改信任pin或配对；真人批准、完整创作/付费Provider、安装升级、用户现场及F8–F10仍后补，不视为通过。
