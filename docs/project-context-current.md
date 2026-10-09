# 当前项目上下文

更新：2026-10-10。仅维护当前事实；长期规则见根 `SKILL.md` 和 `AGENTS.md`。本页预算 80 行 / 8 KiB，旧检查点迁入专题，不追加长日报。

- 默认目录 `E:\PenguinPravite\T8-penguin-canvas`；branch `codex/release-v3.0.8-volcengine-assets-ux`，common dir `.git`。开工以git/worktree门为准；正式源码/Tag固定后记录在发布专题，不移动。
- package `3.3.1` 获当前用户授权，正在发布前检查，尚未打包/发布；见[发布专题](release-v3.3.1.md)。上一稳定版v3.3.0源码/Tag及六资产冻结，见[旧发布](release-v3.3.0.md)。
- 本版安装升级、用户现场和 F8–F10 按 `owner-approved-post-release-v3.3.1` 后补，不视为通过；Mac仍为 ad-hoc 未公证预览，仅额度不足可延期。

## 当前检查点

数据路径迁移已随 v3.2.2 双平台发布：容量提示显示盘符和所需/剩余 GiB，错误页及设置页可迁移至其他盘；保留原目录，详情及测试边界见[专题](desktop-data-storage.md)。

| 事项 | 当前事实与下一步 |
| --- | --- |
| 平价香蕉2.1 / Flux / Vidu Q4 | 六模型开发完成，v3.3.1发布准备中；Flux新Tab，旧默认不变。八条实网成功并完整解码，R2V转MP3；159/159回归、独立后端49/49及类型/双语/能力同步通过。八份无凭据工作流见[专题](nb21-flux-viduq4.md)；安装版及端到端UI未验收。 |
| 自动更新退出 | 已随v3.3.0双平台发布；74项限定用例及正式包probe通过。先保存/关闭后台，安装器不强杀；Git对象恢复及现场升级边界见[专题](auto-update-exit-fix-20261008.md)。 |
| 启动诊断/修复 | 日志随v3.2.8发布；同次校验复用、候选备份独立线程、活动旧名补回随v3.2.9双平台发布。修复51项、发布前55/55及打包22/22通过，组重叠不相加；合成库重开1316→547ms，不替代用户现场，见[修复](startup-history-fix-20261008.md)及[日志](startup-diagnostics.md)。 |
| 工坊香蕉2.1 | 已随v3.2.6双平台发布，仅新增模型，旧默认/参数不变；真实文生图与图生图通过。见[专题](nano-banana21-workshop.md)。 |
| RH 媒体误判 | 已随v3.2.6双平台发布：媒体保留上传；专项18/18、相邻40/40通过。两个应用真实元数据确认误判，一个真实素材上传/任务/结果完整解码成功；安装版未复验。见[专题](rh-media-field-validation-20261007.md)。 |
| 画布归档/新建默认来源 | 已随v3.2.5双平台发布：schema33正式迁移、大管理窗口、归档只读/恢复和权威写入门；全局来源只初始化空白通用image/edit/video，不改旧节点。最终功能27/27、持久化25/25、历史保真80/80、生产处理器9/9，组重叠不相加；浏览器点击工具无响应，端到端UI未验收。见[功能专题](canvas-archive-media-defaults.md)。 |
| Seedream Flash | 已随v3.2.4双平台发布：既有 Seedream/分层 Tab 接入国内与海外六路径；真实六任务成功，13/13 结果下载、完整解码并查看，COS 官方别名只读 GET 散列一致。263/263 回归及类型/双语/能力同步门通过；Pro 默认/限制不变，六份无凭据工作流已完成；见[专题](seedream-v5-flash.md)。 |
| GitHub PR / Issues | 10月1日：0开放PR、5开放Issues。#30 RH真实枚举与#31启动拒绝后卡锁限定修复提交 `276a2c6`，14项新专项及十套回归81/81通过，已随v3.2.3发布；#31具体输入变更来源待复现，5项均保留验收边界。详见[本轮专题](github-issues-20261001.md)；#29历史证据见[前次专题](github-issues-20260918.md)。 |
| 文档轻量化 | 已完成：根手册与当前上下文均在预算内，原文逐字节归档；features/roadmap 按需读。8组校验通过，1353份源码/配置/原测试/技能散列未变，详见[校验记录](../local-private/context-maintenance/verification.json)。后续遵守手册开头预算。 |
| 生成历史 | 当前支持范围已随 v3.1.6 发布；19个完整客户端场景/25项、React UI 13项、限定回归56/56通过，通过进程正常退出/强制0/残留0。完整状态与剩余范围见[验收清单](generation-history-acceptance-status.md)及[证据索引](generation-history-acceptance-20260912.md)。 |
| Provider 超时策略 | 已随 v3.1.7 发布：移除媒体生成通用代理 90 秒边界，并覆盖扩展适配器、工具箱自定义轮询、导演分镜与崩溃恢复；媒体全链路最低 15 分钟，LLM 默认且最长 3 分钟，连接探测/重试间隔不变。详情用 `feature providerTimeoutPolicy20260913` 查询。 |
| TUN/代理最大兼容与日志恢复 | 已随 v3.1.8 发布：受信 Provider 域名结果不再预判 `resolveHost` 地址或维护 Fake-IP 白名单，Chromium 系统网络及失败后的同任务 GET 回退均接受任意有效解析地址；仅字面量本机/内网与本地域名仍拒绝，普通 URL 安全策略不变。另有 Mihomo IPv6/国内 DoH 兼容和终端日志 14 天脱敏恢复。专项 34/34、TypeScript 与双平台正式包通过；真实受影响 TUN 客户端/安装版证据后补。详见 `feature tunIpv6AndTerminalLogRecovery20260913`。 |
| v3.2.1 历史发布 | 固定 Tag/源码 `v3.2.1` / `2dc205dfe6dc743195eeb5aa57db27c0da1fa29f` 保持冻结；六资产及两个更新清单已完整回下载通过，详见[专题](release-v3.2.1.md)。 |
| schema32 画布恢复 | 已随 v3.2.1 发布：同库旧 canonical backup/代次不一致可生成十分钟一次性恢复方案，用户在只读界面确认后恢复并保留故障证据；UUID/校验/方案任一不匹配继续阻断，ACK 只前进不回退。专项、相邻矩阵与真实 HTTP 确认 47/47；真实用户旧库证据待补。详见 `feature schema32ExplicitRecovery20260928`。 |
| Qwen 2.1 / Animate | 已随 v3.2.0 发布：图像/视频节点独立 Tab、精确参数、恢复、可信结果落盘和四份无凭据工作流已接入。T2I、I2I、Animate 三任务均到达 `succeeded`，Animate 产物完成下载解析；Qwen 当次结果下载受本机 Node TLS 中断，未重交付费任务。详见[专题](qwen21-animate-motion-transfer.md)和 `feature qwen21AnimateMotionTransfer20260922`。 |
| 历史修复最终限定检查 | 专题清单与 features 回执已同步为 19/25+React UI 13、限定回归56/56；本轮按暂停点复核后未重跑。支持范围已接受；用户旧库、安装升级、断电、真实Provider、外部设备与其他未适配输入仍不计通过。 |
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
