# Agent 桌面活动上下文

2026-10-21。核对DSH的v3.3.9复核及活动上下文交接后实现，已随v3.4.0同源双平台发布，六资产独立完整回下载通过；Mac runner最终ZIP下载连接重置的失败如实保留，见[发布专题](release-v3.4.0.md)。旧v3.3.9 Tag与产物不变，本接口不在旧包中。

## 已有合同与新增入口

原`workspaces`只有项目/画布目录；`workspace current`是Agent通过`workspace use`保存在自己凭据库中的目标，不是桌面活动窗口。原接口及选择语义不变，也不重做DSH四个面板的目标选择。

- 新CLI：`zcanvas workspace active --instance <instanceId>`，CLI版本仍为`0.1.0-dev`，只读L0定位，不需要已绑定的Agent workspace。
- 新HTTP：`GET /api/agent-control/v1/active-context`，返回原`t8-agent-control-http-v1`信封，其`data.schema`为`t8-agent-active-context-v1`。
- 既有精确兼容握手、本机Host/Origin检查和配对仍必需，权限为`canvas:read`。公开`status`仅新增`activeContext: {schema, scope: "canvas:read", readOnly: true}`能力标记，不公开窗口/画布定位。
- 非Electron后端或未接入原生窗口时返回`unavailable`；不读取localStorage、实例历史、用户数据库、节点正文或ReactFlow内部状态作为替代。

响应data示例（仅示意，不是现场回执）：

```json
{
  "schema": "t8-agent-active-context-v1",
  "instanceId": "EXAMPLE_INSTANCE",
  "status": "resolved",
  "resolution": "single-window",
  "activeWindowId": "1",
  "observedAt": "2026-10-21T03:00:00.000Z",
  "truncated": false,
  "candidates": [{
    "windowId": "1",
    "windowReady": true,
    "rendererReady": true,
    "focused": false,
    "projectId": "project-local",
    "canvasId": "EXAMPLE_CANVAS",
    "revision": 7,
    "reason": "ready",
    "observedAt": "2026-10-21T03:00:00.000Z"
  }]
}
```

## 定位与歧义语义

| 字段/状态 | 合同 |
| --- | --- |
| instanceId/windowId | 只在已选实例内定位；windowId须与instanceId共同使用，不跨进程猜窗口 |
| windowReady | 原生登记的画布窗口存活、可信应用页面且不在主框架加载中；不代表存储或生成可写 |
| rendererReady | 当前、已加载、ReactFlow已初始化的画布ID一致，并具有有效项目ID和已确认revision |
| revision | 编辑器最近加载/保存/同步确认的版本；不是再次读取数据库得到的当前权威版本，也不包含尚未保存的改动 |
| observedAt | 原生收到当次回执/完成当次查询的时间；不是客户端自报时间、旧心跳或磁盘更新时间 |
| resolved | 一个可信且就绪的唯一原生焦点窗口，或实例只有一个就绪画布窗口；后者resolution为single-window，**不代表系统前台焦点** |
| ambiguous | 多窗口无唯一原生焦点、窗口集合在查询中变化，或超过8个候选；activeWindowId为null，需由用户明确选择 |
| not-ready | 可定位窗口仍加载、画布未初始化、响应超时、回执无效或查询中重载；不回退选另一张画布 |
| unavailable | 没有画布窗口、没有原生提供者，或原生查询异常；不把目录首项冒充当前目标 |

活动信息只是短时定位，不授予修改或生成权限，不自动执行`workspace use`，不改变已选目标、信任pin、配对记录或审批。DSH仍须结合用户意图明确目标；执行前按原流程重新核验项目/画布、权威revision、CAS及原生批准。多实例也必须先明确实例，不能据此宣称全桌面唯一活动画布。

当前产品原生每实例只有一个主画布窗口；提供者只接收显式登记的画布窗口，不枚举日志、登录或DevTools。将来增加画布窗口必须显式登记；两窗口行为已在隔离真实Electron中验证，不声称产品新增了多窗口UI。

## 实现和边界

- 每次查询使用随机requestId向主frame拉取最小元数据，最长等待1.5秒；发送者、主frame、请求身份、可信URL和有效ID/revision逐项检查。正在执行的并发查询可共用当次请求，完成后不缓存。
- Canvas生产回调只读取自身公开报告的生命周期及已确认版本引用；切换/卸载后旧编辑器不能继续报告就绪。preload和原生两层均白名单输出，不含提示词、节点选区、素材地址、缩略图、账号或凭据。
- 重载、崩溃、关闭使本轮候选失效，包括另一窗口尚未回应时已经收到的旧回执。查询完再核对窗口集合与原生焦点，所有监听/计时器均清理；不注册心跳或落盘。
- 保存关闭/自动更新准备期间，即使旧编辑器仍在内存，preload也拒绝报告就绪；取消关闭后才可再次定位，不改原关闭回执或更新状态机。
- 新模块接入两平台同一asar强制清单。命令目录由官方生成器更新，九字段仍全部精确检查；manifestDigest随命令目录变化，能力图39/319/84不变。不手改摘要、不借旧安装包的信任。
- 受管导出继续使用v3.3.9新增的显式安装/修复：同版本内容变化须从当前应用内置工具刷新，并在DSH重新检测和明确审阅。源码改动不会热更新现有安装版；本轮不替换真实Agent目录。

## 验证

本机ignored证据目录：`local-private/active-context-20261021/`。用全新系统TEMP，不读取用户/历史库、不请求真实批准或Provider。

- 新增专项11/11：原生边界、多窗口/错误frame/nonce、重载/崩溃/关闭、集合变化与截断、并发合并、生产Canvas报告器、真实HTTP鉴权及生产CLI；含真实Windows Electron、原preload和生产报告器的两窗口/切换/重载/重启验证。后者使用最小测试页面，不是完整Canvas UI或安装升级验收。
- 相邻14文件87/87通过，包含上述11项、原安装/同版本刷新、真实Electron设置修复、鉴权/发现、旧workspaces合同及自动更新/关闭回归；不与专项重复相加。最终检查见本机日志。
- 另16项Electron两平台打包合同通过，未实际生产打包；类型检查最终退出0。最初发现并修正空画布ID的可空类型；768 MiB堆不足的检查保留失败日志，最终使用BelowNormal、有界3 GiB堆检查。功能/打包测试仍串行768 MiB。
- 随后获授权的正式构建与加密包验证已完成：同Tag源码`f482ccce24cef89662682e207b37266e945c0f23`，Windows唯一正式链、Mac唯一正式构建及六资产独立完整下载通过；包内服务/最小IPC回执、九字段、同版本工具修复与真实存储关闭通过。包内探针的窗口是合成替身，不冒认完整GUI；真实Electron窗口证据仍来自前述隔离生产报告器测试。22项双平台打包合同和4项证据门另通过，Mac workflow网络失败不改写成成功。
- 首次CLI夹具没有保存待配对记录，既有并发身份门按设计拒绝；修正为真实配对事务。真实Electron夹具的TEMP短路径`~`编码差异导致可信文件页校验失败，按文件URL解析修正测试路径；生产仅信任HTTP应用来源，未放宽。原失败日志保留。
- 完整安装后的同版本导出/旧版升级、真人最小权限批准、DSH自有插件接入、完整创作/付费Provider、用户现场和F8–F10仍待验收。未改DSH源码/连接配置，没有把交接方3.3.7现场报告冒认本次验收。
