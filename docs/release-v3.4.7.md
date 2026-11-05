# v3.4.7 GPT Image 2.6 / Krea / Hitem3D 发布

2026-11-06完成用户授权的同源Windows/macOS发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.4.7)。正式源码、Tag与Release target固定为`12352cb7be9d8827723df9ef0b547a7100998b3c`，公开时间`2026-11-05T16:44:59Z`；旧v3.4.6 Tag与六资产冻结。

## 功能与验证

既有图像和3D节点新增五个Tab、十一款可用模型、GIF／SVG原文件及十六份工作流，见[功能专题](g26-krea-hitem-meshy.md)。十六条实网路径、全部GIF帧／SVG渲染／GLB网格，以及完整临时画布分场和组合通过；26项发布合同检查通过。画布外部HTTP为受控夹具，与实网证据分开。Meshy文生复测503无可用渠道，未启用。

Windows完成前端3061模块、后端与四个私有扩展加密、双运行时归档、native rebuild、唯一NSIS安装包、asar启动合同、provenance／sealed recovery、三资产完整回下载后公开Latest。加密包探针验证新模型合同、GIF／SVG、3D权威映射及GET恢复、前端能力与旧功能；全新TEMP数据库备份重开与真实存储关闭通过，外网请求0，不冒充安装升级验收。

首轮命令行Node26在原生依赖重建前因yargs模块兼容失败，尚未生成安装包／上传资产，失败日志保留。之后校验官方SHA-256并固定Node22.23.0，与Mac CI一致；相同源码及未封存恢复记录继续正式链，没有移动Tag或重复构建安装包。后续Windows发布工具链沿用该固定版本，不能修改生产Electron运行时来迁就构建器。

[Mac workflow 42067997263](https://github.com/T8mars/T8-penguin-canvas/actions/runs/42067997263)第1次成功：真实macos-15 arm64唯一正式构建、ad-hoc签名、DMG／ZIP／更新清单核验、三资产追加与runner完整回下载。实际构建成功，未使用额度延期。本机随后独立完整回下载六项资产，两个公开Latest更新清单匹配；Mac追加前后Windows资产不变。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `latest-mac.yml` | 536 | `f418efd3f6b23e85e98e663fd53e132c96eb54882d54d6ee7ebe82e328b8e79a` |
| `latest.yml` | 362 | `5aaa8fa95a5b8fd34bbd41053ce6756e6fbe6ef71d017680667a263d020454e7` |
| `T8-PenguinCanvas-3.4.7-mac-arm64.dmg` | 519691215 | `0d9732f5565a29a26c140b93be9dc598d51925b72f04ae3c710779e23ba749af` |
| `T8-PenguinCanvas-3.4.7-mac-arm64.zip` | 511443044 | `1ac1dbb86dc96572dd1de5dc1cde35bc419de3a52bdae05e626b5018988ccff3` |
| `T8-PenguinCanvas-Setup-3.4.7.exe` | 1379940303 | `241bb23e193988609c5e76266771550e1829ca966dda6f8857b3dd94b81930b3` |
| `T8-PenguinCanvas-Setup-3.4.7.exe.blockmap` | 1439166 | `0a3469de6e2fc67a7c89d23eb65372ef58d88fc72cdd128139cf63dab53c9913` |

## 边界

私有证据在`local-private/release-v3.4.7/`；根SKILL、凭据、私有扩展源不公开或打包。用户现场、安装升级与F8–F10按`owner-approved-post-release-v3.4.7`后补，严格27/32不变。Mac为ad-hoc未Apple公证预览；更新清单核验不等同用户现场升级。事实提交不移动Tag、不重建。
