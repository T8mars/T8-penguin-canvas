# DSH 原生接入：画布侧接管结果（未发布）

2026-10-20。画布 Agent 已审核并采用交接中的现有源码改动，没有重新应用备份
补丁或覆盖工作区。本轮只开发和限定验证；没有升级版本、生产构建、推送、
Tag、Release 或修改安装版。正式版本仍为 3.3.6，已发布 Tag/资产冻结。

## 范围与采用记录

- 目录 `E:\PenguinPravite\T8-penguin-canvas`，分支
  `codex/release-v3.0.8-volcengine-assets-ux`，基线 HEAD
  `e6702dc7770bcbe7d4895be22a06f4c7123a085b`，common dir `.git`。
- 开工时 staged/unmerged 为零，工作区恰为交接的 38 项；保护文件摘要正确。
  逐项按 LF 规范化核对备份 manifest。未改动其中的 CLI 实现或生成产物。
- 采用：安装资源兼容路径、实例发现窗口、凭据并发事务、单次运行计划、审批/
  RunIntent GET 恢复、已保存素材的导入/放置恢复、metadata.size 和精确摘要查询，
  以及 Seedance 模糊受理后的写入不重放边界。实现说明分别见
  [发现](zcanvas-instance-discovery.md)、[存储](zcanvas-secure-store-transactions.md)、
  [运行](zcanvas-run-approval-recovery.md)、[素材](zcanvas-saved-media-transfer.md)、
  [重放](seedance-write-replay-boundary.md)。
- 本轮进一步修订 `agentControlAssets.js`、`agentControlRuns.js` 和
  `routes/agentControl.js`，新增 `tests/agentControlDshContract.test.cjs` 及本文。
  features/current-context 只增加短索引。源码检查点仅包含审核的40个文件，
  不包含私有证据或生产发布；精确文件与散列保留于本机证据。
- 本地源码提交 `3f6a483bdf895cbd0768c9f692aeba2c53525a96`；后续文档事实收口
  不改变API/CLI或测试源码，未推送。提交核对记录为本机 `checkpoint.json`。

## 本轮确认并修复的两处问题

1. **能力声明与实际限额不一致**：原生导入遵循配置，但 status 将上限截为
   2 GiB；配置为 3 GiB 时错误报告 2 GiB。状态和导入现在复用
   `assetImportMaxBytes()`，不调整用户配置或上传器的配额/权限。HTTP 回归先红后绿；
   不分配巨型测试文件，也不把这一检查当成 3 GiB 实际上传验收。
2. **无效操作标识进入审批队列**：短/超长/空白/含路径符号的运行 operationId
   原先能生成审批，批准后才在提交时失败。开始、重试、提交及查询现在共用
   `requireRunOperationId()` 的既有格式合同，提交审批前拒绝。真实开始路由回归
   先复现 202、修复后 400 且待批队列/意图写入均为零；没有放宽生成权限。

## 交付合同

`/api/agent-control/v1/status` 的原 compat 字段不变；新增可选标记：

- `runControl.schema = t8-agent-run-control-v1`：单计划单操作、操作/审批查询。
- `assetControl.schema = t8-agent-asset-control-v1`：审批/摘要/Patch 查询及实际导入限额。

以下路径均相对于 `/api/agent-control/v1`；作用域参数为 projectId/canvasId：

| GET | 权限与披露范围 |
| --- | --- |
| `run-start-approvals/by-operation/:operationId` | run:execute；原 session/action/项目/画布，未过期且未替代 |
| `run-intents/by-operation/:operationId` | run:read；原 actor/项目/画布，经既有 inspect，不依赖内存计划 |
| `asset-import-approvals/by-operation/:operationId` | asset:transfer；原 session/action/项目/画布 |
| `asset-place-approvals/by-operation/:operationId` | asset:read + canvas:write；原 session/action/项目/画布 |
| `assets?contentHash=<64位小写SHA256>` | asset:read；精确项目过滤，返回项目/画布/revision |
| `patches/:patchId` | canvas:read；只给最小应用回执，不给请求摘要、秘密或完整变更 |

原权限检查、原生窗口审批、RunIntent → Run → NodeRun → Attempt → Provider
权威链与 secureStore v1/DPAPI 均保留；不新增任意写入工具、私有付费账本，
不开放付费 Auto review。task_id/受理不明后只查询，不重发生成。

### 精确兼容与 CLI

