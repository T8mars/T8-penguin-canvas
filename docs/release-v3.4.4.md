# v3.4.4 代码动画发布

2026-10-26按用户授权完成Windows和macOS同源发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.4.4)。正式源码、Tag peeled commit和Release target固定为`b5ad152c05800d7180a895aa21f21938e5348033`，公开时间`2026-10-25T17:42:47Z`。两个平台各唯一一次正式构建，Tag不移动；旧v3.4.3 Tag与六资产冻结。

## 范围与开发验证

新增独立代码动画节点：平价小屋标准版/Pro、十种风格、规格与高级参数、放大工作台、分镜、历史版本修订、原任务恢复及四份工作流。沿用共享Run账本、可信下载和稳定资产，停止等待/保存失败不重交付费POST。功能与验证边界见[开发专题](motion-video-development.md)。

开发专项、持久化/恢复/端口与相邻回归通过；完整生产App/Canvas在受控接口下操作生成、实际播放、修订、保存重开、停止/继续和12组主题/语言。此前四条真实创建/修订均下载解码，但Pro降级画面如实保留；不把服务成功当成画面质量全部合格。

## 正式包与自动更新

- 27项发布/打包合同检查通过。Windows唯一正式低资源链退出0，完成编译、后端/私有扩展加密、运行时归档、native rebuild、NSIS、11文件asar合同及provenance/sealed recovery。草稿三资产完整回下载、size/SHA-256/SHA-512与更新清单匹配后才公开Latest，恢复记录已清理。
- 正式包探针退出0：加密Motion协议、模型/有序结果/元数据/恢复GET、前端节点/工作台、既有Agnes/Moss/Agent接口、全新系统TEMP数据库保存备份重开和实际存储关闭通过。外网请求0；不是安装升级或完整正式包画布验收。
- [Mac workflow 40217823910](https://github.com/T8mars/T8-penguin-canvas/actions/runs/40217823910)第1次成功：真实macos-15 arm64、唯一正式构建、ad-hoc签名、11文件asar与媒体/DMG/ZIP/清单检查、资产保留和三资产追加/runner回下载通过；未因额度延期。
- 本机Windows与Mac六资产再次独立完整回下载，两个更新清单对应包的size/SHA-512与GitHub size/SHA-256一致；Mac追加后Windows元数据复核通过。Windows三资产ID/size/digest及旧v3.4.3 Tag/六资产未变。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `latest-mac.yml` | 536 | `abfe4b530c538755e6ff31a67a7057ffa37bd6c120441475d060e73665d59af1` |
| `latest.yml` | 362 | `d64dea7fd6149e94c14c8b510214e65877091a0662e28c25bfb07408c6150d8a` |
| `T8-PenguinCanvas-3.4.4-mac-arm64.dmg` | 519560697 | `ae7c6c5be9f655025c6fb0f5fcf4a39586781f4e357928baac716375c6ee7055` |
| `T8-PenguinCanvas-3.4.4-mac-arm64.zip` | 511335659 | `d397744873e8a55d00bb2d14441de859feb969cf4a626253fa0b6da2fd1da3cb` |
| `T8-PenguinCanvas-Setup-3.4.4.exe` | 1379836152 | `eb2ce1bf852da6af2a8a55917df7b75dd3e09d7c1118e840b90cd75c8f945401` |
| `T8-PenguinCanvas-Setup-3.4.4.exe.blockmap` | 1439193 | `bb613ddf5c46a69bcc64c98aa57e8115fc7495e6e917e00d34f39f68a4a95fac` |

## 证据与边界

私有证据`local-private/release-v3.4.4/`保存正式日志、探针、workflow、独立回下载和最终审计；开发及API研究分别见开发专题。根SKILL、私有证据、凭据不公开或打包。额度API404表示不可读，本次实际完成Mac构建。

真实用户现场、完整安装升级、所有规格/模板实网矩阵和F8–F10按`owner-approved-post-release-v3.4.4`后补，不标通过；27/32不变。Mac仍为ad-hoc未Apple公证预览，更新清单校验不等同安装升级已验收。
