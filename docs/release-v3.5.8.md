# v3.5.8 发布记录

Windows x64 与 Apple Silicon macOS 已发布到同一正式 GitHub Release。发布时间为 2026-11-27T19:18:02Z，构建源码及 Tag 固定到 `a037c5632dc3907bb32005d14a6204d24d865c5d`。v3.5.7 Tag 和六项资产已复核。[GitHub Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.5.8)

本版在平价小屋音频节点新增 Seed-TTS 3.0 及可导入工作流。实网一次提交、原任务查询及 24 kHz 单声道 WAV 完整解码通过；隔离 Electron 画布验证了模型切换、保存及重载。[模型与工作流](seed-tts-3-0.md)

Windows NSIS、blockmap 和 latest.yml 已完整回下载并核对大小、SHA-256 及安装包 SHA-512。Windows 正式包的 Seed-TTS 3.0 加密模块、原任务 GET、前端资源、临时库备份重开及关闭探针通过。模型、发布合同及分片下载定向回归通过。

Apple Silicon 从同一 Tag 构建 DMG、ZIP 和 latest-mac.yml，完整回下载及 ZIP SHA-512 校验通过。Mac 为 ad-hoc 签名、未公证预览。[Apple Silicon 构建](https://github.com/T8mars/T8-penguin-canvas/actions/runs/46055767283)

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest-mac.yml | 536 | fbb2c87a2b8b4f5147ce9983b6f6f149ba33e8728d8bf689670f097dbd93a484 |
| latest.yml | 362 | 2e74d5d679ce666ed202322843062ee370728c400e49a9db3ebb0e8682b6331e |
| T8-PenguinCanvas-3.5.8-mac-arm64.dmg | 519917404 | 379d8077878719543c79a9faebc20d22f0c6029b8ef4362c64597915ab1342c9 |
| T8-PenguinCanvas-3.5.8-mac-arm64.zip | 511700373 | 920ab506d6982325951c7432de283fc680578ec7e32943631796812699e758c3 |
| T8-PenguinCanvas-Setup-3.5.8.exe | 1380185704 | 480d41289e473f3a442e3d9591e5fbb4f7195d381a91142e096cc67f0d6ccbbe |
| T8-PenguinCanvas-Setup-3.5.8.exe.blockmap | 1439330 | be4a05971343b7496acfaf48c3570167cd9a441d255c6608f15d5767a2fb97ce |

公开更新清单返回 v3.5.8。用户现场、完整安装升级及 F8–F10 证据后补，严格进度保持 27/32。私有证据位于 `local-private/release-v3.5.8/`。
