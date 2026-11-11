# v3.5.2 创作助手与安装收尾发布

2026-11-12 完成用户授权的 Windows/macOS 同源发布：[Latest Release](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.5.2)。正式源码、Tag 和 Release target 固定为 1d7061c0e6d2be92797b9e3f2ff0d12d485915e7，公开时间 2026-11-11T21:03:38Z；旧 v3.5.1 Tag 及六资产冻结。

## 功能与验证

本版包含[本轮 Issues 修复](github-issues-20261112.md)：Creator 结果发送/查看同步权威画布并保留同期本地编辑，读取失败不重复放置或生成；本地化安装状态行不再触发无关布局拦截；共享非生成维护完成路径修正安装和火山素材刷新收尾。运行身份、输入一致性、许可证及权威输出事务继续保留。

84 项专项及相邻回归、完整开发版 App 五项、28 项发布/打包合同检查通过，不把交集测试累加。开发 App 的 Run / NodeRun / Attempt 成功终态及正常退出、强制 0、残留 0 已核对；本地引擎接口使用夹具，没有冒充真实模型安装。

Windows 使用 Node22.23.0，完成唯一正式前端构建、后端与私有扩展加密、双运行时归档、native rebuild、NSIS、asar、provenance 和 sealed recovery。正式包中已检出本轮 Creator/维护补丁标记，并实际执行加密共享工厂和全新 TEMP 数据库备份重开、真实存储关闭探针，外网调用 0；这些不替代完整安装升级验收。

首次直连上传偏慢，停止的仅是本轮上传客户端；原发布进程退出 1、草稿及 sealed recovery 均保留。随后经既有代理恢复，并做一次 HTTP/1.1 传输比较，仍只补传缺失安装包，未重新构建或替换已有资产。原始、代理与 HTTP/1.1 恢复日志分别保存在 windows-formal-node22.log、windows-recovery-proxy.log、windows-recovery-http1.log；前两次网络进程中止不冒记为一次无故障发布。

连续回下载曾遇到 unexpected EOF；原第二次只读重试被停止，保留失败记录。随后只对下载传输使用 8 MiB 分片、4 并发、有界 GET 重试和校验缓存；产品源码/Tag、原发布器、Nonce 归属、整文件 SHA-256/SHA-512、大小及更新清单校验均未放宽。分片边界/合并与适配器范围测试通过，真实小清单下载及最终原验证器完整回下载通过，日志为 windows-recovery-ranged.log。缓存数据来自远端 GET，没有用本地安装包冒充回下载。

[Mac workflow 43099891142](https://github.com/T8mars/T8-penguin-canvas/actions/runs/43099891142)第 1 次成功，从同一 Tag 在真实 macos-15 arm64 构建、ad-hoc 签名、检查并追加三资产，runner 的 Mac 验证器完整回下载并核对 SHA-256/size、ZIP 的 SHA-512 和更新清单。Windows 发布器也已完整回下载三资产；没有在慢链路重复下载已验证的大文件。本机核对两端实际日志、资产指纹及两个公开 Latest 更新清单，Mac 追加后再次运行 Windows 元数据验证器；Windows 在 Mac 追加前后及旧 v3.5.1 Tag/资产未变。未因额度延期；额度查询 404/缺 scope 仅记为未知。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| latest-mac.yml | 536 | b961f665c877a05319af5055aa75d299a7f17d14da10a0153d6873782166ae3b |
| latest.yml | 362 | e5c55a5fa68ac6cd2e7b45844d7670e25d637c36853ea63bd04538ed9ed2f4fa |
| T8-PenguinCanvas-3.5.2-mac-arm64.dmg | 519786579 | 125420f54f0a79997fd47f75acf7914ed698b8ab8ce72449d61d13c203223581 |
| T8-PenguinCanvas-3.5.2-mac-arm64.zip | 511578134 | eacfbfce136c1d58871da9e438ab2a783a53f8c3ed1f590d8cde714fe86a7e30 |
| T8-PenguinCanvas-Setup-3.5.2.exe | 1380068975 | 645cfc430533bf62c302f96e8be8ec89432d75736ed905ae57965098d156c4f1 |
| T8-PenguinCanvas-Setup-3.5.2.exe.blockmap | 1439684 | f914dc6563c21e10a2dc54d5e027e80b8b3fc1cf28f18281d287763bf5343c45 |

## 边界

私有证据在 local-private/release-v3.5.2/；根 SKILL、私有源、配置与凭据不公开。真实模型安装、受影响 Mac、用户现场和安装升级未代验，F8–F10 按 owner-approved-post-release-v3.5.2 后补，严格 27/32 不变。Mac 为 ad-hoc 未 Apple 公证预览。事实提交不移动 Tag、不重建正式包。
