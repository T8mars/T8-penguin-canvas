# v3.2.6 RH 媒体与工坊香蕉2.1发布

日期：2026-10-07。用户明确授权更新 SKILL/features、Electron打包、推送GitHub新版本和稳定自动更新Release；外部证据后补，Mac仅实际额度不足可延期。当前为发布准备，尚未把构建、上传或资产验证记为完成。

范围与证据：[RH媒体修复](rh-media-field-validation-20261007.md)、[工坊新模型](nano-banana21-workshop.md)。两个生产改动分别为共享媒体类型优先判定及目录追加一个模型；旧枚举、默认参数、旧节点和启动逻辑保持不变。已取得限定实网证据，不冒认全部应用、安装版或用户现场通过。

package/lock/README/features/工作流同步3.2.6，主进程及Vite版本由package动态读取。根SKILL保持私有、忽略，仅更新当前发布索引。`owner-approved-post-release-v3.2.6`只允许本版缺失外部证据延期，旧/未来版本、错误授权及已有无效清单继续阻断。

正式链：精确文件提交并固定源SHA → fast-forward推送origin/main及新Tag → canonical core唯一一次 `dist:release` → provenance/sealed recovery → 草稿三资产完整回下载 → 稳定Latest → 同Tag macos-15 arm64构建与追加 → 两平台独立完整回下载 → 追加发布事实，不移动Tag或重建包。

使用BelowNormal、单核、Node3GiB、零压缩与依赖支持的系统7-Zip，保持全部技术门、私有前后端和运行时归档，不编辑受保护文件。Mac仍为ad-hoc未公证预览，不覆盖Windows资产或任何同名远端字节。

GitHub仓库已查为public，workflow使用标准macos-15；[官方规则](https://docs.github.com/en/billing/concepts/product-billing/github-actions)说明公开仓库标准runner的Actions分钟免费。当前token缺少user scope，账单API返回404，未查询到余额，不能冒称额度充足；实际workflow如果遇到额度失败才记录延期，不把权限错误当额度不足。

## 本次正式结果

待固定源码、唯一正式构建、稳定发布与两端完整回下载后回填。用户安装升级、反馈现场及F8–F10仍按上述授权后补，不视为通过。
