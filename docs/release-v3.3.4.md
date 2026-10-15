# v3.3.4 画布体验与平价模型发布

2026-10-15，用户明确授权更新根手册、features、Electron 打包、GitHub 新版本及自动更新 Release；外部证据后补，Mac 仅 GitHub 额度不足可延期。版本按3.3.3→3.3.4递增。

## 范围与发布前事实

- 包含[画布体验增强](artcraft-canvas-ux.md)：素材灵感板、保留编辑版本、按需编辑器、独立本地3D世界节点及非破坏性Story草稿；另包含[节点清晰度与平价香蕉/豆包四模型](nb-lowprice-doubao.md)及九份无凭据工作流。
- 参考输入说明UI由用户排除，在线世界生成由用户明确搁置；不新增相关Key入口、付费生成或轮询。原有来源、旧节点、稳定资产/运行身份及网格预览保留。
- 画布体验142/142限定用例、实际开发App/Canvas/后端/新建SQLite保存重开、28组主题和窄屏检查通过；三个512MiB严格类型分组通过。旧的合并512MiB及全项目768MiB堆耗尽保留为失败，不抹除；本轮正式链全量TypeScript/Vite已通过。
- 四模型已有8/8真实任务与完整产物解码；节点清晰度672组生产样式检查通过，不重复付费调用，也不冒认为用户显卡或安装版证据。
- 仅为缺失的外部证据清单启用精确版本 `owner-approved-post-release-v3.3.4`。过期、损坏、不匹配证据仍拒绝；27/32和F8–F10状态不变。
- Windows固定源码推送后只执行一次正式构建链；保留加密、私有侧车、运行时、NSIS、asar、provenance、恢复与远端完整下载检查。旧Tag和资产冻结，事实补记不移动正式Tag或重建。
- Mac使用同正式Tag的真实macos-15 arm64工作流，仍为ad-hoc未公证预览。额度查询404/缺scope只代表无法查询，不能据此延期；实际工作流结果另记。

## 发布完成

- 固定源码、正式annotated `v3.3.4` Tag的peeled commit及Release target均为 `ca2d49f2d3f320214c50d7d89053e6d9221da0b1`；后续仅补记发布事实，不移动Tag或重建安装包。
- [GitHub Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.4)于2026-10-15 19:11:49（北京时间）发布，非草稿、非预发布，为Latest。Windows与Mac进入同一个Release。
- Windows唯一正式`dist:release`链exit0：单核BelowNormal、有限3GiB堆、零压缩、独立临时目录及系统7-Zip；全量TypeScript、3022模块Vite、加密后端/私有侧车、双运行时、native rebuild、NSIS、9文件asar合同、provenance、sealed recovery、上传、发布前完整回下载及发布后Latest检查均通过，正式恢复暂存已清理。旧的低内存检查失败记录保留，不改写为通过。
- 实际`win-unpacked`程序包内probe通过：84节点共享schema、world-scene、四模型、懒加载chunk及加密Provider存在；合成无网络请求检查通过。仅新建临时库完成备份、名称、重开及正常关闭，event-loop ticks=118。没有触及用户/历史数据库，不代表安装用户或GPU验收。
- 真实macos-15 arm64 [workflow 38725662348](https://github.com/T8mars/T8-penguin-canvas/actions/runs/38725662348)成功，从同一Tag完成原生依赖、6/6合同（本地31项的子集，不相加）、构建/加密、Mach-O与媒体/签名检查、DMG/ZIP/清单、追加上传及runner完整回下载。本机随后独立完整下载Mac三资产。仍为ad-hoc未公证预览，本轮未因额度延期。
- Windows发布后独立完整下载三资产通过；Mac追加后再次用本地原始字节与GitHub metadata复核，并确认Windows原ID/size/digest完全不变。六资产都已有独立完整回下载证据，两个更新清单匹配对应文件size/SHA-512。
- 旧v3.3.3的target、Tag及六资产ID/size/digest与发布前快照一致。GitHub未开启服务端immutable Release，项目发布器执行禁止覆盖，不能称服务器强制不可变。

## 六资产

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.3.4.exe` | 1379714079 | `8bb8836e7315f2fb82d0565bbf413ee29d012924545ad380f23654cf97aa4bdc` |
| `T8-PenguinCanvas-Setup-3.3.4.exe.blockmap` | 1439366 | `042074336ecfbccfe9eec0830999b8b2baf3aa45277621b8ba0190e6ecf78dbd` |
| `latest.yml` | 362 | `4b7909683e901446e85f2eb576df531ae83b64a5de80ec65878b336226ceb8dd` |
| `T8-PenguinCanvas-3.3.4-mac-arm64.dmg` | 519501266 | `9dec8bfa2c8d5adcba1d705a1c990b00ced41f00f4fe5f66a107b3b1dbed1ca3` |
| `T8-PenguinCanvas-3.3.4-mac-arm64.zip` | 511207493 | `c7ea78f11d49c4c68c0a3427a9e0f6db3ccdf20a4453221ffc2be0509d4ef953` |
| `latest-mac.yml` | 536 | `f93f7074b8183e492193151bf1c0303eecc271844cc1376b45dbf6feea1768c9` |

## 证据与未覆盖范围

ignored `local-private/release-v3.3.4/`：[Windows正式链](../local-private/release-v3.3.4/windows-formal.log)、[包内probe](../local-private/release-v3.3.4/packaged-probe.log)、[发布合同31/31](../local-private/release-v3.3.4/packaging-tests-final2.log)、[Windows独立完整下载](../local-private/release-v3.3.4/windows-independent-verify.log)、[Mac工作流日志](../local-private/release-v3.3.4/mac-workflow.log)、[Mac独立完整下载](../local-private/release-v3.3.4/mac-independent-verify.log)、[追加后Windows复核](../local-private/release-v3.3.4/windows-after-mac-metadata.log)、[最终资产及旧版冻结](../local-private/release-v3.3.4/final-assets.json)。证据、私有源码和构建中间物不公开或打包。

发布合同最终31/31通过。此前两次30/31失败日志保留：旧测试固定83节点，以及新增测试误把schema对象数组按字符串数组断言；现精确检查84个节点及world-scene对象存在，未放宽完整性门。Actions的Node20迁移与arm64容量提示未导致本次工作流失败，不顺带升级无关CI依赖。

安装升级、受影响用户、实体GPU、大型真实场景、真实RH及F8–F10仍后补，不记通过；在线世界生成继续由用户明确搁置。
