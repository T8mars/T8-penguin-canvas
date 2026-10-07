# v3.2.9 启动与历史名称修复发布

2026-10-08：当前用户明确授权更新私有 SKILL/features、一次正式 Electron 打包、推送固定源码及新 Tag、发布稳定 Latest 和自动更新资产。Mac 仅实际 GitHub 额度不足可延期；安装升级、受影响用户及 F8–F10 证据按 `owner-approved-post-release-v3.2.9` 后补，不标通过。

产品范围为[启动修复](startup-history-fix-20261008.md)：单次不变数据校验复用、私有候选备份独立线程、活动画布缺失旧名称补回和固定日志细分阶段。完整校验、主库 owner/ACK、备份原子替换及归档保护不放宽；不读取历史用户数据库。

版本同步 package/lock、README、features、私有 SKILL、当前上下文、Release notes 与 Mac workflow。v3.2.8 精确六资产移至 `features.json#electronReleaseV328.assets`，保留既有历史记录及固定 Tag。

执行链：限定回归及公开/能力门 → 精确范围源提交 → fast-forward 推送 main/新 Tag → 唯一 `dist:release` → 固定源码、provenance/sealed recovery → 草稿三资产完整回下载 → 稳定 Latest → 同 Tag macos-15 arm64 → 两平台独立完整回下载 → 追加事实，禁止移动 Tag 或重建已封印包。

沿用 BelowNormal、单核、Node 3 GiB、零压缩、既有系统 7-Zip、E 盘临时目录的正式配置。用户安装与真实性能不能用合成库、mock 或本机工具校验替代。

发布前专项串行 55/55（上述修复 51 项加本版延期门 4 项），打包合同 22/22；能力 39 动作/306 运行时项/83 节点、双语 4911 条目、RH 清单 15 工具/12 分类、语法与上下文预算门通过。正式构建、上传和 Mac 尚未完成，不冒认发布。完整类型/Vite 留在唯一正式构建中执行。
