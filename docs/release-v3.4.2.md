# v3.4.2 Moss Image 发布

2026-10-23用户明确授权更新手册/features、Electron打包、推送GitHub正式新版本及自动更新Release；证据后补，Mac仅额度不足可延期。发布准备中，未将计划记为完成。

## 本版范围

新增平价小屋 `moss-image` 独立图像Tab、官方8比例/单参考图、运行权威/恢复/历史/能力同步与三份无凭据工作流；旧默认及自动更新关闭机制不变。[协议和实网记录](moss-image.md)保留完整细节。

开发验证：Moss12项、相邻144项回归及112组隔离生产控件场景通过，类型/双语/能力/公开边界门通过。真实文生图和编辑成功并完整解码；另一次上游805失败、结算0保留，不能记作3/3通过。

## 发布策略与边界

- 在唯一核心目录固定源码，Windows正式加密/双侧私有扩展/运行时/NSIS链仅构建一次；Tag与安装包源码绑定，发布后不得移动Tag或重建替换。
- Windows先验证EXE、blockmap、latest.yml；Mac由同一正式Tag在真实arm64 runner构建并追加DMG、ZIP、latest-mac.yml，不覆盖Windows资产。各平台独立完整回下载，核对GitHub size/SHA-256及更新清单size/SHA-512。
- 现场升级、完整画布实链、用户设备和F8–F10按 `owner-approved-post-release-v3.4.2` 后补，不标通过；严格进度27/32不变。Mac仅ad-hoc未Apple公证，不冒充正式Apple签名。
- 私有发布记录位于 `local-private/release-v3.4.2/`，不提交/公开/打包；保留上版v3.4.1六资产及Tag不变的基线。正式构建和远端验证完成后再补精确事实。
