# GitHub PR / Issues 复查与处理 · 2026-11-17

仓库 `T8mars/T8-penguin-canvas`：0 个开放 PR、6 个开放 Issues。逐条读取正文、评论及相关源码；截至本轮复核，报告者没有在 11 月 12 日跟进后补充新回复。本轮确认 #30 仍有真实遗漏并修复；其余条目按已发布待复验、缺少环境或未完成验收保留，不批量关闭。

最新正式版本仍为 v3.5.2。本轮补丁仅本地开发和验证，未升级版本、生产构建、推送、打 Tag 或更新 Release。此前修复的发布事实见 [11 月 12 日专题](github-issues-20261112.md)。

## #30：真实 COMBO 参数封装漏解析

报告者原截图已经包含国内站 App ID `2101152608831492098`，无需再次要求用户提供。使用现有授权凭据，只读调用生产路由使用的 `GET /api/webapp/apiCallDemo`，返回 HTTP 200、Provider code 0、10 个字段。`#291 aspect_ratio` 的真实 `fieldData` 是字符串化的 `['COMBO', {default, options, tooltip, multiselect}]`，包含八个完整选项，例如 `21:9 (Ultrawide)`。

此前共享解析器支持直数组、嵌套选择数组和对象选项，遗漏上述 typed descriptor，实际返回空选项；该代码与 v3.5.2 相同，故不能宣称正式版已经解决。修复先识别 typed descriptor，再读取真实 options，避免把 widget 名或 metadata label 当作选项。普通 RH、钱包、RHTools 和工具箱继续共用 `src/utils/rhFieldOptions.ts`，不按字段名猜枚举。

- 原有媒体字段保留上传处理；数字、文本、布尔 typed metadata 不虚构闭合枚举。
- 完整枚举值和数字/字符串身份保留；旧裸值不静默替换，提交前拒绝，并提示重新选择实际完整选项。
- 不修改应用、Provider、站点、现有画布默认值或付费任务恢复协议。

公开最小真实字段夹具：`tests/fixtures/rh-issue30-combo-20261117.json`，只含公开 App ID 和该字段元数据，没有凭据、任务身份或素材 URL。

## 验证

- 修复前的生产解析器回归为 18 项中 10 通过、8 失败；修复后 18/18，相邻 RH 专项最终 **58/58**。覆盖真实 COMBO、完整值提交、防止 metadata 误枚举、媒体上传、双站路由、文本输出、工具箱和文本绑定。
- 原 AST/VM 测试未声明 `result`，以及 OutputNode 翻译测试使用过时的精确对象正则，均属测试夹具问题。前者显式声明 VM 接收值；后者改为提取并执行当前生产回调，验证翻译文本、记录、资产提及重定位和退出编辑，未修改生产 OutputNode。最初失败日志保留，不把这些测试问题冒认为产品缺陷。
- 独立只读实网采集确认八个完整选项均可被生产校验器接受，裸 `21:9` 被拒绝。整个本轮未提交 RH 生成任务，无收费生成。
- `scripts/verify-rh-combo-canvas.cjs` 使用真实开发 App、Canvas、生产后端及 fresh TEMP SQLite，验证普通 RH 和钱包的八项选择、连续选择保存、旧裸值不改、真实 Run 在提交前拒绝、重选及刷新恢复，以及中英/浅深主题不翻译 Provider 选项。提交数 0、后端外网尝试 0，功能报告 `passed=true`。
- 通过 `run-history-low-load.ps1 -Mode RhComboCanvas` 执行，保留 CPU 10%、Job 4 GiB、Node/Electron 768 MiB、Go 512 MiB、BelowNormal、软件渲染和预检。回执 `artifacts/history-low-load-runner/8049967228d444bcb6e31360e65d1e3d.json`：child/runner exit 0、forced 0、remaining 0、cleanup clean。通用 `acceptanceStatus=not-evaluated` 不代表产品全量验收；功能结论来自独立 App 报告。
- 首次 App 验证的选择器未等待控件挂载，导致测试过早读取空列表；同次截图显示完整八项控件。仅补充等待后再次验证通过。首次失败报告及回执保留，未读取留存数据库；成功临时库已清理。
- 项目原命令 `npm run type-check`、feature-sync、i18n、public、context、worktree、语法和 diff 门通过。额外将纯 TypeScript 检查限制到 768 MiB 的一次执行发生堆内存耗尽，失败日志保留；随后使用项目原命令完成检查，未修改历史/App 验证器的资源限制。

详细本机证据在忽略目录 `local-private/issues-20261117/`：`rh-before-fixed-harness.log`、`rh-after.log`、`rh-focused-final.log`、`rh-issue30-metadata.json`、`rh-canvas-ui.json`、截图及低负载日志。安装版、报告者现场、完整 RH 付费任务和 F8–F10 不在本轮验证范围。

## 六项逐条状态

| Issue | 处理结果与剩余事项 | 本轮新增状态标签 |
| --- | --- | --- |
| [#30 RH 枚举](https://github.com/T8mars/T8-penguin-canvas/issues/30) | 本轮复现并修复 COMBO 封装遗漏，58 回归和完整画布通过；待明确授权发布后再通知升级复验。 | `fix-ready` |
| [#31 本地化安装](https://github.com/T8mars/T8-penguin-canvas/issues/31) | 布局误拦截及维护操作空输出收尾已随 v3.5.2 发布；既有 84 回归、完整 App 和权威 Run 账本证据保留，报告者尚未现场复验。 | `needs-validation` |
| [#33 Creator 结果同步](https://github.com/T8mars/T8-penguin-canvas/issues/33) | canonical 画布同步、保留并发编辑与 GET 重试已随 v3.5.2 发布；未收到升级后的失败步骤或现场复验。 | `needs-validation` |
| [#29 Mac null.value](https://github.com/T8mars/T8-penguin-canvas/issues/29) | 已确认的 React 事件生命周期修复从 v3.1.9 保留；受影响 Mac 定制构建“仅打开即崩”的精确版本、脱敏堆栈及复验仍缺，不能用 Windows 通过结案。 | `needs-info`、`needs-validation` |
| [#24 性能](https://github.com/T8mars/T8-penguin-canvas/issues/24) | 已有档位、离屏冷壳、轻量边、分页/归档/启动优化；组级静态栅格快照尚未实现。真实重画布、五分钟回落及双平台安装证据缺失，不能宣称全部完成。 | `needs-info`、`needs-validation` |
| [#25 英文](https://github.com/T8mars/T8-penguin-canvas/issues/25) | 已有独立语言设置及核心双语；真实 Provider 英文金路径、全部浮层/缩放、键盘/读屏及双平台完整验收未完成。 | `needs-validation` |

核对上述 #31/#33 等关键源码与 v3.5.2 Tag 无差异，未为制造进度重复修改。#24/#25 的既有明确关闭门槛继续保留。

## GitHub 回执与下一步

连接器写评论返回 403 `Resource not accessible by integration`，没有产生评论；随后以已核实的 `T8mars` 本机 GitHub CLI 身份，用正文文件及唯一标记防重复发布 [#30 新根因、补丁与验证边界](https://github.com/T8mars/T8-penguin-canvas/issues/30#issuecomment-6940449398)。正文明确 v3.5.2 不含本轮补丁。其余五项没有新事实，不再重复发送相同催复验评论。

已创建并添加上述三种状态标签，保留原 bug/enhancement 标签、原正文及开放状态；远端回读确认 0 PR / 6 Issues。下一步是取得新发布授权后发布本地修复，再通知 #30 复验；其他条目按最小现场信息和已有验收门槛继续推进，不以重复本地绿测替代缺失证据。
