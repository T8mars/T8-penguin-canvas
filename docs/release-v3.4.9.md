# v3.4.9 LowPrice 十图发布

2026-11-07完成用户授权的同源Windows/macOS发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.4.9)。正式源码、Tag与Release target固定为 709012e987da4cf992feec6bd83c9d3fe836591b，公开时间 2026-11-07T07:12:42Z；旧v3.4.8 Tag与六资产冻结。

## 功能与验证

既有图像节点的G2.6 LowPrice参考图由2张同步为10张；界面、前后端及Agent目录共用上限，保留顺序/重复槽位且十一张上传前拒绝。其余模型、1K/n=1及GIF参数不变，见[功能专题](g26-krea-hitem-meshy.md)。真实十图任务、完整下载解码及17项限定回归已通过；未重交已成功任务。另有10项发布合同检查通过。

Windows使用已校验Node22.23.0，完成唯一正式前端、后端及私有扩展加密、双运行时归档、native rebuild、NSIS、asar启动合同、provenance/sealed recovery、三资产完整回下载后公开Latest。正式包探针验证加密合同/上传器完整保留十张、十一张零上传、Agent目录与前端文案一致，并覆盖旧模型/恢复合同；全新TEMP数据库备份重开及真实存储关闭通过，外网请求0，不冒充完整画布或安装升级验收。

[Mac workflow 42350381819](https://github.com/T8mars/T8-penguin-canvas/actions/runs/42350381819)第1次成功：真实macos-15 arm64同源构建、ad-hoc签名、DMG/ZIP/清单验证、三资产追加及runner完整回下载。本机随后独立完整回下载六项资产，两个公开Latest更新清单一致；Mac追加前后Windows资产不变。实际构建成功，未因额度延期。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest-mac.yml | 536 | 336b2f7a8253be6851816bfdf6eb0a9b4f748cf26cf02d194e06e38c3b317d10 |
| latest.yml | 362 | 0bb7b06ae82bb3d991c8d6b745596973a0e6f32521bd229ec915aa3d6de71120 |
| T8-PenguinCanvas-3.4.9-mac-arm64.dmg | 519623303 | 7e85ad3e74d8aa3157b026e19c4657cd9a9398af4cbb50a4eebef2efc0e08860 |
| T8-PenguinCanvas-3.4.9-mac-arm64.zip | 511444564 | 42cb046ec60f5551fe41a421e90cb457d5e8f5ceeaf81b9b8e4022e8289bf7ee |
| T8-PenguinCanvas-Setup-3.4.9.exe | 1379942051 | be3f64af0eb4cacac638a5da54f512af42c61d7fa92114cfafbd67ae862fad8e |
| T8-PenguinCanvas-Setup-3.4.9.exe.blockmap | 1439395 | 43f9b76cca07752bdc7bad949fb8796a51065cbdd0b4c76c8c227870b9035c6b |

## 边界

私有证据在 local-private/release-v3.4.9/；根SKILL、凭据、私有扩展源不公开或打包。用户现场、安装升级与F8–F10按 owner-approved-post-release-v3.4.9 后补，严格27/32不变。十图GIF/完整画布的验收边界保留；Mac为ad-hoc未Apple公证预览，更新清单校验不等同用户现场升级。事实提交不移动Tag、不重建。