本轮实测 CLI 根目录：`E:\PenguinPravite\T8-penguin-canvas\tools\zcanvas-cli`。
DSH 原 `inspectCanvasCli()` 整树字节摘要（与交接相同）：
`8a474a98bf33797018df9fe7fa9126ca55891100e64c87f91885bfc65b81b110`。

| 字段 | 当前源码值 |
| --- | --- |
| skillVersion / cliVersion | `0.1.0-dev` / `0.1.0-dev` |
| controlProtocol / canvasPatchProtocol | `t8-agent-control-v1` / `t8-canvas-patch-v1` |
| nodeSchemaDigest | `46eb5e5bd55a7616fe0dda868b20a7c648e059e6fe1c75b43979d83f6072e71c` |
| providerCatalogDigest | `00dc6ba277f0937123ad7695c01a473a733df8b3d7890f4e7f9fe33e685edf5d` |
| creativeCapabilityManifestDigest | `569f2c8be144e05120ca629b2826383a06c4d6565ab3896c2dc61807bb9f7c27` |
| creativeCapabilityGraphDigest | `359ced64c902ed4550e52487375d8a7f886f906f1b172b96be737aa72591043b` |
| manifestDigest | `34a501f6900953f6986075d8acc5ae7f7c59093d9dc2a7a8bd3980dbdb75c8f7` |

官方生成器检查通过：39 高层能力、319 运行目录项、84 节点；工具目录中
73 个可直达 L0 操作（完整能力图 L0 总数115，二者统计口径不同）。
以上只指开发源码，不是给已安装 CLI 自动改 pin 的许可；运行中的旧信任记录
须在 DSH 连接界面显式重新审阅，不能手改兼容摘要或覆盖安装目录。

## 验证与证据边界

本机证据保留于 `local-private/dsh-native-review-20261020/`，不公开打包。

| 检查 | 本轮结果 / 证据 |
| --- | --- |
| 交接的 16 文件 77 项 | 首次重新执行 77/77：`adoption-tests.log` |
| 最终 21 个 CJS 文件 | 99/99，串行 Electron Node20、768 MiB 堆：`closure-tests.log`；包含前述77项与前轮98项，不能重复相加 |
| `tests/seedanceNzProvider.test.ts` | 65/65，原 Electron TS loader：`provider-tests.log`；与99项不重叠 |
| `tests/assetUploadManager.test.cjs` | 单独执行29/29，166.6秒正常结束：`upload-adjacent-r2.log`；与上两组不重叠，共23文件193项 |
| 两项新增故障复现 | `contract-red.log`、`operation-red.log`；测试路由和状态修正后通过，不削弱断言 |
| 目录、保护、兼容 | worktree inspect/development/core、feature-sync、type-check、上下文预算及 diff 检查通过；精确文件/CLI/compat 见 `review-facts.json` |
| DSH 原生组合 | 同一命令在DSH入口前后摘要一致时完整通过：`native-combination-r2.log`、`native-combination-r2-report.json`、`native-combination-r2-worker.log`；原并发变化的失败仍保留于 `native-combination.log` |
| 原扩展相邻矩阵 | `adjacent-tests.log`在180秒观察上界结束、没有最终汇总，仍不算通过；确认单文件耗时后另行执行上传29项，不把原整组矩阵改写成通过 |

新 HTTP 回归使用真实路由/鉴权/审批/运行服务和内存账本替身，不声称真实 SQLite
或真人批准。对待批记录的跨会话/权限/项目/画布拒绝，在记录仍有效时实测；
错误pollSecret、计划替代后旧审批失效、无效重试operationId也已覆盖。
DSH 第二次组合只使用全新系统 TEMP，窗口由测试 IPC 模拟，Provider 调用0；
四类方案、MCP方案原样交接、graph.node-add、单一RunIntent与素材导入/放置，
以及丢回执后的GET恢复全部通过。首次因并发变化未通过的运行不记为成功。
没有读取用户历史数据库，没有借用用户凭据或更改 DSH 源码/连接信任。

第二次组合（2026-10-20 15:37:56 北京时间）核对的DSH入口为
`e8563374d37aa41466d5cccffc0b8575f948e83306e8b3bf66d2185bb063b904`；
75个实际编译原生模块的摘要为
`7a847a2534e0753258e56213c01701254fdb55b0c85101a17848db72bb46b8d0`。
账本为run_intents=1，runs/node_runs/run_attempts=0，asset=1；没有把
accepted写成生成完成，也没有把测试预置导出记录写成真实网关下载。

### 交接清单逐项核对

