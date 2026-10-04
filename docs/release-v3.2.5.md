# v3.2.5 画布归档与新建默认来源发布

日期：2026-10-05。用户明确授权两项开发完成后更新 SKILL/features、打包 Electron、推送新版本并更新稳定自动更新 Release；证据后补，Mac仅额度不足可延期。本版正式源码与 Tag 固定为 `3556ae4cc3de40cbb1d47df6397aef0965d8e432` / `v3.2.5`，Windows唯一正式链和[同源Mac任务37240013784](https://github.com/T8mars/T8-penguin-canvas/actions/runs/37240013784)均成功。[稳定Latest](https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.2.5)非草稿、非预发布；六资产与两个更新清单已独立完整回下载通过，Windows资产未变，recovery已清除。Mac本轮未延期，不冒称已查询额度余额。

内容和验证边界见[功能专题](canvas-archive-media-defaults.md)，用户可见说明见[Release notes](../release-notes/v3.2.5.md)。新建来源不改变既有节点；schema33 为正式附加迁移，首次升级保留可验证 canonical 备份，旧版不能直接打开新库。真实 UI/安装升级/用户旧库、资源负载和 F8–F10 仍待补。

版本 package/lock/README/features/工作流同步为 3.2.5。`owner-approved-post-release-v3.2.5` 仅允许本版缺失的外部证据延期，错误授权、旧/未来版本和已有无效证据继续失败关闭。正式 Windows 链只运行一次；固定源码推送、Tag 冻结、provenance 与 sealed recovery、私有前后端、运行时归档、包内检查和远端完整回下载不可省略。使用 BelowNormal、单核、Node 3 GiB、零压缩及依赖支持的系统 7-Zip，不改受保护文件。

Mac 必须从同一固定 Tag 在真实 macos-15 arm64 runner 构建并追加三资产，不覆盖 Windows 或远端同名资产；保持 ad-hoc 未公证预览。仅实际额度不足可延期，权限错误不等于额度不足。完成后追加事实，不移动已发 Tag 或重建安装包。

## 实际正式链与资产

发布合同26/26、TypeScript、4903条双语、83节点生成能力、公开/工具箱/文档预算门通过；开发组详见功能专题，不累加重叠计数。Windows一次正式链完成2996模块生产构建、Electron33.4.11加密、私有前后端、两份运行时归档、native rebuild、NSIS、8项app.asar启动依赖、安全检查、provenance与sealed recovery。草稿三资产完整回下载与安装包size/SHA-512通过后发布Latest。Windows包内共享默认合同与源码逐字节一致，SHA-256 `a5042476302b75da63dce6ad2910b0e319d8765e0e5380e395dd59acf1ad386d`；两份core保护文件字节和散列未变。

真实macos-15 arm64任务从同一Tag完成私有源恢复、原生依赖、2996模块构建、加密、ad-hoc签名、8项app.asar启动依赖、媒体工具、DMG/ZIP/更新清单检查及追加上传，runner完整回下载通过；任务于 `2026-10-04T22:34:21Z`（北京时间10月5日06:34:21）成功完成。本机随后独立再次完整下载Mac三资产，核对GitHub size/SHA-256和ZIP size/SHA-512；追加后的Windows三资产也再次完整回下载，与本地产物和追加前散列一致，`latest.yml`安装包size/SHA-512通过。Mac未使用Developer ID、未公证，这不等于实际Mac安装/更新已验收。

| 资产 | 字节 | SHA-256 |
| --- | ---: | --- |
| `T8-PenguinCanvas-Setup-3.2.5.exe` | 1,375,943,377 | `d056b01cd62e9eba756d728705a150f05dd6ff2490dfccc2cc00147529b961df` |
| `T8-PenguinCanvas-Setup-3.2.5.exe.blockmap` | 1,435,617 | `1f7be62fa0a216add33a4d6ed6b9fb33d7a5eaa0de85849c765cb2d6f56a00f0` |
| `latest.yml` | 362 | `1d4050e2f8763321d06cf62e414885f9b8d59c3c31eaa6865001e52862a67b84` |
| `T8-PenguinCanvas-3.2.5-mac-arm64.dmg` | 514,556,514 | `57b35794c2eb38a21a5e90e1f24e2a8208e29f9bfa1fd009ac3d8105fc1e40c2` |
| `T8-PenguinCanvas-3.2.5-mac-arm64.zip` | 506,532,574 | `89ca9f9cf24a39fa71bda5d27277925f545d1b97fe969c2badd4c629042d982c` |
| `latest-mac.yml` | 536 | `b1dd0f1fed528e27f165d62d221fe9dba92117771b5d4b3b3f93bf3f11657cb8` |

临时下载由验证器清理。忽略的脱敏日志：[Windows正式链](../local-private/release-v3.2.5/windows-formal.log)、[Mac任务](../local-private/release-v3.2.5/mac-workflow.log)、[Mac独立验证](../local-private/release-v3.2.5/mac-independent-verify.log)、[Windows最终验证](../local-private/release-v3.2.5/windows-final-verify.log)。真实UI、安装升级、用户旧库、资源负载及F8–F10仍按授权后补，不计通过。后续仅提交发布事实，Tag与安装包永久冻结。
