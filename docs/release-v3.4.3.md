# v3.4.3 右键菜单与 Agnes 视频协议修复发布

2026-10-24 用户明确授权更新 SKILL/features、Electron 打包、GitHub 新版本及自动更新 Release；现场证据后补，Mac 仅真实额度不足可延期。本版已同源双平台发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.4.3)，公开时间 `2026-10-24T13:59:59Z`；源码、Tag peeled commit 与 Release target 固定为 `385d21408df3027f09d92c6f0a092b41cc614daf`。正式包只构建一次，Tag 不移动；旧 v3.4.2 Tag 与六资产保持冻结。

## 范围和已有验证

- 快速添加菜单按可见画布/视口限高、原生滚动、窗口变化重定位；保留标题、键盘定位及原新增落点。
- Agnes 视频退役2.0默认项移除，旧节点仅在 Agnes 视频选择边界兼容为2.5；标准2.5与Flash按新合同发送时长/档位/比例/模式，不发送旧宽高/帧数。HTTP错误展开，pending URL不提前当完成，原任务GET查询且不重放POST。
- 55项限定回归及72组隔离生产组件/注册表/Tailwind/主题组合通过；实际滚轮、末项定位和点击、缩小窗口与4次模式编辑通过。类型、双语、能力同步、公开与文档预算门通过，细节见[修复专题](quick-add-agnes25-fix.md)。
- 两模型各一次实网4秒/720P文生请求均HTTP503队列满、无任务ID；没有成功出片/下载/解码证据，没有自动重交，不用本地绿测抵消上游失败。
- 自动更新保存确认/停止新请求/实际存储关闭和安装器正常退出机制保持不变；本轮不读取用户库、不操作用户安装进程。

## 正式构建与资产验证

- Windows 唯一正式 `dist:release` 退出0：单核 BelowNormal/3 GiB 堆、3039模块编译、后端与四份私有扩展加密、双运行时、原生依赖、NSIS、11文件asar合同、post-build、provenance 与 sealed recovery 通过。草稿三资产完整回下载、size/SHA-256/SHA-512与更新清单一致后才公开 Latest；恢复记录已清理。
- 正式加密包探针首轮通过：Agnes2.5合同、菜单滚动、既有Moss/CLI/活动定位、全新系统TEMP数据库保存/备份/重开和实际存储关闭均通过，外网请求0。探针的端口0实例注册不在验收范围，亦不等于完整Canvas或安装升级；未读取用户库或操作用户安装进程。
- 同一Tag的[Mac workflow 40100569806](https://github.com/T8mars/T8-penguin-canvas/actions/runs/40100569806)第1次执行成功：真实macos-15 arm64、6项发布合同、唯一正式构建、ad-hoc签名、11文件asar合同及Mach-O/媒体/DMG/ZIP/清单检查、产物保留与三资产追加/runner完整回下载通过。未因额度延期。
- 本机独立 Windows/Mac 六资产完整回下载全部通过，GitHub size/SHA-256及两个更新清单对应包的size/SHA-512一致；Mac追加后的Windows更新元数据复核也通过。
- 追加前后 Windows 三资产 ID/size/SHA-256、旧v3.4.2 Tag/六资产均保持不变；六项 GitHub 摘要如下。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `latest-mac.yml` | 536 | `b54c7983caee6a48de5302c514670e70a688600c7c22288efdb2f6f246f4c381` |
| `latest.yml` | 362 | `4b5d69ee70c7148a3defd1f6e5d8476ea3ccc54766d2381546abe42b691be047` |
| `T8-PenguinCanvas-3.4.3-mac-arm64.dmg` | 519475424 | `55137add447bf522e4326b556938fe1b965aa2519a37ac2e4bd7bb08581721f3` |
| `T8-PenguinCanvas-3.4.3-mac-arm64.zip` | 511282524 | `45b713e99dc4d9ea942dbddf3a1dca74221d1c953c04b5f72b5432d5dc0c8b5f` |
| `T8-PenguinCanvas-Setup-3.4.3.exe` | 1379785524 | `6e25c484e061e32eceef848e1aa6dcd715e3a0ff3b1aeac743266fe4f4db6032` |
| `T8-PenguinCanvas-Setup-3.4.3.exe.blockmap` | 1439200 | `f2e84647332c06703939719193470f25abf6d0183e2923cde68d27ad31547e26` |

## 证据与未验收

私有 `local-private/release-v3.4.3/` 保留20项发布门、正式链、探针、独立回下载、workflow与资产快照；Provider/菜单证据见 `local-private/quick-add-agnes-20261024/`。根手册、凭据和私有证据不公开或打包。GitHub额度API返回404/缺user scope只表示不可读，不冒认额度不足；私有Secret仅确认名称，不读取/输出值。

完整画布、安装升级、用户现场与F8–F10按 `owner-approved-post-release-v3.4.3` 后补，不标通过；27/32不变。Agnes两模型实网503失败继续保留，不能用本地绿测宣称成功出片。Mac仍ad-hoc未Apple公证预览，不冒充正式Apple签名；更新清单验证不代表安装升级已验收。
