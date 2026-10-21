# v3.4.1 自动更新关闭传输补修

2026-10-21用户明确授权本版手册/features、Electron打包、GitHub源码/Tag及自动更新Release，现场证据后补，Mac仅额度不足可延期。固定源码、annotated Tag的peeled commit与Release target均为`7d05f7ab1615a983afe9a84bf4ff167be150b3d7`；[正式Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.4.1)于`2026-10-21T06:16:59Z`公开为非草稿、非预发布Latest。Tag不移动，正式包不重建。

## 修复与边界

- CanvasCloseGuard同步标记saving/closing；保存ACK后停止新API请求及后台状态探测，跨越ACK的迟到探测不再触发断线恢复。saving仍允许原CAS完成，已接受请求不取消，拒绝/取消关闭恢复访问。
- 保留真实存储关闭回执、15秒加105秒有界等待、失败只读面板/日志导出/显式重试；安装器不强杀。模型、节点、Agent权限、运行账本及旧画布合同不变。
- 旧3.3.7现场已按单独授权备份/结束并手动安装3.4.0；不把它算作旧进程正常自动更新退出。旧测试端口隔离缺口和现场限制完整保留在[补修专题](auto-update-close-hold-20261021.md)。

## 实际验证

- 发布前51/51（47专项/相邻及4发布门）与22/22双平台打包合同通过；类型检查、3032模块生产编译、双语5152键、能力39/319/84及公开/凭据/保护文件/预算门通过。原生7/7含重复5项，不累加；两项实际Electron/临时SQLite/更新器验证传输门、关闭/重开及正常退出。
- 本版唯一Windows正式链退出0：单核BelowNormal、有界3GiB堆、私有双侧加密、运行时、native rebuild、NSIS、11文件asar合同、provenance、sealed recovery；草稿三资产完整回下载后才公开，恢复记录已清理。
- 正式加密包在全新系统TEMP完成原生模块/活动定位/九字段兼容/同版本工具修复及临时库保存、备份、重开、完整存储关闭；网络请求0，未接触用户库或真实工具目录。包内新传输门代码存在。
- 完整编译Canvas、冻结main/preload和加密后端经隐藏Electron运行三个独立随机端口场景：延迟完成自动续装`300f28bd7c3745488bc88a46f8fa51ab`；完整120秒超时、显示日志/重试后仅原writer完成续装`3dd7dffb6bc140f7ab0dd84e47dee64f`；真实409冲突拒绝更新、撤除遮罩、双方内容保留`b94834a97c1149a189ca8e165b830371`。前两项跨完整15秒探测周期新后台健康请求为0；三场正常退出、强制清理0、残留0。测试NSIS只有TEMP标记，不安装产品、不改注册表。
- 首次全包探针`31d8e67542ad448e9b04a76f82711de6`因测试观察脚本返回函数，Electron无法克隆返回值而失败，未计通过。修正仅添加`void 0`，先以ignored同目录夹具复验，资源限制/随机端口/生产函数不变；永久验证器与通过版本逐字节一致。该测试工具不进入分发包；后续事实提交纳入一行测试修正，不改产品源码、不移动Tag、不重建。失败报告保留，四场自建临时库与包装目录均已清理。
- 同正式Tag的[Mac workflow](https://github.com/T8mars/T8-penguin-canvas/actions/runs/39554486792)首次真实macos-15 arm64构建、ad-hoc签名、Mach-O/媒体/DMG/ZIP/清单检查、资产保留及追加上传完成；实际整体结论为`success`。Windows三资产和Mac三资产均独立完整回下载，GitHub size/SHA-256和两个清单size/SHA-512一致；Mac追加前后Windows及旧v3.4.0 Tag/六资产不变。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.4.1.exe` | 1379777435 | `279ce8b38a40dcb5b00d298e73c8915c021a957f26bc76e63cf143c50b0467b4` |
| `T8-PenguinCanvas-Setup-3.4.1.exe.blockmap` | 1439420 | `69143a8cc45fb7bf8cc281daf6d9e1a7e64bb729be613f4d1ce5590a45b0a0fd` |
| `latest.yml` | 362 | `3005d088cfcf0644d4815406c4b135ebd42d21414460d5aa85f18164379b6176` |
| `T8-PenguinCanvas-3.4.1-mac-arm64.dmg` | 519460791 | `2121595a05a09cb0bc03990b6d1ef53c51ae242d18e6022dc699c59a6fa9bb76` |
| `T8-PenguinCanvas-3.4.1-mac-arm64.zip` | 511273894 | `dcc327bdf54a8193435e73812043505ffbeee6684acd0b5aaf170406c21b62a9` |
| `latest-mac.yml` | 536 | `48c79b6320550fe238dd63a4f4f135d5c2f6a70e40053835d718aa312ec5d52a` |

## 证据与未验收

私有`local-private/release-v3.4.1/`保留正式链、51项回归、22项合同、加密包探针、三场完整画布日志、Windows/Mac独立回下载、Mac workflow、六资产快照和最终审计。完整画布报告在`local-private/update-full-app-20261021/<场景ID>/`，独立退出回执在`artifacts/history-low-load-runner/<场景ID>.json`；所有私有证据不公开或打包。根手册已更新，保持ignored。

仅本版接受`owner-approved-post-release-v3.4.1`后补：完整受影响用户现场自动升级、真人配对、实体设备及F8–F10未验收，严格进度仍27/32。Mac已发布但仍ad-hoc未Apple公证；额度接口404/缺scope未当作额度不足，本轮未延期。已卡住的旧进程不会被下载包热修复，须先保存/导出修改并正常退出后安装完整包，勿删除用户数据。
