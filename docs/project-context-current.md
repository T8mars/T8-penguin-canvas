# 当前项目上下文

更新：2026-10-21。仅维护当前事实；长期规则见根 `SKILL.md` 和 `AGENTS.md`。本页预算 80 行 / 8 KiB，旧检查点迁入专题，不追加长日报。

- 默认目录 `E:\PenguinPravite\T8-penguin-canvas`；branch `codex/release-v3.0.8-volcengine-assets-ux`，common dir `.git`。开工以git/worktree门为准；正式源码/Tag固定后记录在发布专题，不移动。
- package `3.3.8` 已获授权准备发布，尚未正式构建；见[发布专题](release-v3.3.8.md)。旧v3.3.7 Tag/六资产冻结，未覆盖。
- 本版安装升级、用户现场和 F8–F10 按 `owner-approved-post-release-v3.3.8` 后补，不视为通过；Mac为ad-hoc未公证预览，仅额度不足可延期。

## 当前检查点

数据路径迁移已随 v3.2.2 双平台发布：容量提示显示盘符和所需/剩余 GiB，错误页及设置页可迁移至其他盘；保留原目录，详情及测试边界见[专题](desktop-data-storage.md)。

| 事项 | 当前事实与下一步 |
| --- | --- |
| DSH接入（v3.3.7） | 38项已接管，修限额声明/无效运行审批；193项回归与DSH临时库组合通过，单一意图/素材/放置及GET恢复成立。真实窗口/Provider未验，见[交接](dsh-native-integration-20261020.md)。 |
| 画布保存冲突 | 已随v3.3.6双平台发布：有界合并与冲突确认，两次20主题复查；215回归、隔离画布25项通过。旧确认/加载不回退、目录不复活、医生移动协议修正。CAS不放宽，现场/安装版后补，见[专题](canvas-save-conflict-20261019.md)。 |
| Strata本地LLM | 已随v3.3.5双平台发布：两轮20轮审查修8项，315回归及最新隔离画布16项通过。前轮真实识图通过，本轮冷启动上游503未通过；用户要求服务先不动。范围/未验收见[专题](strata-llm.md)。 |
| ArtCraft体验增强 | 已随v3.3.4双平台发布：灵感板/编辑版本/独立世界节点/Story草稿；完整App实链、28主题组合、142项及正式构建通过。排除/搁置项见[专题](artcraft-canvas-ux.md)。 |
| 节点清晰度 / 平价香蕉低价 / 豆包 | v3.3.4已发布；实网8/8解码、14主题672组样式/控件及相关回归通过。安装版/用户GPU未验，模型与工作流见[专题](nb-lowprice-doubao.md)。 |
| Mai / Topaz | 分别随v3.3.3/v3.3.2双平台发布；实网完整解码与限定回归通过，完整UI/安装版未验收，见[Mai](mai-image.md)、[Topaz](topaz-video-upscale.md)。 |
| 平价香蕉2.1 / Flux / Vidu Q4 | 已随v3.3.1双平台发布；六模型、Flux新Tab，旧默认不变。八条实网成功并完整解码，R2V转MP3；159/159回归、独立后端49/49通过。八份无凭据工作流见[专题](nb21-flux-viduq4.md)；安装升级及端到端UI未验收。 |
| 自动更新退出 | 10/21源码修复未发布：保留真实关闭回执、延迟完成自动续装、只读故障面板；真实Electron/SQLite/测试NSIS两项通过。现场仍待验，见[专题](auto-update-close-hold-20261021.md)。 |
| 启动诊断/修复 | v3.2.8/3.2.9已发布；同次校验、候选线程、旧名补回通过限定回归，现场未验。细项见[修复](startup-history-fix-20261008.md)及[诊断](startup-diagnostics.md)。 |
| 工坊香蕉2.1 | 已随v3.2.6双平台发布，仅新增模型，旧默认/参数不变；真实文生图与图生图通过。见[专题](nano-banana21-workshop.md)。 |
| RH 媒体误判 | 已随v3.2.6双平台发布：媒体保留上传；专项18/18、相邻40/40通过。两个应用真实元数据确认误判，一个真实素材上传/任务/结果完整解码成功；安装版未复验。见[专题](rh-media-field-validation-20261007.md)。 |
| 画布归档/新建默认来源 | 已随v3.2.5双平台发布：schema33正式迁移、大管理窗口、归档只读/恢复和权威写入门；全局来源只初始化空白通用image/edit/video，不改旧节点。最终功能27/27、持久化25/25、历史保真80/80、生产处理器9/9，组重叠不相加；浏览器点击工具无响应，端到端UI未验收。见[功能专题](canvas-archive-media-defaults.md)。 |
| Seedream Flash | 已随v3.2.4双平台发布；国内/海外六路径、六份工作流，Pro默认不变。六任务成功、13结果完整解码；263项回归及同步门通过，见[专题](seedream-v5-flash.md)。 |
| GitHub PR / Issues | 10月1日记录与#30/#31限定修复（v3.2.3）见[专题](github-issues-20261001.md)；#29见[前次](github-issues-20260918.md)，现场验收边界保留。 |
| 文档轻量化 | 原文逐字节归档、features/roadmap按需读；继续遵守预算，历史证据见[记录](../local-private/context-maintenance/verification.json)。 |
| 生成历史 | 当前支持范围已随 v3.1.6 发布；19个完整客户端场景/25项、React UI 13项、限定回归56/56通过，通过进程正常退出/强制0/残留0。完整状态与剩余范围见[验收清单](generation-history-acceptance-status.md)及[证据索引](generation-history-acceptance-20260912.md)。 |
| Provider 超时策略 | 已随 v3.1.7 发布：移除媒体生成通用代理 90 秒边界，并覆盖扩展适配器、工具箱自定义轮询、导演分镜与崩溃恢复；媒体全链路最低 15 分钟，LLM 默认且最长 3 分钟，连接探测/重试间隔不变。详情用 `feature providerTimeoutPolicy20260913` 查询。 |
| TUN/代理与日志 | 已随v3.1.8发布：受信Provider域名交给系统网络，不预判Fake-IP；字面量内网/本地域名仍拒绝，普通URL策略不变。日志14天脱敏恢复；34/34及双平台包通过，用户TUN/安装版待验。详见 `feature tunIpv6AndTerminalLogRecovery20260913`。 |
| v3.2.1 历史 | Tag冻结及资产校验见[专题](release-v3.2.1.md)。 |
| schema32 画布恢复 | 已随 v3.2.1 发布：同库旧 canonical backup/代次不一致可生成十分钟一次性恢复方案，用户在只读界面确认后恢复并保留故障证据；UUID/校验/方案任一不匹配继续阻断，ACK 只前进不回退。专项、相邻矩阵与真实 HTTP 确认 47/47；真实用户旧库证据待补。详见 `feature schema32ExplicitRecovery20260928`。 |
| Qwen 2.1 / Animate | 已随 v3.2.0 发布：图像/视频节点独立 Tab、精确参数、恢复、可信结果落盘和四份无凭据工作流已接入。T2I、I2I、Animate 三任务均到达 `succeeded`，Animate 产物完成下载解析；Qwen 当次结果下载受本机 Node TLS 中断，未重交付费任务。详见[专题](qwen21-animate-motion-transfer.md)和 `feature qwen21AnimateMotionTransfer20260922`。 |
| 工坊 Suno V6 | 三版本已随 v3.1.6 发布且有出音证据；wild请求 `chirp-hawk-wild` 实际返回 `chirp-hawk`，身份需渠道确认。保留旧模型/默认与独立平价协议，不再自动付费重试。用 `feature sunoWorkshopV620260912` 查完整记录。 |
| 平价小屋 Suno V6 | 三项动作、34项目录、双语UI和4份无密钥工作流已随 v3.1.6 发布。真实API三动作各有成功案例；失败的纯测试音模型案例明确记录且未冒认。详见[专题与证据](seedance-nz-suno-v6-actions.md)。 |
| Creator 技能市场 | 首期基础能力已随 v3.1.6 发布；真实模型作品、质量盲评、新手试点、生态治理和完整整体验收仍未完成。用 `feature creatorSkillMarket20260910` 查询。 |
| 外部验收 | F8–F10、真实设备与用户环境仍按原约束未完成。临时夹具不替代外部证据。 |

## 按需取上下文

```powershell
node scripts/read-project-context.cjs find history
node scripts/read-project-context.cjs feature generationHistoryRecovery20260910 status
node scripts/read-project-context.cjs feature sunoWorkshopV620260912
node scripts/read-project-context.cjs roadmap 生成历史
node scripts/read-project-context.cjs find 打包
```

工具只读取项目文档；默认输出有限页，显示总行数与后续页命令。需要详细规则时继续翻页，禁止将截断页面当全文已读。完整 features 仍是原路径原结构，无需改现有消费者。
