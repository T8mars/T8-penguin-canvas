# v3.5.3 Flash/H3 扩展与 RH 枚举修复发布

2026-11-17 完成用户授权的 Windows/macOS 同源发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.5.3)。正式源码、Tag 和 Release target 固定为 49926729c23f1c92eb4d7d7221cecc0a7a462071，公开时间 2026-11-17T07:48:34Z；旧 v3.5.2 Tag 及六资产冻结。

## 功能与验证

本版包含[Seedance 2.5 Flash/H3 十模型与 17 工作流](sd25-flash-h3.md)，以及 [RH COMBO 漏解析修复](github-issues-20261117.md)。旧模型、旧画布渠道、明确默认偏好、Run 权威身份与付费提交不重放规则保留。

十模型真实提交、原任务查询、安全落盘及全片解码通过；模型专项和相邻回归 124 项、完整开发 App 十模型及独立 SD2.5 共十一运行通过。RH 真实元数据只读查询、58 项回归及完整开发画布通过；本轮 RH 没有收费生成。这些测试组不相加冒充独立总数，原失败及边界见各专题。

28 项发布/打包合同、能力同步、中英文检查通过。Windows 使用 Node 22.23.0 完成唯一正式前端构建、后端/私有扩展加密、双运行时归档、native rebuild、NSIS、asar、provenance 和 sealed recovery；正式包实际执行十模型共享工厂/声明和新建 TEMP 数据库备份重开、真实存储关闭探针，外网调用 0；前端已检出新模型和 RH typed descriptor 分支。

Windows 原发布器在草稿阶段完整回下载 EXE、blockmap、latest.yml，核对整文件 SHA-256、EXE SHA-512、字节数、GitHub digest、sealed recovery 和更新清单后发布 Latest。下载仅复用上一版已验证的只读分片传输，固定本版 Tag/源码及资产身份，8 MiB 分片、4 并发、有界 GET 重试；没有改动产品发布器或用本地安装包代替远端下载。

首轮脚本保留 NativeCommandError 日志和退出码 1；正式包已完成并 sealed、三资产已上传，重启打断了完整回下载。第一次恢复未留下完成回执，核对时进程已退出、工具会话失效；随后使用独立后台 PowerShell 7、原 sealed 字节及已校验的 44 个分片恢复，原发布器确认 no rebuild required，完成剩余下载及发布。原始日志与退出码未覆盖，不冒称首次调用无故障完成；最终恢复证据为 windows-recovery-2.log / windows-recovery-2-result.json。

[Mac workflow 44041644888](https://github.com/T8mars/T8-penguin-canvas/actions/runs/44041644888)第 1 次成功，从同一 Tag 在真实 macos-15 arm64 构建、ad-hoc 签名并追加三资产；runner 原验证器完整回下载，核对 size/SHA-256、ZIP SHA-512 和更新清单。本机复核两端日志、资产指纹、两个公开 Latest 更新清单以及 Mac 追加后的 Windows 元数据。Windows 追加前后及旧 v3.5.2 Tag/六资产未变。额度查询 404/缺 scope 仅记未知，实际构建成功，未因额度延期。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest-mac.yml | 536 | b57a42f567b66f46eac9fd3ea92640610b74efa76def63b15a2feeb33a3700f0 |
| latest.yml | 362 | ed61da7843c57c40519e3f7ebc944e8cd79376eeaae04a51ce0ec1ba5f61a08a |
| T8-PenguinCanvas-3.5.3-mac-arm64.dmg | 519874940 | 2c75078886ff4a0501012bf63f2f721a907da2d662ce979ae2daa6bc25f2d428 |
| T8-PenguinCanvas-3.5.3-mac-arm64.zip | 511603378 | 1d2cc66b390514ff5db0b8430824b678afeffa8c8249d9a499a8ce3a59707cfa |
| T8-PenguinCanvas-Setup-3.5.3.exe | 1380093739 | eee64a00d051dab83b3799fd8ac51dcfca9b8fb1bc3666e8b9bca0c753a06b08 |
| T8-PenguinCanvas-Setup-3.5.3.exe.blockmap | 1439523 | 77c02cde38bd5c2d681f62ae59c8c4029a059cc1bcc3b8858d5f82749a04f21c |

## 边界

私有证据在 local-private/release-v3.5.3/；根 SKILL、私有源、配置和凭据不公开。用户现场、完整安装升级、受影响 Mac 和 F8–F10 按 owner-approved-post-release-v3.5.3 后补，不记为通过；严格 27/32 不变。Mac 为 ad-hoc 未 Apple 公证预览。事实提交不移动 Tag、不重建正式包。
