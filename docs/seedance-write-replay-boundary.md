# Seedance 付费写入的重放边界

2026-10-20 源码修复已由画布Agent接管并本地提交，尚未打包或发布；正式版本仍为3.3.6。
下列历史失败与CLI状态保留当时事实，最新组合验收见[接管结果](dsh-native-integration-20261020.md)。

`seedanceNz.secureFetch` 原来会在请求携带 Idempotency-Key 时，对不确定的
网络失败发起备用连接。幂等键可以关联一次提交，却不足以证明远端一定去重。
另一个判定会把含 certificate 等字样的错误文本当成请求前失败，这同样不足
以排除已受理。

现在，非 GET/HEAD 请求在连接重置、超时、响应头中断等受理不明的错误后，
直接返回现有安全错误，不发备用写入。原幂等键仍随唯一请求携带。只保留
明确 TLS 验证错误码所证明的请求前恢复；默认系统网络优先、证书校验、
取消以及 GET/HEAD 查询恢复保持。已返回任务编号后继续查询原任务，查询
或结果下载失败不触发替代生成。

新增 `tests/seedanceNzReplayBoundary.test.cjs` 编译实际生产模块，只替换传输
与配置依赖。原代码六项中两项失败，修复后六项通过，覆盖有/无稳定提交键、
五类不确定网络错误、仅含证书字样的错误、明确 TLS 失败、两级只读恢复、
取消、HTTP 错误及已接受响应无法读取。未使用真实 API、凭据或用户数据库。

Electron 专项及相邻五文件共 128 项：127 通过，一项媒体下载用例失败。
失败项为 `B3 completed image tasks retry transient downloads and expose actionable safe failure reasons`，
期望 HTTP 502，实际为 HTTP 202 / `image_download_network_failed`。将仅此
Provider 模块从未修改的 HEAD 注入隔离测试后，同一用例仍以相同结果失败，
因此不归因于本修复，也不把完整矩阵记为通过。该媒体故障路径仍需单独排查。

Provider 源码属于运行目录摘要的输入，因此本修复同时通过正式生成器同步
兼容清单与派生能力产物。先比较旧、新运行目录：除 sourceDigest 外深比较
完全一致，34 LLM / 69 image / 136 video / 19 audio / 61 actions 保持；再将
providerCatalogDigest 从 `32d18f96b4c0fa127342a30a83e3c408ad9143538fa29e5b566c091ba9382d49`
更新为 `00dc6ba277f0937123ad7695c01a473a733df8b3d7890f4e7f9fe33e685edf5d`，
运行官方 feature-sync 生成器及 --check。39 项能力、319 条运行目录、84/84
节点覆盖保持，无版本升级或手写派生清单。

另一次 Electron 限定矩阵（重放边界、能力清单、CLI）41 项中39过、2失败。
失败是旧 CLI 测试没有计入 localization 命令，以及要求创作技能少于500行。
相关 CLI 源码、commandCatalog、技能正文和测试相对 HEAD 均未改动；HEAD
本身已有 localization，技能正文681行。这里只证明旧断言与当前基线不符，
没有额外运行整个未修改 HEAD，也未通过删除断言或增加上限来隐藏失败。

DSH 现在能读取真实源码 CLI 并经已发布 ToolRuntime 挂载10个检查/规划工具；
本机安装的另一份 Agent CLI 与当前源码的节点/模型摘要不同，不能自动替换。
本次两个 CLI 均报告 APP_NOT_RUNNING，尚无实际应用握手或配对证据。源码
CLI 的新摘要变化已记录，仍不能据此开放付费执行。

所有测试数据在系统临时目录，进程结束后清理。没有读取 retained/historical
项目库；没有改动版本、现有节点/参数、生成结果、正式安装包、两份受保护
运行时文件或自动更新资产。真实 Provider、用户 TUN、安装版及完整 DSH
双门审批闭环仍未验收；不能据此开放 DSH 的付费工具。
