# v3.4.5 Kling 4发布

2026-10-27按用户授权完成同源Windows/macOS发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.4.5)。正式源码、Tag与Release target固定为`751c66be3faa5a66a7bc9cb9baefca8acb841fbe`，公开时间`2026-10-27T04:54:49Z`；旧v3.4.4 Tag与六资产冻结。

## 功能与验证

原有视频节点的Kling中增加五个Kling 4模型，旧默认不变；主体/音色ID输出与连接复用、原任务GET续查、八份无凭据工作流，见[开发专题](kling-v4.md)。六条真实API成功且视频/试听完整下载解码；133专项/相邻回归、完整临时开发画布与28项发布检查通过。画布外部HTTP为夹具，与实网证据分开；提供商videoId建音色未实网验收。

Windows唯一正式低资源链退出0：正式编译、后端/私有扩展加密、运行时归档、native rebuild、NSIS、11文件asar合同、provenance/sealed recovery；草稿三资产完整回下载核对size/SHA-256/SHA-512与更新清单后公开Latest。正式加密包探针通过Kling 4合同/模型/恢复GET/前端、既有能力、全新TEMP数据库备份重开与实际存储关闭；外网请求0，不当作安装升级验收。

[Mac workflow 40452372828](https://github.com/T8mars/T8-penguin-canvas/actions/runs/40452372828)第1次成功：真实macos-15 arm64、唯一正式构建、ad-hoc签名、DMG/ZIP/清单检查及三资产追加/回下载。额度API404仅代表不可读，本轮没有额度延期。

本机独立完整回下载六资产与两个更新清单通过；Mac追加前后Windows三资产ID/size/SHA-256不变，旧v3.4.4 Tag/六资产不变。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `latest-mac.yml` | 536 | `c7fa9527f944e4fdcde000e1a2d094e3a96aa35eecb936f4450c7c1449b9b4db` |
| `latest.yml` | 362 | `16348961c99ea0bd72c38fbb37971823a86ef5324a9237ef6814d37b8a02d863` |
| `T8-PenguinCanvas-3.4.5-mac-arm64.dmg` | 519583733 | `462c611ec3deff69dcc184348c6e6422119b0ffab07eabf0f89f5217da806fc2` |
| `T8-PenguinCanvas-3.4.5-mac-arm64.zip` | 511371601 | `3cb0acffd853f6e0d908894ec848b83a00eecf7e3d97582cd9bdfefaf07baf87` |
| `T8-PenguinCanvas-Setup-3.4.5.exe` | 1379870673 | `a7bbd3fbbf2544c1ed7f9e13681b9ecfb569ae7d58ba96653c4f6ac9c2fdf67f` |
| `T8-PenguinCanvas-Setup-3.4.5.exe.blockmap` | 1439610 | `19bf2177b1e1b139e564c03659aaf5d58128029491b3fe7ed4ea61ef83c89f52` |

## 证据与边界

私有证据`local-private/release-v3.4.5/`保存构建、正式包探针、workflow、回下载和最终审计；开发证据见专题。根SKILL、私有证据和凭据不公开或打包。

真实用户、安装升级、全部规格实网矩阵及F8–F10按`owner-approved-post-release-v3.4.5`后补，不标通过；27/32不变。Mac仍为ad-hoc未Apple公证预览；更新清单一致不代表用户现场升级已验收。两个平台正式包各只构建一次，事实提交不移动Tag、不重建。
