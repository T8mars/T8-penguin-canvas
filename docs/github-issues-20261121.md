# GitHub PR / Issues 复查 · 2026-11-21

仓库 `T8mars/T8-penguin-canvas` 当前 **0 个开放 PR、6 个开放 Issue**。逐条读取正文、评论及对应源码；26条已有评论均来自维护者，报告者在上轮跟进后没有新增回复。最近活动仍为11月17日的发布通知/状态标签。本轮没有新增可复现缺陷，不修改产品代码，不将已发布补丁重复实现，也不关闭仍缺验收的条目。

当前正式版v3.5.4；本轮仅本地审计与记录，不升级版本、打包或推送。不重复发送相同的催复验评论。

| Issue | 核对结果 | 剩余事项 |
| --- | --- | --- |
| [#30 RH枚举](https://github.com/T8mars/T8-penguin-canvas/issues/30) | v3.5.3的真实COMBO封装解析、完整选项值及媒体上传路径在v3.5.4保留。 | 报告者升级、重新拉取应用信息并选择完整选项后的实际结果。 |
| [#31 本地化安装](https://github.com/T8mars/T8-penguin-canvas/issues/31) | v3.5.2的固定高度状态行、请求结算与非生成维护收尾在v3.5.4保留；运行一致性/许可证/权威输出保护仍在。 | 真实设备接受许可证后的引擎安装复验。既有安装夹具不等于实机安装成功。 |
| [#33 Creator结果同步](https://github.com/T8mars/T8-penguin-canvas/issues/33) | v3.5.2的canonical同步、三方合并、已提交回执和GET重试在v3.5.4保留；查看不会再次放置或生成。 | 升级后的现场复验；如逐场模式仍失败，需确认发送及批准生成后的步骤和脱敏错误。 |
| [#29 Mac null.value](https://github.com/T8mars/T8-penguin-canvas/issues/29) | v3.1.9的同步捕获事件值修复保留，未恢复在延迟状态回调中读取currentTarget的旧写法。 | 定制Mac构建“仅打开即崩”的精确提交、资源文件及脱敏未压缩堆栈仍缺。不能将已修复的选择器缺陷当作全部症状的已证根因。 |
| [#24 性能](https://github.com/T8mars/T8-penguin-canvas/issues/24) | 性能档位、保留挂载/端口/运行监听的冷壳、轻量连线、目录分页、归档和启动优化保留。 | 组级静态栅格快照仍未实现；真实重画布、五分钟资源回落及双平台安装版场景待验。保留此前不使节点文字自动模糊的要求。 |
| [#25 英文](https://github.com/T8mars/T8-penguin-canvas/issues/25) | 已有独立UI语言入口、核心双语和85类节点目录；v3.5.4发布记录为中英文各5623个Key。 | 全部边缘浮层、缩放、键盘/读屏、真实Provider英文流程及双平台安装版完整验收仍缺。语言切换不改用户内容或模型/Provider身份。 |

## 源码与证据

当前检查点为`b1d943704432ba11227bc9fc011b7b1a01fb48c2`；v3.5.4正式源码为`83cbbcb7255682651f9a01e4ec5049b5da5d42e8`，二者差异只有发布事实文档和features记录，产品代码相同。

以下七个关键文件的Git blob与v3.5.3一致；并读取了当前修复入口，未发现修复被回退：

- `src/utils/rhFieldOptions.ts`：先解析typed COMBO descriptor；精确校验完整值，媒体保留上传。
- `src/components/CreatorAgentPanelV2.tsx`：同步捕获渠道选择值；已发送结果保留placement回执，仅重试同步。
- `src/components/Canvas.tsx`：读取已提交版本，经原有合并/CAS后定位Creator结果，校验画布/项目/资产身份。
- `src/components/nodes/LocalizationMasterNode.tsx`：安装请求前后保持相同状态行几何；install声明为非生成操作。
- `src/hooks/useRunTrigger.ts`：零输出维护操作记录progress并完成权威终态，真实生成结果仍走素材事务。
- `src/utils/canvasPerformance.ts`、`src/components/CanvasNodeRenderMode.tsx`：原性能档位及冷热显示合同保留。

本地忽略证据：`local-private/issues-20261121/github-snapshot.json`及`source-audit.json`。快照只保存公开Issue正文和纯文本评论；不含凭据、用户数据库或业务素材。本轮未运行新的Provider任务、下载安装模型、打开留存数据库或用重复本地绿测冒充缺失现场证据。

既有验证与发布事实见[11月17日](github-issues-20261117.md)、[11月12日](github-issues-20261112.md)和[v3.5.4](release-v3.5.4.md)。原标签、正文及开放状态保持；后续按新反馈或实际验收证据推进，F8–F10和严格27/32不变。
