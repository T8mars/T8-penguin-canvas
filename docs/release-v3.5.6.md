# v3.5.6 发布记录

Windows x64 与 Apple Silicon macOS 已发布到同一正式 GitHub Release。发布时间为 2026-11-25T14:56:44Z，构建源码及 Tag 固定到 `e195dcad5108390d9a15c7a043a21f936d8fd294`。v3.5.5 Tag 和六项资产已复核。[GitHub Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.5.6)

本版新增 Magi 国内、海外两款视频模型及六份工作流。国内文生和海外混合参考均实网成片并完整解码，六份工作流均通过隔离 Electron 运行。[模型与工作流](magi2.md)

Windows NSIS、blockmap 和 latest.yml 已完整回下载并核对大小、SHA-256 及安装包 SHA-512。Windows 正式包的 Magi 加密模块、原任务 GET、前端资源、新库备份重开与关闭探针通过。17 项模型和发布合同、3 项分片下载测试通过。

Apple Silicon 从同一 Tag 构建 DMG、ZIP 和 latest-mac.yml，完整回下载及 ZIP SHA-512 校验通过。Mac 为 ad-hoc 签名、未公证预览。[Apple Silicon 构建](https://github.com/T8mars/T8-penguin-canvas/actions/runs/45639826896)

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest-mac.yml | 536 | 4262e6179ae3818cf76a2f8ad6518f14005a7d69714260d567e7d3d74b5c1ae5 |
| latest.yml | 362 | 3b15ee15e479a67bc1c4cbb43b07422f80391497042d5105a17f9affaa133351 |
| T8-PenguinCanvas-3.5.6-mac-arm64.dmg | 519983896 | c2cc9350856265c9643118add44455b5d7ab0b55f6a6af36e852f6f9bd2f2949 |
| T8-PenguinCanvas-3.5.6-mac-arm64.zip | 511692406 | 28578cca6fb71e1f97e526e304955e61fd159f78dd4c31604a25fed55f4ec04b |
| T8-PenguinCanvas-Setup-3.5.6.exe | 1380179019 | 8314137709891e41c0cbc9c8927c8ac14b61df9b308a1293471cca581dabbd36 |
| T8-PenguinCanvas-Setup-3.5.6.exe.blockmap | 1438852 | 5f8608f4a1dc6dc82208ca3c342aa77afaeda872896e2b7f286ed5b26bf34fec |

公开更新清单返回 v3.5.6。用户现场、完整安装升级及 F8–F10 证据后补，严格进度保持 27/32。私有证据位于 `local-private/release-v3.5.6/`。