| 要求 | 权威证据与结论 |
| --- | --- |
| 不覆盖既有38项/不重叠应用补丁 | `review-facts.json`逐项核对；仅本页列出的原生修订及测试/文档差异 |
| 加密资源清单查找与普通目录优先 | `agentControlCompatibility.test.cjs`在临时资源布局执行原生产函数；安装现场仍待发版 |
| 旧记录不占有效发现窗口、读取有界 | `zcanvasDiscoveryWindow.test.cjs`与原discovery测试；未删除用户记录 |
| secureStore v1/DPAPI/并发/精确清理 | 原存储、并发故障、实际CLI、配方及安装器矩阵；组合使用TEMP凭据 |
| 单计划单操作，原RunIntent权威 | 原运行/恢复测试及真实SQLite组合，账本仅1个intent；未调度Provider |
| 审批按原会话/action/项目/画布恢复 | approval recovery、素材HTTP及DSH HTTP回归，待批时测试隔离；原生窗口仍唯一批准权威 |
| 素材导入延迟、size/hash/Patch恢复 | 原素材回归及真实导入器/Blob/SQLite组合，一次素材和放置，原文件保留 |
| 最小Patch回执不暴露请求/秘密/变更 | 素材HTTP回归拒绝跨项目，断言不返回私有账本字段 |
| 不因幂等键重放模糊付费写入 | 6个生产传输边界用例与65个Provider相邻回归；没有实网付费调用 |
| 原compat/可选标记/权限及恢复合同 | 本文接口表、CLI与后端实际摘要相同、功能标记HTTP检查、第二次DSH组合 |
| 10份派生文件/工具manifest未手工改摘要 | 原feature-sync检查及能力清单回归；39能力/319目录/84节点不变 |
| 精确CLI/命令/证据/剩余条件回传 | 本文与私有证据；未修改DSH的信任pin，不代替负责人授权发版 |

复核命令（在各自源码根目录，使用全新系统TEMP夹具，不指向用户数据库）：

```powershell
# 画布目录：先执行两个worktree门，再按上述21文件清单运行限定矩阵。
npm run worktree:check
npm run worktree:development
npm run feature-sync:check
npm run type-check
# Electron CLI的Node入口，避免普通Node的SQLite ABI不匹配。
$env:ELECTRON_RUN_AS_NODE='1'
# 21文件矩阵：下列名单整体运行，不能挑掉失败项。
$taskTests = 'agentControlApprovals agentControlApprovalRecovery agentControlRuns agentControlRunRecovery agentControlAssets agentControlAssetPlace agentControlCompatibility agentControlDiscovery zcanvasDiscoveryWindow zcanvasSecureStore zcanvasSecureStoreConcurrency zcanvasAuthTransactions zcanvasRecipeStore zcanvasInstaller zcanvasPackaging seedanceNzReplayBoundary agentControlDshContract agentControlAuth agentControlPatchRoute agentControlCapabilityToolRoute creativeCapabilityManifest'.Split(' ') | ForEach-Object { "tests/$_.test.cjs" }
node node_modules/electron/cli.js --max-old-space-size=768 --test --test-concurrency=1 @taskTests
node node_modules/electron/cli.js --max-old-space-size=768 --loader ./scripts/electron-typescript-loader.mjs --test --test-concurrency=1 tests/seedanceNzProvider.test.ts
node node_modules/electron/cli.js --max-old-space-size=768 --test --test-concurrency=1 tests/assetUploadManager.test.cjs
node scripts/read-project-context.cjs check
# DSH目录；此命令仅临时库/模拟IPC批准，不请求真实付费生成。
node scripts/verify-native-canvas.mjs --canvas-root 'E:\PenguinPravite\T8-penguin-canvas' --include-run-intent --include-asset-transfer
```

此前交接记录的三项相邻基线失败（B3下载旧断言、CLI目录旧断言、技能行数旧断言）
仍按原证据保留；本轮没有把它们当新BUG或声称全项目全绿。

## 下一步

1. 本次开发态组合已通过；DSH接入对应源码CLI时，须显式审阅并更新自己保存的信任
   记录，保持原有十个读/规划工具和双重人工批准，不需新增原生协议版本。
2. 真人画布批准、真实网关结果下载、付费任务/账单及完整创作流程仍待验证。
3. 用户另行授权发版后才能升级安装包，再验证真实发现、配对与安装升级。
   现在安装版仍是旧3.3.6，不能声称安装版连接故障已修好。
