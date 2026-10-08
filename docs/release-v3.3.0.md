# v3.3.0 自动更新退出修复发布

2026-10-08，用户明确授权更新手册、features、Electron 打包、GitHub 新版本和自动更新 Release；证据后补，Mac 仅额度不足可延期。按十进制展示序列从 3.2.9 升为 3.3.0。

## 范围与状态

- 修复范围、70 项限定测试及初次失败事实见[修复专题](auto-update-exit-fix-20261008.md)。不改模型、用户数据库或画布保存/恢复合同。
- package/lock、README、features、当前上下文、根私有 SKILL、Release notes 与 Mac 默认输入同步。双平台正式链和远端验证完成；旧 Tag 和资产冻结。
- 生产技术门和资产完整性不能延期；安装升级、反馈用户现场与 F8–F10 按 `owner-approved-post-release-v3.3.0` 后补，不视为已通过。
- Mac 必须同正式 Tag、真实 macos-15 arm64 workflow；仍为 ad-hoc 未公证预览。

## 本地仓库恢复

损坏对象已备份，工作文件重建 blob 的 SHA 完全一致；两个无可达引用的损坏对象仅隔离保留。完整 Git 检查与暂存差异门通过，未丢弃改动或移动历史引用。精确细节见修复专题；备份位于 ignored `local-private/git-object-recovery/20261008-330/`。

## 发布证据

版本级后补门初次回归 42/43：夹具仍把新授权版本 3.3.0 当作未来禁止版本；已改为同时拒绝旧 3.2.9 和未来 3.3.1，不放宽生产门。该初次失败发生在正式构建前，留档 `preflight-cjs.log`。

发布前最终 74 个不同用例通过：修复/保存/退出/NSIS 39 项，Electron/双语/Mac 打包合同 31 项，后补证据门 4 项。双语、能力索引、公开源码、上下文预算与差异门通过；类型检查与正式生产构建均通过。Mac CI 的 6 项合同是上述 31 项子集，不重复加总。

日志集中于 ignored `local-private/release-v3.3.0/`，不发布凭据、构建中间物或用户数据。

## 固定发布与产物

- [稳定 Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.0)：非草稿、非预发布，发布时间 `2026-10-08T04:34:28Z`。正式 `v3.3.0` Tag 和 Release target 固定于 `f8d01582b1ae0a4e182656de8c4abf51b1eac68c`；后续仅提交发布事实，不移动 Tag 或重建包。
- Windows 唯一正式链使用单核、BelowNormal、Node 3 GiB、零压缩配置及 E 盘临时目录，完成类型/Vite 2998 模块、加密、四项私有源、运行时归档、native rebuild、NSIS、9 文件 asar 启动合同、媒体/私有功能/密钥边界、provenance、sealed recovery、草稿三资产完整回下载后发布。恢复记录正常清除。
- 正式 win-unpacked 程序实际加载新版 updater 合同、双语目录和加密数据库，fresh 系统临时库备份、重开与关闭成功，事件循环计时 235 次；测试目录已清理。这不是完整安装或用户升级验收。
- 同 Tag 的 [Mac workflow 37728202199](https://github.com/T8mars/T8-penguin-canvas/actions/runs/37728202199) 成功（6m29s）：私有功能恢复、原生依赖、arm64/Mach-O、ad-hoc、DMG/ZIP/清单、追加及 runner 回下载通过。额度 API 返回 404，未冒认余额为零；实际构建发布成功，未延期。
- 本机独立完整回下载六资产，核对 GitHub size/SHA-256 和两个更新清单 size/SHA-512。Mac 追加前后 Windows 三资产 ID（620719544 / 620719536 / 620719545）、大小和散列不变；v3.2.9 源码及六旧资产 ID/大小/散列也未变。

| 资产 | bytes | SHA-256 |
| --- | ---: | --- |
| T8-PenguinCanvas-Setup-3.3.0.exe | 1375952268 | 0935e541a3090e9db7119fdd2fa7a4af9bf02177333eac4a46cf959958a1812e |
| T8-PenguinCanvas-Setup-3.3.0.exe.blockmap | 1434864 | 7e6b04feb80824db285da34c39895e722b7608590eb3699cf8b7efc0c471d399 |
| latest.yml | 362 | 69c1b7cfcf09f2679ad33c4d7d8b48690dced02b3f8053d64ae0104543d67246 |
| T8-PenguinCanvas-3.3.0-mac-arm64.dmg | 514591972 | ff0e1e137e738ff0086861faf4084348d499d879c4c3386a7fa1253f2a847c28 |
| T8-PenguinCanvas-3.3.0-mac-arm64.zip | 506548346 | f16bbd9e4fe842218864bd5e7303816eecd69c4cdda9da27c0bfe8b35038edde |
| latest-mac.yml | 536 | 2fa3399f318c12f965eee89f672b51a858756e592fb99bfaaaa7d2599ee2d294 |

完整本机校验记录为 `windows-final-verify.log`、`mac-independent-verify.log`，正式包检查为 `packaged-probe.log`，Mac 来源/构建为 `mac-result.json`、`mac-workflow.log`。Actions 有 Node 20 action-runtime 弃用提示及 arm64 排队容量提示，实际 job 成功；不把这些提示误报为额度不足。
