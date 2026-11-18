# v3.5.4 模型扩展发布

2026-11-19完成用户授权的Windows/macOS同源发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.5.4)。正式源码、Tag及Release target固定为 83cbbcb7255682651f9a01e4ec5049b5da5d42e8，公开时间 2026-11-18T19:53:10Z；旧v3.5.3 Tag及六资产冻结。

## 功能与验证

本版包含[Kling Image、Mai 2.7与Qwen Audio 3.1](kling-image-mai27-qwen31.md)六个小屋模型、11份无密钥工作流及旧配置兼容。七条真实任务全部成功，六张PNG和三段音频完整下载解码；完整开发App十一条路径及49项专项/相邻回归通过。具体合同、失败记录和未覆盖组合见专题。

27项发布/打包合同、3项只读分片传输检查、能力同步与双语检查通过。Windows使用Node22.23.0完成唯一正式前端构建、后端/私有扩展加密、双运行时归档、native rebuild、NSIS、asar、provenance和sealed recovery。正式包实际执行六模型加密工厂、69/4音色、运行权威/目录、Kling组图、旧Mai/Qwen兼容、PCM双声道字节保真、原任务GET恢复，以及新建TEMP库备份重开和真实存储关闭探针；外网调用0。

Windows原发布器在草稿阶段完整回下载EXE、blockmap、latest.yml，校验整文件散列、字节数、GitHub digest、sealed recovery及EXE SHA-512后发布Latest。回下载仅使用已验证的只读传输适配器，固定本版Tag/源码及资产身份，8MiB分片、4并发、有界GET重试；未改产品发布器或用本地安装包代替远端下载。

[Mac workflow 44385277712](https://github.com/T8mars/T8-penguin-canvas/actions/runs/44385277712)第1次成功，从同一Tag在真实macos-15 arm64唯一构建、ad-hoc签名并追加三资产；runner原验证器完整回下载，核对size/SHA-256、ZIP SHA-512和清单。本机复核两端原日志、六资产指纹、两个公开Latest更新清单及Mac追加后的Windows元数据。Windows追加前后和旧v3.5.3 Tag/六资产未变。额度查询404/缺scope仅记未知，实际构建成功，未因额度延期。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest-mac.yml | 536 | 8f7d42107abdc0ae03102514250b20b0f24c17675c43b7caa68724fd281931c8 |
| latest.yml | 362 | c47c82653e3964d63a7341e2c592a316da3337d836e9c7a670379002c73897e0 |
| T8-PenguinCanvas-3.5.4-mac-arm64.dmg | 519913174 | 193cf261dd37ffd5a98c8f0a2292c905a802c22016f70b31ad34e66abea614d6 |
| T8-PenguinCanvas-3.5.4-mac-arm64.zip | 511638017 | 687f289f47deb71c30229c76cb8c14d871c792f484be3ff32488bfacd91a478e |
| T8-PenguinCanvas-Setup-3.5.4.exe | 1380126645 | d4f724895c6e728920c3b8b9467c77cc1896c0627a7e4f640284a0398ba8ae3d |
| T8-PenguinCanvas-Setup-3.5.4.exe.blockmap | 1439702 | 5f5edb34b1bf206f85eb53d35132156776afd4d4ddbcbd9f2366fdd05a40ee21 |

## 边界与证据

私有证据在local-private/release-v3.5.4/：windows-formal-node22.log、packaged-probe.json、mac-run.log、final-audit.json及public-updaters.json。根SKILL、私有源、配置和凭据不公开。用户现场、完整安装升级、受影响Mac和F8–F10按owner-approved-post-release-v3.5.4后补，不记为通过；严格27/32不变。Mac为ad-hoc未Apple公证预览。事实提交不移动Tag、不重建正式包。
