# GitHub PR / Issues 复查与处理 · 2026-11-12

本轮检查为 0 个开放 PR、6 个开放 Issues。已逐项审计、修复可复现缺陷并回复报告者；六项继续开放，保留各自尚缺的现场验收。新增补丁已随 v3.5.2 双平台发布（见末节）；下文保留开发验证记录，现场边界未代验。v3.5.1 固定源码及已发布资产不变。

## 已确认并修复

### #33：创作助手结果已提交但画布无法定位

后台完成结果及 placement 后，前端直接在旧本地图中定位节点，没有读取已提交版本。现有结果截图不能解释成 API 没有生成；调用记录也不能单独证明每次生成都成功。

“采用并发送”和“已发送·查看”现在共用异步处理器：保留提交回执，读取 canonical 画布，校验 canvas/project、版本和资产身份，通过现有三方合并/CAS 保留本地编辑，最后选中并定位。读取失败后显式“查看”仅重试 GET，不再次 placement 或生成；刷新后仍使用持久回执。切换画布、结果节点被删除或身份变化时提示对应原因，不定位其他节点。

“逐场创作”是模式选择，仍需发送脚本/要求并确认生成操作；本轮未把模式点击改成自动付费生成。其余逐场症状需要报告者给出确认生成后的错误与步骤。

### #31：安装请求被布局变化误拦截，以及安装完成误报失败

完整 App 修复前复现：点击安装才挂载状态行，ReactFlow 更新 `measured`，graph epoch 从 8 变 9，而 revision 仍为 4、实际输入未变。现预留相同状态行高度，保留 Run 创建时的 revision、图与执行输入保护；不绕过 Canvas 直接调用安装器。此前已发布的拒绝/取消后解锁继续保留。

布局修正后继续暴露另一条真实失败：安装完成报告空素材输出，通用事件路由正确拒绝 host-only `node.output`。共享 `useRunTrigger` 现由内部显式选项声明非生成维护操作，仅将零输出完成记录为 `node.progress`，Run / NodeRun / Attempt 仍由原权威终态流程收尾。安装和火山素材目录刷新使用此路径；不归档旧素材、不虚构 Provider 响应。普通生成空输出仍失败，真实素材仍走权威输出事务，后端事件权限未放宽。

## 其余问题的处理

