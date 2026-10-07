# v3.2.9 启动与历史名称修复发布

2026-10-08：Windows 与同源 Mac 发布及六资产/两个更新清单独立验证全部完成。当前用户明确授权更新私有 SKILL/features、一次正式 Electron 打包、推送固定源码及新 Tag、发布稳定 Latest 和自动更新资产。Mac 仅实际 GitHub 额度不足可延期；安装升级、受影响用户及 F8–F10 证据按 `owner-approved-post-release-v3.2.9` 后补，不标通过。

产品范围为[启动修复](startup-history-fix-20261008.md)：单次不变数据校验复用、私有候选备份独立线程、活动画布缺失旧名称补回和固定日志细分阶段。完整校验、主库 owner/ACK、备份原子替换及归档保护不放宽；不读取历史用户数据库。

版本同步 package/lock、README、features、私有 SKILL、当前上下文、Release notes 与 Mac workflow。v3.2.8 精确六资产移至 `features.json#electronReleaseV328.assets`，保留既有历史记录及固定 Tag。

执行链：限定回归及公开/能力门 → 精确范围源提交 → fast-forward 推送 main/新 Tag → 唯一 `dist:release` → 固定源码、provenance/sealed recovery → 草稿三资产完整回下载 → 稳定 Latest → 同 Tag macos-15 arm64 → 两平台独立完整回下载 → 追加事实，禁止移动 Tag 或重建已封印包。

沿用 BelowNormal、单核、Node 3 GiB、零压缩、既有系统 7-Zip、E 盘临时目录的正式配置。用户安装与真实性能不能用合成库、mock 或本机工具校验替代。

发布前专项串行 55/55（上述修复 51 项加本版延期门 4 项），打包合同 22/22；能力 39 动作/306 运行时项/83 节点、双语 4911 条目、RH 清单 15 工具/12 分类、语法与上下文预算门通过。完整类型/Vite 随后在唯一正式构建中执行，实际结果如下。

## 正式发布事实

- 正式源码与 peeled Tag `v3.2.9` 固定为 `bf1dbff365cc169d242d5f8cb1d5358469ff4d83`；随后仅追加事实，不移动 Tag 或重建。
- 唯一 Windows 构建完成：生产类型/Vite（2998 模块）、加密、原生依赖、NSIS、9 项 app.asar 启动合同、私有前后端、媒体及两份运行时归档检查通过；源码/保护文件未漂移。外层 Windows PowerShell 5 首次启动器误用默认文本编码，在正式命令执行前报 JSON 解码错误；改为显式 UTF-8 并使用 pwsh 后只执行一次正式构建，未修改固定源码。
- 实际 `win-unpacked` 可执行与加密后端专项 probe 通过：新建系统临时小库、私有候选 seal/verify Worker、父事件循环 57 次 tick、close/冷开与干净快路径均正常；临时库清理，未读取用户库或修改发布产物。这不是安装升级/用户现场验收。
- 三项原始 Windows 资产 provenance/sealed recovery 与 GitHub size/SHA-256 一致，草稿三资产完整回下载、更新清单 size/SHA-512 校验通过后，于 `2026-10-07T19:30:32Z` 发布为[稳定 Latest](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.2.9)，恢复记录清除。上传使用进程级直连，Git 使用现有代理，没有修改系统网络设置、没有重建或覆盖远端资产。
- [同 Tag Mac workflow 37675076979](https://github.com/T8mars/T8-penguin-canvas/actions/runs/37675076979) 成功，源码绑定同一 SHA；合同 6/6、原生依赖、正式构建/加密、ad-hoc 签名、9 项 app.asar 启动合同和三资产 runner 完整回下载通过。三份 Mac 资产已追加到同一稳定 Latest。额度 API 因权限不足不可读，未冒称剩余额度；实际构建/发布成功，本轮未延期，Mac 仍未 Apple 公证。
- Mac 追加后 Windows 三项资产的 ID、名称、size、SHA-256 完全未变；六资产精确数据只维护在 `features.json#release.assets`，Tag/Release target 与 Mac 来源保持固定源码。

- 本机 `release:mac:verify` 与 Mac 追加后的 `release:verify` 均返回 0：分别完整回下载三项 Mac / Windows 资产，核对 GitHub size/SHA-256、两更新清单的版本/size/SHA-512；Mac 来源为固定 Tag 源码，稳定 Latest 为 v3.2.9。验证使用进程级现有代理和 E 盘临时目录，不改系统设置。

私有证据：本版 `local-private/release-v3.2.9/` 下的 `preflight-tests.log`、`packaging-tests.log`、`windows-formal.log`、`packaged-worker-probe.log`、`windows-id-baseline.json`、`mac-workflow.log`、`mac-independent-verify.log`、`windows-final-verify.log` 和 `final-assets.json`。外部安装/受影响用户/F8–F10 继续后补，不记通过。
