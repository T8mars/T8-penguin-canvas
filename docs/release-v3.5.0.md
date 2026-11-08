# v3.5.0 画布与模型发布

2026-11-08完成用户授权的同源Windows/macOS发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.5.0)。正式源码、Tag与Release target固定为 e6aa414f6f9264cc7261cdbe8ac03ccdabe24725，公开时间 2026-11-08T03:58:47Z；旧v3.4.9 Tag和六资产保持冻结。

## 功能与验证

本版包含[五项画布反馈](user-feedback-20261108.md)与[模型/默认来源](core-model-refresh-20261108.md)：视频排序及关联音频、素材集上游同步、文本与输出@素材、独立输出拖动、分镜批量导入及图片绑定；图像分类下拉、Kling4分组与精确运行身份、七核心节点仅空白新建默认平价；G2.6 LowPrice高清/16图静态/文生GIF及两个独立Flash视频协议。

开发阶段213项和120项限定回归、18项隔离真实组件交互、9条真实生成任务完整下载与解码通过；两组回归范围有交集，不相加，也未重交通过的付费任务。本次26项发布/打包合同检查通过。素材上限、GIF及上游输出尺寸/时长差异以功能专题为准。

Windows使用已校验Node22.23.0，完成唯一正式前端、后端与私有扩展加密、双运行时归档、native rebuild、NSIS、asar启动合同、provenance/sealed recovery和三资产完整回下载后公开Latest。正式包探针覆盖加密七核心默认/旧配置保留、LowPrice16图与17图上传前拒绝、2k/4k/GIF、Flash与Kling精确身份、前端交互入口、全新TEMP数据库备份重开和真实存储关闭，外网请求0；不冒充完整App或安装升级验收。

[Mac workflow 42444923201](https://github.com/T8mars/T8-penguin-canvas/actions/runs/42444923201)第1次成功：真实macos-15 arm64同源构建、ad-hoc签名、DMG/ZIP/清单验证、三资产追加与runner完整回下载。本机随后独立完整回下载六项资产，两个公开Latest更新清单一致；Mac追加前后Windows资产未变。Mac实际发布成功，未因额度延期。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest-mac.yml | 536 | 6ccf607e25e0d6f2e2cdb6fb5edc7effb08a2bfa1240dec52858142e4ddf54a2 |
| latest.yml | 362 | adc8e6e3f4938d8acad649b27786834161a668abbbfff90377298f02f94e7aa8 |
| T8-PenguinCanvas-3.5.0-mac-arm64.dmg | 519692526 | 5b4a4c9e6997b475019dd1d871e20e00d74321599727d4276bfd95cb0bcb802e |
| T8-PenguinCanvas-3.5.0-mac-arm64.zip | 511458607 | 8be707a69af823bdbe380f5e8da44860ee8c6be18c3e62bc5dc89e4bf1dead51 |
| T8-PenguinCanvas-Setup-3.5.0.exe | 1379954122 | 79506a5db9b796fa462dcbd92e053aaaba051f1e5890d1664b593d7b700d3cc1 |
| T8-PenguinCanvas-Setup-3.5.0.exe.blockmap | 1438983 | a871d5b65ff72e0f6ab6d51d8e3caa9aeeac30103fa0f0bea8e6cb2df9818ace |

## 边界

私有证据在local-private/release-v3.5.0/；根SKILL、凭据和私有扩展源不公开或打包。用户现场、安装升级和F8–F10按owner-approved-post-release-v3.5.0后补，严格27/32不变。Mac为ad-hoc未Apple公证预览；更新清单校验不等于用户现场升级。事实提交不移动Tag、不重建正式包。
