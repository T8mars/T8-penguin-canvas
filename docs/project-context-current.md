# 当前项目上下文

更新：2026-09-23。仅维护当前事实；长期规则见根 `SKILL.md` 和 `AGENTS.md`。本页预算 80 行 / 8 KiB，旧检查点迁入专题，不追加长日报。

- 默认目录 `E:\PenguinPravite\T8-penguin-canvas`；branch `codex/release-v3.0.8-volcengine-assets-ux`，common dir `.git`。v3.2.0 正式源码与 Tag 固定为 `dfb388c2d2dbae4df3186ea268f69cca96d793ac`，不得移动；实际开工仍以 git/worktree 门为准。
- package 当前为 `3.2.0`（禁止 `3.1.10`）。Qwen Image Global 2.1 / Animate Motion Transfer 双独立 Tab、完整官方参数、恢复/结果落盘与四份无凭据工作流已完成 Windows/macOS 同 Tag 发布；六资产与两个更新清单完整回下载通过。详情见[发布专题](release-v3.2.0.md)。
- v3.2.0 真实受影响用户、安装环境及 F8–F10 证据按 `owner-approved-post-release-v3.2.0` 后补且不视为通过；Mac 为 ad-hoc 签名、未公证技术预览。本次 GitHub 额度充足，未延期 Mac。

## 当前检查点

| 事项 | 当前事实与下一步 |
| --- | --- |
| GitHub Issues 复核 | #29 的 Creator 渠道选择修复已随v3.1.9双平台发布并回复用户，专项3/3及五套回归99/99、TypeScript与发布专项29/29通过；用户“仅打开面板”仍需真实Mac定位。#24/#25继续保留验收边界，详见[专题](github-issues-20260918.md)。 |
| v3.1.9 发布 | Windows 唯一正式链与同源[Mac任务](https://github.com/T8mars/T8-penguin-canvas/actions/runs/35354742555)成功，稳定 Latest/两个更新清单/六资产独立完整回下载通过，Windows资产追加前后不变，recovery已清除；Mac仍未公证，固定Tag不移动。详见[发布专题](release-v3.1.9.md)。 |
| v3.1.8 历史发布 | 六资产已完成同源构建和完整回下载，历史Tag/资产冻结不移动；目前Latest为v3.1.9。旧版发布及首次主机崩溃恢复事实保留在 `feature electronReleaseV318` 与[Mac流程](macos-release.md)。 |
| 文档轻量化 | 已完成：根手册与当前上下文均在预算内，原文逐字节归档；features/roadmap 按需读。8组校验通过，1353份源码/配置/原测试/技能散列未变，详见[校验记录](../local-private/context-maintenance/verification.json)。后续遵守手册开头预算。 |
| 生成历史 | 当前支持范围已随 v3.1.6 发布；19个完整客户端场景/25项、React UI 13项、限定回归56/56通过，通过进程正常退出/强制0/残留0。完整状态与剩余范围见[验收清单](generation-history-acceptance-status.md)及[证据索引](generation-history-acceptance-20260912.md)。 |
| Provider 超时策略 | 已随 v3.1.7 发布：移除媒体生成通用代理 90 秒边界，并覆盖扩展适配器、工具箱自定义轮询、导演分镜与崩溃恢复；媒体全链路最低 15 分钟，LLM 默认且最长 3 分钟，连接探测/重试间隔不变。详情用 `feature providerTimeoutPolicy20260913` 查询。 |
| TUN/代理最大兼容与日志恢复 | 已随 v3.1.8 发布：受信 Provider 域名结果不再预判 `resolveHost` 地址或维护 Fake-IP 白名单，Chromium 系统网络及失败后的同任务 GET 回退均接受任意有效解析地址；仅字面量本机/内网与本地域名仍拒绝，普通 URL 安全策略不变。另有 Mihomo IPv6/国内 DoH 兼容和终端日志 14 天脱敏恢复。专项 34/34、TypeScript 与双平台正式包通过；真实受影响 TUN 客户端/安装版证据后补。详见 `feature tunIpv6AndTerminalLogRecovery20260913`。 |
| v3.2.0 发布 | 已完成：固定 Tag/源码 `v3.2.0` / `dfb388c2d2dbae4df3186ea268f69cca96d793ac` 为稳定 [Latest](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.2.0)。Windows 唯一正式链、provenance、sealed recovery、自动更新三资产和完整回下载通过；同源 [Mac workflow 35751218655](https://github.com/T8mars/T8-penguin-canvas/actions/runs/35751218655) 成功，runner 与本机独立 Mac 验证通过，追加后 Windows 再下载通过，最终六资产。 |
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
