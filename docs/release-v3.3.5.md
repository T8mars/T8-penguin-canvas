# v3.3.5 Strata 本地 LLM 发布

2026-10-19，用户明确授权更新根手册、features、Electron打包、推送GitHub及自动更新Release；外部证据后补，Mac仅GitHub额度不足可延期。版本3.3.4→3.3.5，当前为发布准备，不提前记录成功。

## 范围与发布前事实

- 仅包含[Strata接入](strata-llm.md)及两轮独立20轮审查累计8项修复；沿用现有节点、Run和持久化，不增加数据库schema，不修改Strata或全局默认来源。
- 最新源码315/315限定回归、TypeScript、能力清单、i18n、public、diff与上下文预算门通过。最新完整开发App/Canvas/后端/临时SQLite隔离验收16项通过，Run/NodeRun/Attempt成功、停止、失败一致；runner/child退出0，强制0、残留0。重叠旧测试不累加。
- 发布合同27/27通过。首轮26/27失败是测试仍将本次新版本列为拒绝项，已同步精确授权版本，并保留旧版/未来版/错误授权拒绝断言；没有放宽损坏证据门。正式构建此前未开始。
- 前轮真实模型文字/多轮/JSON/视觉/取消及画布13项证据保留；本轮冷启动上游503/WinError5未通过，不能冒称已修。用户明确其他人在使用，暂不操作该服务，不重启或卸载模型。
- 外部证据仅对精确版本`owner-approved-post-release-v3.3.5`允许缺失清单延期；过期/损坏/不匹配仍拒绝，27/32及F8–F10不变。
- 固定源码推送及正式Tag之后只运行一次Windows正式链：保留私有侧车、加密、运行时、原生依赖、NSIS、asar、provenance、sealed recovery和完整回下载门。后续事实补记不移Tag、不重建。
- Mac同正式Tag、真实macos-15 arm64、ad-hoc未公证预览。额度API404/缺scope不能当作不足，正常尝试工作流；结果后补。

## 证据与未覆盖

本地`local-private/strata-llm-audit-20261019-round2/`保留独立R01–R20审查、失败冷启动及最新`canvas-fixture/canvas-ui.json`；同次低负载回执`35a9755ab72745da86fee928a7bfdc8f.json`已核对正常退出、强制0、残留0，峰值Job约1.49GiB。正式发布证据集中在ignored `local-private/release-v3.3.5/`，不公开原始日志/私有源码/密钥。

Strata冷启动、LAN、其他GPU、逐个消费者长任务、安装升级、用户现场及F8–F10未验收。Creator、原生视频/ASR、Strata引擎管理和在线世界生成不在本版范围。
