# v3.3.2 Topaz 视频修复发布

2026-10-11，用户明确授权更新手册、features、Electron 打包、GitHub 新版本及自动更新 Release；证据后补，Mac 仅额度不足可延期。十进制序列 3.3.1 → 3.3.2。

## 范围与当前状态

- 独立 Topaz Tab、精确参数、两份无凭据工作流及实网结果见[功能专题](topaz-video-upscale.md)；不改变旧默认、旧来源、本地 Topaz 或用户数据库。
- 版本/lock、README、features、根私有手册、当前上下文、Release notes、Mac 默认输入及一次性后补证据门已同步；27/27 Electron/双语/Mac 合同、4/4 版本级证据门及能力/双语/RH/公开源码/预算检查通过。
- 已有 157/157 前端及协议回归、42/42 后端用例及单独 10/10 能力检查通过；一次真实 720p/Low 任务成功、产物完整解码。本轮不重复付费生成。
- 发布技术门、加密、私有扩展、运行时、NSIS、更新清单及完整远端回下载已通过；浏览器端到端、安装升级、用户现场及 F8–F10 按 `owner-approved-post-release-v3.3.2` 后补，不能写作通过。
- Mac 已由真实 macos-15 arm64、与 Windows 同正式 Tag 发布，仍为 ad-hoc 未公证预览。额度 API 404/缺少权限不代表额度不足；实际 workflow 成功，未延期。

发布日志保存在 ignored `local-private/release-v3.3.2/`。凭据、真实任务身份、输入输出和构建中间物不公开；v3.3.1 及以前 Tag/资产冻结，正式构建只执行一次，事实补记不移动 Tag 或重建。

## 固定发布与验证

- [稳定 Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.2) 非草稿、非预发布，发布时间 `2026-10-10T18:50:06Z`（北京时间 10 月 11 日）；正式 Tag 与 Release target 固定为 `954b717f983853805a943df1d5e77468592bcbf8`。
- Windows 唯一正式链以单核、BelowNormal、Node 3 GiB、零压缩及 E 盘临时目录完成生产构建、加密、私有功能、运行时归档、native rebuild、NSIS、包内检查、provenance 与发布，退出 0；sealed recovery 正常清除。发布前完整回下载及发布后的本机独立三资产回下载均通过，校验 size/SHA-256 与 latest.yml 的 size/SHA-512。
- 正式 win-unpacked 程序加载 Topaz 加密后端及共享合同、验证无网络直链参数构建与前端模型；fresh 系统临时库备份、重开、名称保持和关闭通过，事件循环计时 238 次。临时库已清理，未读取用户历史数据库，不等于安装验收。
- 发布前一个新 Git blob 解压失败：保留损坏对象，按工作区内容重建相同 SHA；未 reset/clean/覆盖源码。单核下公开源码、staged diff 和完整 fsck 返回 0；中途 index 读取及 Git 进程异常记录保留在私有 `verification-boundaries.md`，未声称硬件健康通过。
- 同正式 Tag 的 [Mac workflow 38077432260](https://github.com/T8mars/T8-penguin-canvas/actions/runs/38077432260) 成功（job 7m32s）：私有源恢复、原生依赖、6 项合同、生产构建、加密、9 文件 asar 启动合同、原生媒体工具 probe、ad-hoc、DMG/ZIP/清单及 runner 三资产回下载通过。6 项合同是本机 27 项的子集，不重复相加。
- 本机独立完整回下载 Mac 三资产，并再次完整下载 Windows 三资产；逐项核对 GitHub size/SHA-256 与两个更新清单 size/SHA-512。Windows 三资产 ID `628723345 / 628723334 / 628723344` 追加前后不变，v3.3.1 源码及六资产 ID/size/散列均未变。
- 关键记录：`windows-formal.log`、`packaging-tests.log`、`deferral-tests.log`、`packaged-probe.log`、`windows-independent-verify.log`、`windows-final-independent-verify.log`、`mac-independent-verify.log`、`mac-result.json`、`mac-workflow.log`、`final-assets.json`。已通过项与后补边界分开记录，未重建正式包或移动 Tag。

| 资产 | bytes | SHA-256 |
| --- | ---: | --- |
| T8-PenguinCanvas-Setup-3.3.2.exe | 1375980820 | 341054b619567a72651a99e53e7ce7435811fd075003e4771b783db9cc0f659c |
| T8-PenguinCanvas-Setup-3.3.2.exe.blockmap | 1435266 | 40c423a6897aeef1c864d118cac24e0e110033cbad407ad36da9d1678f9b31ab |
| latest.yml | 362 | 43bf3a3d2c1689923757dc785fd2a810ca3a30673c292c1f4add2fa0f7162a68 |
| T8-PenguinCanvas-3.3.2-mac-arm64.dmg | 514645318 | ebce059c754cac00ac6fd82b94d8a8dccc6249ac695f5dbfae4396e5337c3dcf |
| T8-PenguinCanvas-3.3.2-mac-arm64.zip | 506577589 | 401c1f4d4928b0c02da03e5467fbf2d84aaca5cc8bbd933d39bbb776b95514cd |
| latest-mac.yml | 536 | 2a5705bcbd0113043b9708128d04ba935412a00c06eb8de47fae53916487a146 |
