# v3.4.0 活动画布定位发布

2026-10-21，用户明确授权更新手册、features、Electron打包、GitHub源码/Tag及自动更新Release；外部证据后补，Mac仅额度不足可延期。按十进制序列3.3.9→3.4.0，不创建3.3.10。

## 范围与保护

- 纳入[活动上下文](agent-active-context.md)：版本化只读API、CLI active、主frame按需回执、多窗口歧义、窗口重启/重载和保存关闭保护。原workspaces/current/use、配对/批准、CAS/RunIntent和自动更新状态机不变。
- 87项限定回归（含新增11项、两个真实Electron隔离场景）、16项Electron打包合同及类型检查通过，不冒认完整安装验收。仅本版使用`owner-approved-post-release-v3.4.0`后补，原27/32与F8–F10边界不变。
- 固定源码推送main和annotated正式Tag后，Windows执行唯一正式链：私有前后端/加密、运行时、native rebuild、NSIS、11文件asar合同、provenance、sealed recovery、草稿完整回下载后发布。Mac使用同Tag真实macos-15 arm64构建ad-hoc未公证预览。
- 分别独立完整回下载六资产、两个清单；Mac追加不改Windows资产，旧v3.3.9 Tag/六资产冻结。不得用账单接口不可用冒认额度不足。

## 当前状态

固定源码、annotated `v3.4.0`的peeled commit及Release target为`f482ccce24cef89662682e207b37266e945c0f23`。[正式Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.4.0)于北京时间2026-10-21 11:31:54公开为非草稿、非预发布Latest。后续仅提交发布事实，不移动Tag或重建。

- Windows唯一正式链退出0：单核BelowNormal、3 GiB有限堆及系统7-Zip；3031模块构建、后端/四份私有侧车加密、运行时归档、native rebuild、NSIS、11文件asar合同、provenance和sealed recovery通过。草稿三资产完整回下载后才公开；恢复记录已正常清理。
- 实际加密包使用全新系统TEMP：活动上下文服务及原生模块的最小合成IPC回执、字段白名单、无监听残留、九字段兼容、旧同版本工具刷新/回退及二次no-op通过；真实临时数据库保存、备份、重开、完整关闭阶段和storageClosed回执通过，593次event-loop tick，记录网络请求0。合成窗口不代表包内GUI或真人批准，未触及真实用户库/工具目录。
- 真实macos-15 arm64 [workflow 39539139604](https://github.com/T8mars/T8-penguin-canvas/actions/runs/39539139604)首次完成唯一正式构建、加密、Mach-O/媒体/ad-hoc签名、DMG/ZIP/清单检查及三资产上传。最终回下载DMG成功，ZIP发生`connection reset by peer`，整体结论为failure，原失败完整保留；没有为刷绿重建或覆盖资产。
- 本机独立Windows三资产和Mac三资产均完整回下载通过，实际size/SHA-256及两个更新清单size/SHA-512匹配；Mac还与runner本地产物写入Release notes的摘要一致，完成网络失败后的独立字节复核，不冒认原runner验证通过。Mac追加前后Windows ID/字节/摘要及旧v3.3.9 Tag/六资产未变。
- 87项限定回归、22项双平台打包合同及4项证据门分别通过；类型检查、5152双语键、能力39/319/84、公开/凭据/保护文件及预算门通过。首次源码推送退出128，确认远端未变且Git对象检查通过后重试成功；正式构建未重复。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.4.0.exe` | 1379777543 | `4726bf367cd4d03ff8a1125cfac29b562c4cccff0cbe577fcfd07a2edadb9eff` |
| `T8-PenguinCanvas-Setup-3.4.0.exe.blockmap` | 1439557 | `462162fb0690c53568732b44097431ebd19b0b262cc7eb606f4b46faff297092` |
| `latest.yml` | 362 | `bde313fc3b3d8363935b77da93b4c9aed633cb0c85fa36ce7ce501b2af116079` |
| `T8-PenguinCanvas-3.4.0-mac-arm64.dmg` | 519436427 | `5c61d234b837cee795f07881191b1df076c56470b4b5f98d899cb25fa1f8c28a` |
| `T8-PenguinCanvas-3.4.0-mac-arm64.zip` | 511273796 | `debbe9b77675f72e2031f9dfebb046aaeb034e209580b778827685cfec64c531` |
| `latest-mac.yml` | 536 | `bf0c5bf9cfd9d086367e4cce54ce7ecf30c11cbb9d450b54eb10e2da8cae61f6` |

## 证据与交付

私有证据目录`local-private/release-v3.4.0/`保留`windows-formal.log`、`packaged-probe.log`、`packaging-tests.log`、`release-gate-tests.log`、`windows-independent-verify.log`、`mac-workflow.log`、`mac-independent-verify.log`、`windows-after-mac-metadata.log`、`final-assets.json`及`final-audit.json`，保持忽略，不公开或打包。开发态证据见[活动上下文](agent-active-context.md)。

升级运行本版后，可在设置中安装/修复配套Agent工具，再由连接端重新检测和明确审阅。Mac已发布但仍未Apple公证；正式安装升级、真人最小权限配对、DSH现场及F8–F10后补，不视为通过。没有更改DSH信任或代替用户批准。
