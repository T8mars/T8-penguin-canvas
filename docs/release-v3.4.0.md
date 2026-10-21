# v3.4.0 活动画布定位发布

2026-10-21，用户明确授权更新手册、features、Electron打包、GitHub源码/Tag及自动更新Release；外部证据后补，Mac仅额度不足可延期。按十进制序列3.3.9→3.4.0，不创建3.3.10。

## 范围与保护

- 纳入[活动上下文](agent-active-context.md)：版本化只读API、CLI active、主frame按需回执、多窗口歧义、窗口重启/重载和保存关闭保护。原workspaces/current/use、配对/批准、CAS/RunIntent和自动更新状态机不变。
- 87项限定回归（含新增11项、两个真实Electron隔离场景）、16项Electron打包合同及类型检查通过，不冒认完整安装验收。仅本版使用`owner-approved-post-release-v3.4.0`后补，原27/32与F8–F10边界不变。
- 固定源码推送main和annotated正式Tag后，Windows执行唯一正式链：私有前后端/加密、运行时、native rebuild、NSIS、11文件asar合同、provenance、sealed recovery、草稿完整回下载后发布。Mac使用同Tag真实macos-15 arm64构建ad-hoc未公证预览。
- 分别独立完整回下载六资产、两个清单；Mac追加不改Windows资产，旧v3.3.9 Tag/六资产冻结。不得用账单接口不可用冒认额度不足。

## 当前状态

已授权准备，尚未正式构建或发布。固定源码、workflow、资产摘要及验证结果仅在实际完成后回填。私有证据目录`local-private/release-v3.4.0/`保持忽略，不公开或打包。
