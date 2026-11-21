# v3.5.5 发布记录

Windows x64 和 Apple Silicon macOS 已发布到同一个正式 Release。发布时间为 2026-11-21T19:37:38Z，构建源码及 Tag 均固定到 `d7750b90e607b5580bb7c56250d6fdca02bf577f`。上一版本 v3.5.4 的 Tag 及资产已核对。[GitHub Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.5.5)

本版新增 10 个平价小屋模型与 14 份工作流。8 个模型的 12 条实网路径已验证，HeyGen 两档仍待上游成片。打包前修正 Miora 附件校验的模块路径，正式 Windows 包通过加密模块、MTL 落盘、原任务 GET 恢复、新建库备份重开与真实关闭探针。[模型与工作流](nov21-models.md)

Windows 正式构建生成 NSIS、blockmap 和 latest.yml。原发布器从草稿完整回下载三项，核对字节、摘要和安装包 SHA-512 后发布 Latest。17 项发布和模型合同、3 项分片传输测试通过。macOS 同 Tag 原生 arm64 构建并回下载 DMG、ZIP 和 latest-mac.yml。两个公开更新清单均返回 3.5.5，Mac 追加时 Windows 资产一致。[Apple Silicon 构建记录](https://github.com/T8mars/T8-penguin-canvas/actions/runs/44941971769)

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest-mac.yml | 536 | 3bd2b9a2e5323cf0bbc34c150667e0990110c1fa3bd0fcf4d9e310ab71681fe9 |
| latest.yml | 362 | 350dce44da9f901be46529f0f50fb76ac294292fe8fdc8cf198d4922c326ca9a |
| T8-PenguinCanvas-3.5.5-mac-arm64.dmg | 520056389 | efdbdf4653a8c7b07c371f76c50441af340deb229b2ba24cb9ee0de0f3e48459 |
| T8-PenguinCanvas-3.5.5-mac-arm64.zip | 511677310 | 54de417f833929c16ae8fdfd6ab7b4e6562e29c844031a07ba5d6db74eec8ec6 |
| T8-PenguinCanvas-Setup-3.5.5.exe | 1380164596 | 99af02a6613ac78de1445679bb08b2856431b2e5bbd49e94608b8535bdd3e0da |
| T8-PenguinCanvas-Setup-3.5.5.exe.blockmap | 1440005 | 01c0c3f65fbd85d0a247999daa32479374d669c76fed0be1d4e568510fec861a |

Mac 为 ad-hoc 签名预览，未经过 Apple 公证。用户现场、完整安装升级、最终 App 复验和 F8–F10 证据后补，严格进度保持 27/32。私有证据位于 `local-private/release-v3.5.5/`。
