# 用户启动日志后的针对性修复

2026-10-08：源码修复完成；当前用户明确授权纳入 v3.2.9 正式发布，状态见[发布专题](release-v3.2.9.md)。仅分析用户提供的启动日志，未读取用户或历史数据库。

## 证据与原因

用户的 v3.2.8 启动日志中，本地服务很快监听、前端进入目录阶段，但 `active-initialized` 用时 90,510 ms，目录阶段等待 91,109 ms；`startup-backup-complete` 随后用时 146,024 ms。owner 获取 87 ms、clean-active-fast-path 17 ms，不是这一轮主要延迟。日志中两条通用 renderer-error 没有错误原文，不能据此判断具体组件故障。

源码及新建夹具确认：当前 schema 校验、migrate 快路径与 completed guard 都会重复走全量 stable identity / typed canonical JSON 和结构描述符检查。备份 SQLite 复制本身异步，但候选 seal、全量内容散列和验证仍在 Electron 主线程同步执行。它们能解释本地目录等待及“后台备份期间窗口未响应”；日志不足以确定用户库大小、磁盘速度、杀软影响，或保证这些是现场唯一因素。

## 改动与保护

- 初始化与候选验证使用仅存在于单次同步调用内的证据复用。仅非事务状态可复用，事务内始终独立检查，不缓存未提交或回滚中的证据；SQLite total_changes、data_version、schema_version 和事务状态都必须一致。写入、回滚写入、外部提交或 schema 变化使已有证据失效。冷启动仍完整检查一次，不使用磁盘缓存或前次进程的“已验证”标记。
- full schema、FK、quick_check、历史容量/账本、snapshot pins、UUID、迁移 guard、ACK/代次/水位和 interrupted Run 恢复门保留。没有放宽校验或自动回滚。
- 备份 seal 与只读 verify 改为独立 Worker，仅打开 owned 临时目录的 candidate.sqlite3，不接管主库、owner 或 ACK。原队列、空间门、异步 SQLite backup、fsync、原子替换及旧备份失败保留机制不变。线程失败不回退主线程；结果在 worker 退出后才交回，pending backup 的 close 等待它们完成。
- 加密后端 worker 使用既有 T8 loader；没有增加公开后端源码、文件系统端点或独立写入台账。生命周期静态合同只反映候选操作移出原方法，不提升既有 writer-policy 完成度。
- 新目录原来跳过已有 canonical 条目，旧 canvas_list.json 独有的名称因此显示为 ID。现在每次启动按两条一批恢复活动画布缺失的 name/title；已存在真实名称、title 或用户明确的 ID 名不覆盖。内容 revision、UUID、节点/连线、原 updatedAt、目录版本不变。归档画布继续只读，不恢复其中缺失名称；恢复为活动画布并重新启动后再按同一规则处理。旧名称已不存在时不猜名。
- 启动诊断新增 schema、migration、freshness、history、integrity、runs 和备份 write/seal/verify 固定计时阶段；仍是白名单字段与两次启动有界日志，不采集画布、名称、路径、密钥或错误原文。

## 验证

限定回归共 51 个不同用例实际通过，按文件分组；重复执行不累加，最后选择性缓存检查中的 4 个跳过不算新增通过。

| 测试文件 | 通过 | 核心覆盖 |
| --- | --- | --- |
| startupHistoryRegression.test.cjs | 7/7 | 实际加密/原生 worker；冷开一次全量读取；同一验证作用域写入、事务回滚、外部提交、DDL 使缓存失效；备份期间主线程计时器；close 等待线程；typed 与逻辑散列损坏拒绝替换；缺失名称边界 |
| canvasArchiveRoutes33.test.cjs | 2/2 | 真实 HTTP，已水化目录仍恢复旧名、搜索可用；canonical 名和归档内容不覆盖 |
| canvasCatalogMetadataCanonicalRecovery.test.cjs | 3/3 | 旧 rename 时间戳兼容保留，不匹配损坏继续拒绝 |
| startupPerformanceBackend.test.cjs | 13/13 | 5000 项有界目录、干净启动、WAL/迁移/源变化门、延迟备份、惰性单例和启动壳 |
| startupBackupReadiness.test.cjs | 1/1 | 实际备份未完成时不能发布 background-ready |
| projectDatabaseLifecyclePolicyB2.test.cjs | 3/3 | 17 个生命周期边界及代码/业务调用漂移继续拒绝 |
| startupDiagnostics.test.cjs | 17/17 | 新固定阶段白名单、脱敏持久化/导出/IPC及专项语义类型检查 |
| canvasCatalogStartupUi.test.cjs | 5/5 | 启动选择、分页/窗口化、异步恢复与定点元数据刷新合同 |

同一新建系统临时库、8 张画布 / 2000 个文本节点、约 9.9 MiB，固定 v3.2.8 源码 `14aafd41...` 与修复源码依次关闭连接后重开：全量 typed history 读取 3 次 → 1 次，耗时 1316.38 ms → 547.22 ms（约减少 58%）。这不是清空操作系统磁盘缓存后的测量。比较脚本仅保存于忽略的 `local-private/startup-fix-20261008/compare.cjs`；这是一台开发机的合成库结果，不能换算为用户 90 秒阶段的现场耗时。

测试使用 Electron-as-Node、串行、BelowNormal、768 MiB 堆和明确 64 MiB 小夹具存储策略；不降低生产磁盘空间门。加密/原生 worker 验证使用隔离子进程：Windows Electron ASAR 缓存会持续占用归档直到进程退出，因此退出后才由父进程清理实际临时文件。初轮测试的空间门、归档只读保护、合同旧断言和 ASAR 清理失败保留为修正过程，不冒认通过。

上下文预算/JSON/原归档完整性、83/83 能力同步、core/development 路径门、变更语法与 diff 检查通过。另以 packaged 环境且无管理令牌实际验证 worker 导入项目数据库模块，不需要初始化管理 authority；这是明文模块导入检查，不冒认为完整安装包验证。

修复阶段未执行生产 build、安装包或 GitHub 操作；后续正式门及发布事实集中维护在发布专题。反馈用户旧库、安装版启动/窗口响应和真实磁盘尚未复验；修复阶段加密夹具只验证实际 worker bootstrap、既有 loader、字节码与原生 SQLite 链路。首次完整校验/迁移与复制仍有真实成本，不承诺所有用户瞬时启动。