| Issue | 本轮结论与剩余事项 |
| --- | --- |
| [#30 RH 枚举](https://github.com/T8mars/T8-penguin-canvas/issues/30) | v3.2.3 真实枚举修复与 v3.2.6 媒体修复在 v3.5.1 保留；解析/双站回归通过。仍缺报告应用的真实字段元数据和现场复验，已请求最小脱敏字段，不猜参数、不付费重交。 |
| [#29 Mac null.value](https://github.com/T8mars/T8-penguin-canvas/issues/29) | v3.1.9 同步捕获事件值修复保留，实际处理器三项回归通过。Windows 可打开 Creator 不替代受影响 Mac“仅打开即崩溃”的复验；已请求精确构建与脱敏未压缩堆栈，不清数据。 |
| [#24 性能](https://github.com/T8mars/T8-penguin-canvas/issues/24) | 保留性能档位、离屏冷壳、轻量连线、分页及后续归档/启动优化；相关回归通过。组级静态栅格快照未实现；真实重画布、五分钟回落和双平台安装场景未补齐，已更新进展与最小环境请求。 |
| [#25 英文](https://github.com/T8mars/T8-penguin-canvas/issues/25) | 当前中英文各 5,567 keys、85 节点目录检查通过；英文入口已提供。真实 Provider 英文流程、全部浮层/缩放、键盘/读屏及双平台完整流程未验收，已用英文更新状态。语言切换不翻译用户内容或模型身份。 |

## 验证与证据

- 最终受影响专项及相邻回归 **84/84**，包含 Creator 提交/查看、布局、安装请求结算、维护输出、Run 生命周期/失败隔离和火山素材界面。生产回调/JSX 由 AST 提取执行；修复前的布局与事件失败均留有报告。
- 前序限定组 **130/130**、RH/性能/i18n/验收安全组 **59/59**、本地化相邻组 **30/30** 通过；这些组有交集，不累加冒充独立总数。最终生命周期检查曾检出旧 VideoNode 静态测试只匹配 `isWan` 开头；已按实际含 H3/Muse/Animate/Topaz 的表达式补全家族及优先级验证，未修改生产恢复分支。
- `scripts/verify-issue-followup-canvas.cjs` 在真实开发 App、Canvas、生产后端和新建临时 SQLite 中通过五项：发送并保留并发编辑、失败后查看、刷新后查看、延迟 Run 下安装夹具收尾、权威账本成功终态。placement 1 次、安装夹具 1 次、外部调用 0 次；Run / NodeRun / Attempt 全部 succeeded，没有 `node.output` 或 Provider 事件。
- 严格进程回执 `artifacts/history-low-load-runner/deb4ab6539ba4ddeae7608bfac6bee6c.json`：child/runner exit 0、forced 0、remaining 0、cleanup clean；CPU 10%、Job 4 GiB、Node/Electron 768 MiB、Go 512 MiB、BelowNormal 与软件渲染均保留。`acceptanceStatus=not-evaluated` 是通用 runner 的字段，功能判断来自独立 App 报告，未将其冒认为产品全量验收。
- 源盘剩余空间不足时，新增显式 `-ScratchRoot` 检查所选本地盘至少 10 GiB，再创建独占临时子目录；本轮用 G 盘，不降低原空间/资源门。初次空间拒绝和后续诊断/选择器失败均保留，没有循环自动重试或读取失败后留存数据库。
- TypeScript `--noEmit`、i18n、feature-sync（39 actions / 382 entries / 85 nodes）、public、context、worktree、语法与 diff 检查通过。详细日志、截图及每次报告见本机忽略目录 `local-private/issues-20261112/`；最终 App 报告 `canvas-ui.json`，专项 `final-focused.log`。

边界：本轮使用本地引擎 HTTP 测试回执，没有实际下载/安装模型、接受真实许可证、调用付费 Provider、读取用户/历史库或验证受影响 Mac。临时库成功后清理；失败夹具保留且不再打开。F8–F10 与 27/32 不变。

## GitHub 回执

连接器写入返回 403，未产生评论；随后使用本机已登录 GitHub CLI 完成，同一标记防重复。#33 补充 bug 标签，其余标签保留，未关闭 Issues。

- [#33 根因、补丁及逐场用法](https://github.com/T8mars/T8-penguin-canvas/issues/33#issuecomment-6803049535)
- [#31 两处根因与验证边界](https://github.com/T8mars/T8-penguin-canvas/issues/31#issuecomment-6803051010)
- [#30 已发布修复与精确元数据请求](https://github.com/T8mars/T8-penguin-canvas/issues/30#issuecomment-6803052402)
- [#29 Mac 待复验](https://github.com/T8mars/T8-penguin-canvas/issues/29#issuecomment-6803055793)
- [#24 性能进展及现场瓶颈](https://github.com/T8mars/T8-penguin-canvas/issues/24#issuecomment-6803057207)
- [#25 英文支持进展](https://github.com/T8mars/T8-penguin-canvas/issues/25#issuecomment-6803058558)

下一步：收到当前明确发布授权后再进入打包流程，发布后通知 #33/#31 复验；其他问题按最小现场信息继续定位，不以重复本地绿测替代缺失证据。

## 后续发布授权

用户已明确授权将本轮修复随 v3.5.2 打包并发布，现场证据后补；Mac 仅实际额度不足可延期。最终发布结果见[发布专题](release-v3.5.2.md)。开发阶段未发布的结论不代表当前发布状态；Issues 不因发版自动关闭。

本轮新增修复现已随 [v3.5.2 双平台发布](release-v3.5.2.md)，固定源码、六项发布资产和两个更新清单校验通过；此前“本地/待发布”描述为开发阶段事实。现场边界与六项 Issues 的开放状态不变。

发布后已通知 [#33](https://github.com/T8mars/T8-penguin-canvas/issues/33#issuecomment-6807229695) 和 [#31](https://github.com/T8mars/T8-penguin-canvas/issues/31#issuecomment-6807231059) 升级复验；未把安装夹具或 Windows 开发版验证冒认为受影响用户的安装现场成功。
