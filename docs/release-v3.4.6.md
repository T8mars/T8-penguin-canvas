# v3.4.6 Hunyuan / Muse / Flux 发布

2026-11-01完成用户授权的同源Windows/macOS发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.4.6)。正式源码、Tag与Release target固定为`f19cb56b284c3a8021d1038bcb1404723fc8ed3d`，公开时间`2026-11-01T09:02:27Z`；旧v3.4.5 Tag与六资产冻结。

## 功能与验证

既有图像/视频新增七个平价小屋模型、三个Tab和十一份无凭据工作流，旧Flux及其他默认保留；Motion Video按新文档复核并重测标准版，见[功能专题](preview-muse-flux.md)。十一条实网生成、下载、完整解码成功；130项专项/相邻回归、完整临时开发画布及26项发布检查通过。完整画布外部HTTP为受控夹具，与实网分开；未扩大Pro/修订或全部规格的实网验收范围。

Windows唯一正式低资源链退出0：前端3055模块、后端及私有扩展加密、双运行时归档、native rebuild、NSIS、asar启动合同、provenance/sealed recovery；草稿三资产完整回下载匹配size/SHA-256/SHA-512与清单后公开Latest。正式加密包探针验证新图像合同、Muse视频/GET恢复、前端及旧Kling/Agnes/Moss/Motion/Agent能力；全新TEMP数据库备份重开和真实存储关闭通过，外网请求0，不冒充安装升级验收。

[Mac workflow 41287192858](https://github.com/T8mars/T8-penguin-canvas/actions/runs/41287192858)第1次成功：真实macos-15 arm64唯一正式构建、ad-hoc签名、DMG/ZIP/更新清单检查、三资产追加及runner完整回下载。实际构建成功，未使用额度延期。

本机独立完整回下载六项资产、两个自动更新清单通过；Mac追加前后Windows资产ID/size/SHA-256不变，旧v3.4.5 Tag及六资产未变。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `latest-mac.yml` | 536 | `0952c75452bada0f15c54ec66d8e6f3d8767fb691f9d9fab008908714ce926fb` |
| `latest.yml` | 362 | `fa7126129ce7f5db70058ac6400121cbdc4f5b51a889b70b1996eb5e94fc4079` |
| `T8-PenguinCanvas-3.4.6-mac-arm64.dmg` | 519633123 | `6de4b2abbf902f3496b369fc9fb064cda90cd494272da18c1e6baf92db99d7c3` |
| `T8-PenguinCanvas-3.4.6-mac-arm64.zip` | 511397307 | `009a47d49358eb11aefc1d6395467c06a1dc7374c98ebdc3d84806335dc32c8f` |
| `T8-PenguinCanvas-Setup-3.4.6.exe` | 1379895146 | `54f363da233fd240e0cbcca6e792f69f1932031056d9a5f6ce29ef647aaf03a3` |
| `T8-PenguinCanvas-Setup-3.4.6.exe.blockmap` | 1439299 | `271cdbb5eabe697d1155ca677b08058e84f563b142d2d41fc3a936a1168608dc` |

## 证据与边界

私有证据`local-private/release-v3.4.6/`保存构建、探针、workflow、独立下载与最终审计；开发证据见功能专题。根SKILL、私有证据与凭据不公开或打包。

用户现场、安装升级、全部规格实网及F8–F10按`owner-approved-post-release-v3.4.6`后补，不记通过；27/32不变。Mac为ad-hoc未Apple公证预览；更新清单验证不等同用户现场升级验收。两平台正式包各只构建一次，事实提交不移动Tag、不重建。
