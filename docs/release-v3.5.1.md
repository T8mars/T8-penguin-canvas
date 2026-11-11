# v3.5.1 模型与小屋入口发布

2026-11-12完成用户授权的Windows/macOS同源发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.5.1)。正式源码、Tag与Release target固定为 b10d3667b360894e184bbae101aa7c4b8873aafd，公开时间 2026-11-11T15:52:42Z；旧v3.5.0 Tag及六资产冻结。

## 功能与验证

本版包括[Tripo 3D](tripo-3d.md)25模型/25工作流、[Seedream 5.5与草稿转高清](seedream55-draft.md)8模型/8工作流、[H3/Turbo](h3-turbo.md)3模型/6工作流及[顶部小屋入口](zhenzhen-cottage-promotion.md)。原有模型、默认值和已保存配置保留。

开发实网和限定回归按各专题保留，不重复已成功付费任务，也不把重叠回归相加。发布前临时Electron加密探针复现MJS的Unexpected token export，已补构建期CommonJS转换、受控相对懒加载和双平台合同完整性门。本次28项发布/打包合同测试通过。

Windows使用已校验Node22.23.0，完成唯一正式前端构建、后端/私有扩展加密、双运行时归档、native rebuild、NSIS、asar检查、provenance与sealed recovery。正式包实际调用三个加密工厂，覆盖H3图像/视频、5.5/草稿、Tripo25目录及旧模型合同；全新TEMP数据库备份重开和真实存储关闭通过，外网调用0。不冒充完整App或安装升级验收。

[Mac workflow 43052780828](https://github.com/T8mars/T8-penguin-canvas/actions/runs/43052780828)第1次成功，真实macos-15 arm64从同一Tag构建、ad-hoc签名、验证DMG/ZIP/清单并追加三资产、runner完整回下载。本机独立完整回下载六资产，两个公开Latest更新清单一致，Windows追加前后及旧v3.5.0资产/Tag未变。实际成功发布，未因额度延期；额度API404/缺scope仅记录为未知。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest-mac.yml | 536 | 80596fcc974ddccf8d7002d85c41daa8c437d975aff637212feb6c3d95b33ebe |
| latest.yml | 362 | fbe0b4a2c0e3d5fb536e98563a2edc18952e2558ac64a7fa70717dfbfba0b205 |
| T8-PenguinCanvas-3.5.1-mac-arm64.dmg | 519805018 | 654fde3b77287c1a395244d0298ab2630310a027213ec07bb2542dd8cf6c6e3d |
| T8-PenguinCanvas-3.5.1-mac-arm64.zip | 511577488 | 6217f45db3eafbfa12f8107ebf78164440f4b1b63683440e9a8fa6a473250618 |
| T8-PenguinCanvas-Setup-3.5.1.exe | 1380068266 | fe8babe5120dca1dc410c1fe9cb2bc79fd29f138c80d3ee303cf9a5b6d616654 |
| T8-PenguinCanvas-Setup-3.5.1.exe.blockmap | 1440269 | 1d647125a4c865ad9043b69970d2afff5303dbd8755d9601a11887a3f60f2742 |

## 边界

私有证据在local-private/release-v3.5.1/；根SKILL、私有源、用户配置和凭据不公开或打包。H3完整App功能断言通过，但严格退出回执因测试Job中的SGTool/SogouCloud辅助进程收尾失败，仍不计通过；未修改系统输入法或放宽资源门。用户现场、安装升级与F8–F10按owner-approved-post-release-v3.5.1后补，严格27/32不变。Mac仍为ad-hoc未Apple公证预览。事实提交不移动Tag、不重建正式包。
