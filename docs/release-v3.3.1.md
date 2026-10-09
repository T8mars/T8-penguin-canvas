# v3.3.1 平价图像与 Vidu Q4 发布

2026-10-10，用户明确授权更新手册、features、Electron 打包、GitHub 新版本及自动更新 Release；证据后补，Mac 仅额度不足可延期。十进制序列 3.3.0 → 3.3.1。

## 范围与当前状态

- 六模型、精确参数、八份无凭据工作流及实网证据见[功能专题](nb21-flux-viduq4.md)；不改变旧默认、旧来源、Q3 协议或用户数据库。
- 版本/lock、README、features、根私有手册、当前上下文、Release notes、Mac 默认输入已同步。发布前新增 27/27 Electron/双语/Mac 合同与 4/4 版本级后补证据门通过；能力同步、双语、RH 工具箱、公开源码、上下文预算与差异门通过。
- 159/159 功能与相邻回归、49/49 独立 Electron 后端用例、八条真实生成及产物完整解码已通过。本轮不重复付费生成。
- 发布技术门、固定源码/Tag、构建、加密、私有扩展、运行时、NSIS、更新清单和完整远端回下载必须通过。浏览器端到端、安装升级、用户现场及 F8–F10 按 `owner-approved-post-release-v3.3.1` 后补，不能写作通过。
- Mac 已由真实 macos-15 arm64、与 Windows 同固定正式 Tag 完成发布；仍为 ad-hoc 未公证预览。额度 API 返回 404/缺少权限，不代表额度不足；实际 workflow 成功，本轮未延期。

发布日志保存在 ignored `local-private/release-v3.3.1/`；凭据、原任务身份、输入输出和构建中间物不公开。v3.3.0 及以前 Tag/资产冻结，正式构建只执行一次，事实补记不移动 Tag 或重建。

## 固定发布与验证

- [稳定 Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.1) 非草稿、非预发布，发布时间 `2026-10-09T18:49:56Z`（北京时间 10 月 10 日）。正式 Tag 和 Release target 固定于 `66b13a38a5129ffe3aac82decaa80b0806701d59`。
- Windows 唯一正式链以单核、BelowNormal、Node 3 GiB、零压缩及 E 盘临时目录完成生产构建、加密、私有功能、运行时归档、native rebuild、NSIS、包内检查、provenance 与发布。外层旧 Windows PowerShell 把标准后补证据警告误作错误，导致外壳返回 1、主日志仅保留起始行；保留此失败事实，没有重跑构建。发布恢复记录已正常清除，正式产物及独立完整回下载均通过。
- 正式 win-unpacked 程序成功加载六个新模型的加密后端、共享合同与前端；fresh 系统临时库备份、重开和关闭通过，事件循环计时 61 次。探针初次因夹具缺少宿主上下文而正确拒绝，补齐临时上下文后通过；未修改产品源码或重建产物。临时库已清理，不等于完整安装验收。
- 同 Tag 的 [Mac workflow 37976089033](https://github.com/T8mars/T8-penguin-canvas/actions/runs/37976089033) 成功（7m3s）：私有源恢复、原生依赖、6 项合同、生产构建、加密、9 文件 asar 启动合同、arm64/Mach-O、ad-hoc、DMG/ZIP/清单、追加与 runner 三资产回下载通过。6 项合同属于本机 27 项的子集，不重复相加。
- 本机独立完整回下载 Mac 三资产，并再次完整下载 Windows 三资产；逐项核对 GitHub size/SHA-256 和两个更新清单的 size/SHA-512。Windows 三资产 ID `625850963 / 625850940 / 625850962` 在 Mac 追加前后不变；v3.3.0 源码及六旧资产 ID、大小、散列均未变。
- 关键记录：`packaging-tests.log`、`deferral-tests.log`、`packaged-probe.log`、`windows-independent-verify.log`、`windows-final-verify.log`、`mac-independent-verify.log`、`mac-result.json`、`mac-workflow.log`、`final-assets.json`。Actions 的 Node 20 action-runtime 弃用及 arm64 排队提示没有影响成功，不视为额度不足。

| 资产 | bytes | SHA-256 |
| --- | ---: | --- |
| T8-PenguinCanvas-Setup-3.3.1.exe | 1375967830 | 07959ec2dc11447b93048beb01eea87e93d3e5dde8711a2fc14c1282d592f5f0 |
| T8-PenguinCanvas-Setup-3.3.1.exe.blockmap | 1434972 | fad8df8b07f14b8eb7eb9282163ddaeaf94b32e5a2ebe2c2fec1591d0a7aa898 |
| latest.yml | 362 | a103a0735efa1f6d17baf43c39a07ab8f0500e23bf8fde0f0f6b87311d6c3361 |
| T8-PenguinCanvas-3.3.1-mac-arm64.dmg | 514606515 | ae3f87390b875e5d646a866cda781fb07c1899e41a166aba2520b989439e95a1 |
| T8-PenguinCanvas-3.3.1-mac-arm64.zip | 506564020 | fc43c1402b040f45f0fd42588bef7a99ba77275efdfd72ad7ba33b19c17f56d1 |
| latest-mac.yml | 536 | a84cb817051cf908dc57d7f0372cf11dd8096d26831fef080ca6e74ea4b01235 |
