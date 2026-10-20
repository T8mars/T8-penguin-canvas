# Agent 运行计划单次提交与只读恢复

2026-10-20，源码已由画布Agent接管并本地提交，未生产发布。正式版仍为3.3.6。
下列旧矩阵保留当时快照；最新CLI、源码检查点与组合证据见[接管结果](dsh-native-integration-20261020.md)。

原运行计划可使用不同operationId创建多个意图；调用者及账本键冲突校验也
不完整。现在同一原生内存计划绑定一个operationId，提交前复核原计划、
会话、actor、有效期、revision和运行权限；原数据库仍以idempotencyKey去重。
返回的意图必须符合原项目、画布、节点、actor及executionAuthority，冲突不泄露。
没有新增Agent私有付费台账，也没有改变数据库schema或Provider提交入口。

status新增runControl能力标记。以下GET只查现有记录，不批准、不创建意图：

- `/run-start-approvals/by-operation/:operationId?projectId=...&canvasId=...`
  要求run:execute及原session，复用原审批服务；恢复pollSecret的披露边界与
  原创建响应一致。过期、其他会话、项目/画布或已替代记录不可取。
- `/run-intents/by-operation/:operationId?projectId=...&canvasId=...`
  要求run:read及原actor，沿用原数据库getRunIntentByKey与inspect权限检查，
  不依赖内存计划仍在。意图公开引用新增operationId。

DSH只保存方案和查询引用，pollSecret仍只入原secureStore。人工核对范围、
模型及费用未知 → 原生窗口批准 → 单次完成 → 只查询。原生报价没有金额，
不能把null展示为免费；unknown/已接收后绝不重发。没有改变原生窗口权威。

| 已验证 | 待验证 | 未验证 |
| --- | --- | --- |
| `node --test tests/agentControlApprovalRecovery.test.cjs tests/agentControlApprovals.test.cjs tests/agentControlRunRecovery.test.cjs tests/agentControlRuns.test.cjs`，20/20 | 原生实际窗口/安装版及真实用户工作流 | 不代表整个Canvas测试全绿；此前相邻基线失败保留 |
| DSH `npm run verify:canvas-native -- --canvas-root E:\PenguinPravite\T8-penguin-canvas --include-run-intent`，原生路由/审批/ProjectDatabase、全新系统TEMP；丢审批/提交回执均GET恢复 | 真实Provider受理、调度、结果落盘和费用结算 | IPC批准仅测试模拟，未运行生成；没读用户历史数据库 |
| 账本run_intents=1，runs/node_runs/run_attempts=0，出站0；1次审批创建、2次完成（未批准等待一次、批准提交一次）、3次恢复GET | 多设备、其他文件系统、旧版兼容发布 | 没有版本升级、生产构建、打包或公开发布 |

工作源码编译闭包75模块摘要c335d9f6fd5736592f82a63d0341c4fc36ab951ec8ce2de22b89f21cfce883e8。
证据保留在DSH本地`.runtime/evidence/native-canvas-run-intent.json`；TEMP已清理。
首次验证仅因测试计数器误计结构审批而失败，修正按run.start审批ID计数后通过，
旧失败日志保留；未用测试修正掩盖业务失败。Source CLI摘要仍fae0…ec9，安装版未动。
