# GitHub PR / Issues 复核与限定修复

日期：2026-10-01。开工目录为 canonical core，branch `codex/release-v3.0.8-volcengine-assets-ux`，基线 HEAD `8a51566e820e11f2dac4405d1c39bdc5c5f5c026`；worktree 门、干净索引及两份保护文件散列通过。GitHub 当次为 0 个开放 PR、5 个开放 Issues；最新正式版仍是 v3.2.2。本轮仅开发修复与问题回复，不升级版本、打包、推送或发布。

## #30：RunningHub 下拉值不匹配

用户给出的 ResolutionSelector 校验错误要求 `21:9 (Ultrawide)`，而画布提交了 `21:9`。源码确认 RunningHub / RH 工具节点仅直接识别数组，遗漏 JSON 字符串及 ComfyUI `[[choices], metadata]`；随后按字段名硬编码枚举，恰好生成截图中的错误选项。RH 工具箱也保留同类猜测词典。

三个入口现共用 `src/utils/rhFieldOptions.ts`：解析真实元数据，原样保留大小写、括号后缀、数字型值与数字外观字符串；不再从字段名发明选项。缺少真实选项时保留可编辑文本及原默认值，不把 INT 等 widget 元数据当枚举。制作器中的非媒体、非 Prompt 未映射文本参数仍可编辑。

RunningHub / 钱包 / RH 工具提交前校验真实枚举；无效旧值在付费 POST 前提示重新选取，不静默迁移旧画布，也不猜测对应项。枚举不经过 Prompt 引用插值或数字转换。站点、Key、GPU 实例、上传、轮询及取消协议不变。

尚未拿到该应用当次脱敏 `nodeInfoList` 或受影响用户环境，测试所用八个枚举来自公开 Issue 的校验错误，序列化方式来自既有项目合同和测试夹具；不声称已经调用该应用实网成功。Issue 保持开放，待补充具体站点、WebApp ID、版本与该字段无凭据元数据。

## #31：本地化安装请求被拦截后按钮卡住

截图日志明确是持久化 Run 创建期间画布/revision/执行输入变化，被 Canvas 一致性门阻断；这发生在本地安装器调用前，不能直接归因于用户 Python、CUDA 或模型下载环境。截图本身不能证明具体是哪项变更或是否误判。

确认的客户端缺陷是 `requestAction` 只看事件能否发出，没有处理 Canvas 的异步拒绝；`pendingActionRef` 和按钮状态只能在未进入的 `useRunTrigger` finally 中清除，导致被拦截后始终禁用。

现为每次用户请求分配独立 requestId，处理 `onSettled` 的拒绝/取消，显示真实拒绝原因、解除该请求启动锁并同步 Agent 请求失败；旧回调不能解除新请求。执行后的清理仍使用同一生命周期。保留持久化 Run、revision/输入一致性和设备许可证检查，不直接绕过 Canvas 调用安装器、不自动重新安装或重交付费任务。

具体输入变化来源仍未复现，需用户提供版本、平台、单独新建空画布能否复现、是否同时操作/运行其他节点及脱敏日志；不索取业务画布、数据库或密钥。Issue 保持开放，不把启动锁修复冒认为安装现场完全解决。

## 其他问题

- [#29](https://github.com/T8mars/T8-penguin-canvas/issues/29)：已发布 v3.1.9 渠道选择事件生命周期补丁，无新回复；真实 macOS“只打开面板”症状仍待复验。本轮不重复改动或关闭。
- [#24](https://github.com/T8mars/T8-penguin-canvas/issues/24)：已有性能优化不重复实现；真实用户重画布、五分钟资源回落与双平台安装场景仍待验收。
- [#25](https://github.com/T8mars/T8-penguin-canvas/issues/25)：主要双语能力保留；全英文 Provider 金路径、边缘面板、缩放及读屏仍待验收。

## 实际验证与边界

- 新专项 14/14 通过：执行生产解析器、真实提交 builder 和真实 `requestAction`，覆盖完整后缀、JSON/嵌套选项、无元数据、单项/标签/零值、无效旧值、拒绝、取消、显式重试及旧回调隔离。修复前已复现错误简写枚举和拒绝后启动锁不释放。
- 锁定 Electron / TypeScript loader、BelowNormal、1.5 GiB 堆、串行十套专项与相邻回归 81/81 通过；包含 RH 工具箱/绑定/双站、本地化直接运行时、统一运行入口和 preflight。
- TypeScript `--noEmit`（BelowNormal / 2 GiB）、中英文 4,856 Key / 83 节点、public、能力清单与 diff 门通过；源码变动后用既有生成器同步能力索引，39 actions / 299 entries / 83 of 83 nodes，0 public gaps。
- 未读取用户或 retained/historical 数据库；未调用付费 Provider、下载模型、真实安装、生产构建或发布。受影响用户、Windows/macOS 安装版与 #31 变更来源尚未覆盖。

## GitHub 处理回执

- [#30 根因、限定补丁及脱敏元数据请求](https://github.com/T8mars/T8-penguin-canvas/issues/30#issuecomment-5916738074)。
- [#31 启动锁补丁、未定位的变更来源及最小复现请求](https://github.com/T8mars/T8-penguin-canvas/issues/31#issuecomment-5916738214)。
- #29/#30/#31 标记 `bug`；#24/#25 保留 `enhancement`。五项继续 OPEN，没有以本地补丁或部分验收代替用户现场确认。
- 本地提交只作可追溯检查点，不代表 GitHub 源码已上线；待当前明确发布授权后再进入生产流程。

## 后续发布授权

用户随后明确授权正式发布，修复已随 v3.2.3 推送固定源码并完成 Windows Latest 和自动更新校验；Mac 同源构建及完整双平台结果集中见[发布专题](release-v3.2.3.md)。此前“仅本地”说明是本轮开发阶段的历史事实；现场复验、RH 实网与 #31 输入变化来源仍未完成，五项 Issues 不自动关闭。

发布后已通知用户升级并保留复验请求：[RH #30](https://github.com/T8mars/T8-penguin-canvas/issues/30#issuecomment-5917500268)、[本地化 #31](https://github.com/T8mars/T8-penguin-canvas/issues/31#issuecomment-5917500737)。

## 本地 Git 对象修复

暂存后 `git diff --cached --check` 检出新 `features.json` blob 的 zlib 校验损坏。工作文件与索引均指向 `b9ec1726b0a27edfc112f6d810d44271017cd81e`；保留坏对象至本地忽略的 `local-private/git-object-recovery-20261001/` 后，从完整工作文件重建同 ID blob，完整读取与暂存 diff 校验通过。未 reset、修改历史、覆盖源文件或删除故障证据；此检查不等于整库或物理磁盘健康验收。
