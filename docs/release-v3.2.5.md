# v3.2.5 画布归档与新建默认来源发布

日期：2026-10-05。用户明确授权两项开发完成后更新 SKILL/features、打包 Electron、推送新版本并更新稳定自动更新 Release；证据后补，Mac 仅 GitHub 额度不足时延期。当前为发布准备，尚未执行正式构建或发布，不冒称 Latest。

内容和验证边界见[功能专题](canvas-archive-media-defaults.md)，用户可见说明见[Release notes](../release-notes/v3.2.5.md)。新建来源不改变既有节点；schema33 为正式附加迁移，首次升级保留可验证 canonical 备份，旧版不能直接打开新库。真实 UI/安装升级/用户旧库、资源负载和 F8–F10 仍待补。

版本 package/lock/README/features/工作流同步为 3.2.5。`owner-approved-post-release-v3.2.5` 仅允许本版缺失的外部证据延期，错误授权、旧/未来版本和已有无效证据继续失败关闭。正式 Windows 链只运行一次；固定源码推送、Tag 冻结、provenance 与 sealed recovery、私有前后端、运行时归档、包内检查和远端完整回下载不可省略。使用 BelowNormal、单核、Node 3 GiB、零压缩及依赖支持的系统 7-Zip，不改受保护文件。

Mac 必须从同一固定 Tag 在真实 macos-15 arm64 runner 构建并追加三资产，不覆盖 Windows 或远端同名资产；保持 ad-hoc 未公证预览。仅实际额度不足可延期，权限错误不等于额度不足。完成后追加事实，不移动已发 Tag 或重建安装包。
