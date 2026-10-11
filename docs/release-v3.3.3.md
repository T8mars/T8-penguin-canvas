# v3.3.3 Mai 图像发布

2026-10-11，用户明确授权更新手册、features、Electron 打包、GitHub 新版本及自动更新 Release；证据后补，Mac 仅 GitHub 额度不足可延期。十进制序列 3.3.2 → 3.3.3。

## 范围与发布边界

- 平价小屋图像节点新增 Mai Tab，包含 `mai-image-2-6`、`mai-image-2-6-flash`。精确参数、有序参考图、原任务恢复、历史及六份无凭据工作流见[功能专题](mai-image.md)；原模型、默认来源、旧节点、端口和数据库不变。
- 已有六条真实任务全部成功，PNG 完整下载解码；135/135 专项回归、49/49 后端检查、TypeScript、双语和能力同步通过。本轮不重复付费生成。
- 本轮只对不存在的外部证据清单启用精确 `owner-approved-post-release-v3.3.3` 例外；损坏、过期、不匹配的证据继续拒绝。安装升级、浏览器端到端、用户现场及 F8–F10 后补，不记通过。
- 正式 Windows 链只执行一次，必须完成加密、私有功能、运行时、NSIS、包内检查、provenance、固定 Tag/target、Latest、更新清单和完整远端回下载；旧 Tag/资产冻结。事实补记不移动 Tag 或重建。
- Mac 必须使用同正式 Tag 的真实 `macos-15` arm64 构建，仍为 ad-hoc 未 Apple 公证预览。额度接口无权限或 404 只说明无法查询，不能当作额度不足；实际工作流及资产校验结果另行记录。

## 发布完成

- 固定源码、正式 annotated `v3.3.3` Tag 的 peeled commit 及 Release target 均为 `6ec546a248b8ec601be69a1853c57b1a966b0d92`；后续仅发布事实提交，不移 Tag、不重建包。
- [GitHub Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.3.3) 于 `2026-10-11T10:59:20Z` 发布，非草稿、非预发布且为 Latest；Windows 与 Mac 进入同一 Release。
- 版本、lock、README、features、根私有手册、当前上下文、Release notes、Mac 默认输入及版本级证据门已同步。27/27 Electron/双语/Mac 合同、4/4 版本级证据门、TypeScript、能力/双语/RH/预算和公开边界检查通过。
- Windows 唯一正式 `dist:release` 链 exit 0：单核 BelowNormal、有限 3 GiB 堆、零压缩、独立临时目录及系统 7-Zip；完成前端、加密后端/私有功能、已校验双运行时、native rebuild、NSIS、9 文件 asar 合同、provenance、sealed recovery、上传、发布前完整回下载和发布后 Latest 检查。恢复暂存已由正式链清理。
- 实际 Windows `win-unpacked` 程序的包内 probe 通过：加密 Mai 合同/两模型前端存在，普通与 Flash 请求形态正确；仅新建临时数据库备份、重开、名称与正常关闭通过，event-loop ticks=68。没有网络生成，也不冒认为安装用户/UI 验收。
- 真实 `macos-15` arm64 [workflow 38133936134](https://github.com/T8mars/T8-penguin-canvas/actions/runs/38133936134) 成功，从同一 Tag 完成原生依赖、6/6 合同测试（本地 27 项的子集，不相加）、构建/加密、9 文件 asar 合同、媒体 JSON probe、ad-hoc 签名、DMG/ZIP/清单、追加上传及 runner 完整回下载。无 Apple Developer ID、公证；额度查询 404/缺 scope 仅表示无法查询，本轮实际正常发布，未延期。

## 六资产与独立回下载

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.3.3.exe` | 1375987497 | `ea0e8b9de48f56a7dc9a872df125442d994c4c814c1046aa1ea711cfbf87c927` |
| `T8-PenguinCanvas-Setup-3.3.3.exe.blockmap` | 1435006 | `79b61a5089792131527043e477e593cbe992211bf5c758d5275dd7ef640dba3e` |
| `latest.yml` | 362 | `305120ae6d51be6423b6e1058044bbcdbf6a4d639bb0876f5465c11c8ccbc416` |
| `T8-PenguinCanvas-3.3.3-mac-arm64.dmg` | 514614171 | `95e02f475b4c3798f69e371ddf9f3ebaa4b1b8b0adde286d10d1cd62875551aa` |
| `T8-PenguinCanvas-3.3.3-mac-arm64.zip` | 506585107 | `c0f1fbafe1e668f239c13bb0a7dbe0bad4480c3bac6ba399d36541cc3fd8ee8e` |
| `latest-mac.yml` | 536 | `22363a2463102688b5f5e539c58afbbea1e57c75159782019b26df8032406dd1` |

本机独立完整下载六资产，逐项核对 GitHub size/SHA-256；`latest.yml` 的安装包与 `latest-mac.yml` 的 ZIP 均匹配 size/SHA-512，版本为 3.3.3。Mac 追加前后 Windows 三资产 ID/size/digest 未变；前版 v3.3.2 的 target、Tag 与六资产 ID/size/digest 也未变。GitHub 未启用 immutable Release，本项目发布器按禁止覆盖执行，不能声称服务端不可变。

独立下载曾在并行尝试中遇到 `unexpected EOF`：Mac ZIP、Windows 追加后下载未完成，当次日志保留且不算通过。随后分别新建目录串行 GET 复核，Mac 与 Windows 均 exit 0；没有重交生成、重建安装包或覆盖远端资产。Actions 的 Node 20/24 迁移与队列提示未导致本次工作流失败，未顺带升级 CI 依赖。

证据集中于 ignored `local-private/release-v3.3.3/`：[正式 Windows 链](../local-private/release-v3.3.3/windows-formal.log)、[包内 probe](../local-private/release-v3.3.3/packaged-probe.log)、[Mac 工作流日志](../local-private/release-v3.3.3/mac-workflow.log)、[Mac 独立串行复核](../local-private/release-v3.3.3/mac-independent-verify-serial1.log)、[Windows 追加后独立串行复核](../local-private/release-v3.3.3/windows-final-independent-verify-serial1.log)、[最终资产及旧版冻结快照](../local-private/release-v3.3.3/final-assets.json)。失败日志保留为 `mac-independent-verify.log`、`windows-final-independent-verify.log`；不公开凭据、私有源码、用户数据库、输入输出、真实任务身份或构建中间物。

外部边界不变：安装升级、完整浏览器端到端、用户现场与 F8–F10 后补，不因打包、包内 probe 或下载校验通过而勾选。
