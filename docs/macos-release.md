# macOS 桌面发布流程

本流程用于 T8 Penguin Canvas 的 Apple Silicon（arm64）DMG、ZIP 与 `latest-mac.yml`。Windows 继续使用原有本机正式 `dist:release` / NSIS 流程；两套产物进入同一个正式 GitHub Release，但任何一方都不得覆盖另一方资产或移动已经发布的 Tag。

## 当前边界

- 首个 Mac 包为 v3.0.0 Apple Silicon 技术预览，最低 macOS 12。
- 当前仓库尚未配置 Apple Developer ID 与公证凭据，因此首包只做 ad-hoc 完整性签名，不冒充 Apple 签名或公证版本。
- 首包包含画布、数据库、云端 Provider、私有后端能力和 Mac 原生 FFmpeg / FFprobe。
- Windows 专用 `remove-ai-watermarks` / ParseHub Python 离线归档不会塞进 Mac 包；相关本地工具需要用户自行安装兼容 Python 环境。其缺失不得影响普通画布和云端节点启动。
- 首个未公证预览升级到未来 Developer ID 正式版时，按手动覆盖安装处理；配置正式签名后，后续版本才把 `latest-mac.yml` + ZIP 视为可交付的 Mac 自动更新链路。

## v3.1.1 已发布结果

- Windows 与 Mac 固定源码/Tag：`6188f7547062e9c01578994fb5247f8e30f3f208` / `v3.1.1`，进入同一非草稿、非预发布 Latest Release：<https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.1.1>。
- v3.1.0 的 Windows 链完成后，真实 Mac workflow <https://github.com/T8mars/T8-penguin-canvas/actions/runs/33285931497> 在 electron-builder 阶段精确拦截 `auxiliary-models.json` 双来源写入同一目标的 `EEXIST`；该失败未生成或上传 Mac 资产，公开 Tag 未移动。
- v3.1.1 移除重复资源映射并由专项回归锁定；成功的真实 Apple Silicon workflow：<https://github.com/T8mars/T8-penguin-canvas/actions/runs/33286855296>，于 `2026-08-30T02:05:01Z` 完成。runner 端和本机独立验证都完整回下载三项 Mac 资产。
- Windows 安装包 1,321,222,616 bytes / SHA-256 `12d45cc3bf390f69325d0a69af5a38a5c57a6ab3c30ca967453d2ff032667f17`；blockmap 1,376,749 bytes / `da933e86432d7d09e81785f862d5db2f59a9f0969dee30144bcd7822cb89daaf`；`latest.yml` 362 bytes / `8e767d8794efafcd9c3bec3599554baf796f4b4508add1d9e905220d178f2c65`。
- `T8-PenguinCanvas-3.1.1-mac-arm64.dmg`：493,680,189 bytes，SHA-256 `f5358085dc70fb8516aa6930dcde7b8cb6851afc0decb5f906bddf1c41c43962`。
- `T8-PenguinCanvas-3.1.1-mac-arm64.zip`：486,361,409 bytes，SHA-256 `96b1c1fcff69bfe625eabdcbca58e6534adf4e9fe554bdc57b8edad10f5973b5`。
- `latest-mac.yml`：536 bytes，SHA-256 `47084088199a3aea1dd9da3bf509b5fb3e6034ed6e13e89097e8c0af14d0fd31`；ZIP size/SHA-512 与下载字节一致。
- 当前仍为 ad-hoc 完整性签名、未使用 Apple Developer ID、未公证技术预览；不得描述为 Apple 已认证包。

## v3.0.9 已发布结果

- Windows 与 Mac 固定源码/Tag：`d6ed9c0bb0445d99823a5811935c8d4e2d1359d0` / `v3.0.9`，进入同一非草稿、非预发布 Latest Release：<https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.0.9>。
- 真实 Apple Silicon workflow：<https://github.com/T8mars/T8-penguin-canvas/actions/runs/33084748534>，于 `2026-08-27T15:00:20Z` 成功完成；runner 端和本机独立验证都完整回下载三项 Mac 资产。
- `T8-PenguinCanvas-3.0.9-mac-arm64.dmg`：468,399,962 bytes，SHA-256 `64dc6a724b71dd5906c79ca64db554074f783db58b5e6e54f696078a2a3a1fb3`。
- `T8-PenguinCanvas-3.0.9-mac-arm64.zip`：461,304,305 bytes，SHA-256 `98fdf87857f4192fcc3e99725b0426603425251ce1b41739e8f85223f4a74be2`。
- `latest-mac.yml`：536 bytes，SHA-256 `a4dd8699441bd0a6f0f1a68d6c451dc848eceddd136a7e8eb29d2de50da953f3`；ZIP size/SHA-512 与下载字节一致。
- 当前仍为 ad-hoc 完整性签名、未使用 Apple Developer ID、未公证技术预览；不得描述为 Apple 已认证包。

## v3.0.0 已发布结果

- 正式 Release：<https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.0.0>，非草稿、非预发布。
- Mac 固定源码：`v3.0.0-mac.5` / `69fbf1182d63f7e2c4347abbc88c70496ebad491`。
- 成功 workflow：<https://github.com/T8mars/T8-penguin-canvas/actions/runs/32723305324>，于 `2026-08-24T11:50:40Z` 完成。
- 原 Windows Release target 继续固定为 `92ca7a4ee8748f46fdfb1b624bff26acda6b18dd`，正式 `v3.0.0` Tag 未移动；原 EXE、blockmap、`latest.yml` 的 size/SHA-256 均未改变。
- `T8-PenguinCanvas-3.0.0-mac-arm64.dmg`：467,685,444 bytes，SHA-256 `f4bfbcbd8eaadecdfa889e47307e531bb6b4b77a61dc54356319ff7ce1c4b6fe`。
- `T8-PenguinCanvas-3.0.0-mac-arm64.zip`：460,594,158 bytes，SHA-256 `15042ffbe98afbf9780369a31d56989cca4fd92618b49998f55c819195d3799e`。
- `latest-mac.yml`：536 bytes，SHA-256 `b300ff5fd29b4fd55a7736268246b4ca00b741f5d2bd0025bedf80c19b41a3a0`。
- macOS runner 与独立 Windows 复核均完整回下载三项 Mac 资产，并通过 GitHub size/SHA-256 与更新清单 ZIP size/SHA-512 校验。
- 此包已做 ad-hoc 完整性签名，但未使用 Apple Developer ID、未公证。首次打开应在 Finder 中右键应用并选择“打开”；不得把它描述成 Apple 已认证正式签名包。

## 固定不变量

1. Mac 包只能在真实 Apple Silicon macOS runner 上构建，当前固定 `macos-15`；禁止在 Windows 上交叉打包后冒充实机验证。
2. `T8_RELEASE_TARGET` 必须是 40 位源码提交，且必须等于 `HEAD` 和远端 `T8_MAC_SOURCE_REF`。
3. 正式源码必须无 tracked 漂移；私有后端通过 GitHub Actions 加密 Secret 恢复，值不得写入日志、源码、产物清单或 Release notes。
4. Windows 专用运行时只在 `build.win.extraResources`；Mac 只打包本机安装得到并通过 Mach-O/arm64 检查的 FFmpeg、FFprobe、Sharp 与 better-sqlite3。
5. Mac 产物固定为：
   - `T8-PenguinCanvas-<version>-mac-arm64.dmg`
   - `T8-PenguinCanvas-<version>-mac-arm64.zip`
   - `latest-mac.yml`
6. 上传器没有 `--clobber`。同名远端资产只有字节数和 GitHub SHA-256 均与本地一致时才能作为幂等恢复；不同即失败关闭。
7. 发布后必须把三项资产重新完整下载，逐项核对字节数、GitHub SHA-256，并验证 `latest-mac.yml` 中 ZIP 的 size 与 SHA-512。
8. 现有 Release target、Windows Tag、EXE、blockmap 和 `latest.yml` 在 Mac 追加过程前后必须完全不变。

## 首次 v3.0.0 追加 Mac 包（已执行留档）

v3.0.0 的 Windows Tag 已固定在旧源码提交。Mac 构建支持是在发布后补入的，因此本次使用透明的递增辅助源码 Tag，未移动 `v3.0.0`。`v3.0.0-mac.1` 拦截了不完整的私有前端恢复；`v3.0.0-mac.2` 拦截了 electron-builder `afterSign` Hook 层级错误；`v3.0.0-mac.3` 拦截了空 `CSC_LINK` 被当成证书路径；`v3.0.0-mac.4` 已生成 runner 本地产物，但 post-build 拦截了错误的启动器体积阈值和 builder 未实际执行 ad-hoc 签名。四轮均未上传资产。`v3.0.0-mac.5` 完成真实构建、上传和远端复核；所有辅助 Tag 均已固定，不得移动或复用：

1. 在核心目录完成代码、测试、文档与 `features.json`，提交并推送 `origin/main`。
2. 将新的递增辅助 Tag（最终成功 Tag 为 `v3.0.0-mac.5`）固定到该提交并推送；每次修复都增加序号，禁止移动旧 Tag。
3. 确认仓库 Secret `T8_MAC_LOCAL_PRIVATE_BUNDLE_B64` 已由本机四个私有后端源制作，`T8_MAC_LOCAL_PRIVATE_FRONTEND_BUNDLE_B64` 已由四个正式前端入口/依赖制作；两者均为 tar.gz Base64。只检查“已配置”，绝不回显内容。
4. 手动运行 `.github/workflows/release-macos.yml`：
   - `release_tag=v3.0.0`
   - `source_ref=v3.0.0-mac.5`
   - `publish=true`
   - `signing=unsigned-preview`
5. Workflow 在 `macos-15` arm64 上执行依赖安装、定向合同测试、前端构建、Electron V8 字节码加密、私有后端加密、FFmpeg/FFprobe 准备、better-sqlite3 重建、DMG/ZIP 生成、Mach-O/媒体/签名/DMG/ZIP/更新清单验证，再只追加缺失资产。
6. 发布器在 v3.0.0 Release notes 追加 macOS 来源、签名边界和资产摘要；随后完整回下载三项 Mac 资产并复核。本次上述步骤已全部成功完成。

## 从下个版本开始的 Windows + Mac 同版流程

下个版本不再使用辅助 Mac Tag。两个平台必须来自同一固定正式源码提交和同一个 `v<version>` Tag：

1. 在核心目录完成版本号、README、`features.json`、根 `SKILL.md`、Release notes 和全部技术门禁，提交并推送固定源码到 `origin/main`。
2. 创建并推送正式 `v<version>` Tag，Tag 只指向该固定源码。
3. Windows 在本机私有发布环境执行原有唯一一次 `T8_RELEASE_APPROVAL=release-<version> npm run dist:release`，生成并发布 EXE、blockmap、`latest.yml`。
4. 紧接着运行 `release-macos.yml`，令 `release_tag` 与 `source_ref` 都等于同一个 `v<version>`，并设 `publish=true`。
5. 未配置 Apple Developer ID 时只能选择 `unsigned-preview` 并在 Release 明示；配置证书、公证 Key 和团队信息后必须选择 `signed-notarized`，此模式缺任一凭据都会失败关闭。
6. 最终同一个 Release 必须至少包含 Windows 三项和 Mac 三项；分别使用 Windows 与 Mac 验证器完整回下载，不用一个平台的窄检查替代另一个平台。
7. 只有 Release target/Tag、六项资产、两个自动更新清单、签名边界和下载摘要全部一致，才可在 `features.json` 与根 `SKILL.md` 记录正式完成。

## GitHub 配置（只记录名称）

必须配置：

- `T8_MAC_LOCAL_PRIVATE_BUNDLE_B64`
- `T8_MAC_LOCAL_PRIVATE_FRONTEND_BUNDLE_B64`

Developer ID 正式发布另需以下两组之一的公证凭据，并需要 `CSC_LINK` / `CSC_KEY_PASSWORD` 导入签名证书：

- App Store Connect API：`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`
- Apple ID：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`

不得把任何 Secret 值写入 Git、日志、`SKILL.md`、`features.json` 或 Release notes。

## 本地与 CI 命令

- Mac 构建入口：`npm run dist:mac`
- Mac 上传入口：`npm run release:mac`
- Mac 远端复核：`npm run release:mac:verify`
- Windows 正式入口保持：`npm run dist:release`

这些命令都有版本级授权、源码 SHA、远端 Ref、平台、架构和资产漂移门，不能绕过脚本直接用 electron-builder 或 `gh release upload --clobber` 代替。

# v3.0.9 启动与性能控制体验发布授权（2026-08-27）

v3.0.9 只纳入核心目录开发启动稳定性和顶部画布性能控制条整合，完整继承 v3.0.8 及更早能力。Windows 必须先从固定源码提交与正式 `v3.0.9` Tag 完成低资源正式链；随后真实 `macos-15` arm64 runner 必须从同一个 Tag 构建 ad-hoc 签名技术预览 DMG、ZIP 与 `latest-mac.yml`，追加到同一个非草稿、非预发布 Release，并完整回下载三项 Mac 资产。两端固定源码、Release target、Windows 资产、Mac 资产与两个更新清单不一致时必须失败关闭。

# v3.0.8 火山素材选材与本地中转发布完成（2026-08-27）

v3.0.8 已从同一个固定源码提交 `5ad4408a9eefbc4c6bf32606a86ad8167e84f528` 和正式 `v3.0.8` Tag 生成 Windows 与 Apple Silicon 资产，并进入同一个非草稿、非预发布 Latest Release：<https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.0.8>。本版完成核心火山素材节点的单一有界预览栏、逐项删除/清空、通用 auto-Output 退出与安全遗留清理，并复用现有云上传目标完成本地文件中转导入。Windows 核心目录低资源正式链完成构建、加密、双运行时、native rebuild、NSIS、7/7 `app.asar` 启动合同、provenance、sealed recovery、上传、完整回下载和恢复清理。真实 `macos-15` arm64 workflow <https://github.com/T8mars/T8-penguin-canvas/actions/runs/33050616302> 完成同源私有源恢复、ad-hoc 签名技术预览 DMG/ZIP/更新清单、追加上传及 runner 完整回下载；本机独立验证再次完整下载并核对三项 Mac 资产。

Windows 安装包为 1,354,463,465 bytes / SHA-256 `18d50bcef887a0c1ae4459dbe91841ec19395a9b96b46148ba0acce84bb1f999`，blockmap 为 1,413,574 bytes / `cba423e4ee5aace84122e56228c62f93747558f481a34064491fa5055fd824f1`，`latest.yml` 为 362 bytes / `1dcca85d8daf4e4ba29785b2346e5d8a59398e02771768709a95e9d45a07451b`。Mac DMG 为 468,423,467 bytes / `ecb51699973761f40e2615e2eaa8443edf69c6bc5f5c4269faaf113af79b21a2`，ZIP 为 461,302,294 bytes / `c7fdc3912928a4e7794b2e14580ef9da6d0c594f2e29db4eea726412ee6420aa`，`latest-mac.yml` 为 536 bytes / `b3bac7017e33bd4c0e1672a7bf6d5b7576a226167ef0d50b00d4b4a8d7beacf9`。六项 GitHub digest/size、两个自动更新清单、Release target、Tag commit、workflow source 与 Latest 均一致；Mac 仍是 ad-hoc 签名、未 notarize 的技术预览。

# v3.0.8 火山素材选材与本地中转发布授权（2026-08-27）

v3.0.8 只纳入核心 `volcengine-assets` 的单一已选素材预览栏、逐项删除/清空、通用 auto-Output 物化退出及安全遗留清理，以及复用现有云上传目标的本地文件中转导入；完整继承 v3.0.7 及更早能力。Windows 必须先从固定源码提交与正式 `v3.0.8` Tag 完成低资源正式链；随后真实 `macos-15` arm64 runner 必须从同一个 Tag 构建 ad-hoc 签名技术预览 DMG、ZIP 与 `latest-mac.yml`，追加到同一个非草稿、非预发布 Release，并完整回下载三项 Mac 资产。两端固定源码、Release target、Windows 资产、Mac 资产与两个更新清单不一致时必须失败关闭。

# v3.0.7 火山 PR 状态保真发布完成（2026-08-27）

v3.0.7 已从同一个固定源码提交 `05b9086e57334b6b46fcf5256b87466353ab0e67` 和正式 `v3.0.7` Tag 生成 Windows 与 Apple Silicon 资产，并进入同一个非草稿、非预发布 Latest Release：<https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.0.7>。本版完成 PR #28 的 12 文件协议审计并修复旧 `Processing / Active / Failed` 选择状态在迁移/重载时丢失的问题；未合并 PR 中缺失前端、显式 `Host`、任意 CommonJS 宿主或敏感持久化。Windows 核心目录低资源正式链完成构建、加密、双运行时、native rebuild、NSIS、7/7 `app.asar` 启动合同、provenance、sealed recovery、上传和三资产完整回下载。真实 `macos-15` arm64 workflow <https://github.com/T8mars/T8-penguin-canvas/actions/runs/32993331496> 完成同源私有源恢复、ad-hoc 签名技术预览 DMG/ZIP/更新清单、追加上传及 runner 三资产完整回下载；随后本地独立验证再次完整下载三项 Mac 资产。

Windows 安装包为 1,354,459,972 bytes / SHA-256 `264aa349b1448471cb645c2cac7611b1ba6defbf65b4cb9b593c48049a8d14a6`，blockmap 为 1,413,207 bytes / `2adb9d26747e44dfab349663fab5a242c4f4729909c1a5f44dc53e9aa0035759`，`latest.yml` 为 362 bytes / `627dd9137977c7b66a8ee0f67c30c56abcb26212cfe9b4f4b8fd5ed33cc6a90f`。Mac DMG 为 468,381,079 bytes / `62d131e7db9f83e22e38ac0be0b5854da5d06da45e539524f7023268e18f4b7a`，ZIP 为 461,299,243 bytes / `2f6a1e523d53550a0fe82352c68050d64f8f169f85663c86aab05b59a229beb1`，`latest-mac.yml` 为 536 bytes / `2370e49e15d4145764c0391a732477b3d681c31ef35b369abbbf5628cafbdd9f`。六项 GitHub digest/size、两个自动更新清单、Release target、Tag commit 与 Latest 均一致；Mac 仍是 ad-hoc 签名、未 notarize 的技术预览。

# v3.0.7 火山 PR 状态保真发布授权（2026-08-27）

v3.0.7 只修复 GitHub PR #28 旧 `volc-asset` 数据在核心迁移和重载时被错误提升为 Active 的状态保真问题，并完整继承 v3.0.6 及更早功能。Windows 必须先从固定源码提交与正式 `v3.0.7` Tag 完成低资源正式链；随后真实 `macos-15` arm64 runner 必须从同一个 Tag 构建 ad-hoc 签名技术预览 DMG、ZIP 与 `latest-mac.yml`，追加到同一个非草稿、非预发布 Release，并完整回下载三项 Mac 资产。两端固定源码、Release target、Windows 资产、Mac 资产与两个更新清单不一致时必须失败关闭。

# v3.0.6 火山素材任务恢复发布完成（2026-08-27）

v3.0.6 已从同一个固定源码提交 `47c3d4aa10825d409deb98bcc266cf50fb437c80` 和正式 `v3.0.6` Tag 生成 Windows 与 Apple Silicon 资产，并进入同一个非草稿、非预发布 Latest Release：<https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.0.6>。本版安全吸收 PR #28 的火山素材导入任务持久化、按需状态恢复和旧 `volc-asset` 画布迁移，没有引入任意 CommonJS 插件宿主、显式 `Host` 请求头或路径/响应泄露。Windows 核心目录使用单核、BelowNormal、`ELECTRON_BUILDER_COMPRESSION_LEVEL=0` 的低资源正式链完成三资产发布与完整回下载；真实 `macos-15` arm64 workflow <https://github.com/T8mars/T8-penguin-canvas/actions/runs/32987354091> 以 `release_tag=v3.0.6`、`source_ref=v3.0.6`、`publish=true`、`signing=unsigned-preview` 完成 DMG/ZIP/更新清单、追加上传及三资产完整回下载。

Windows 安装包为 1,354,460,018 bytes / SHA-256 `49fad093930a587526ae0428aa0b474327a9b466166707935e63371c97a7f3b9`，blockmap 为 1,413,092 bytes / `15f80f9ba0aff074393008bed6a89a6a56cc918813ff7252b1b06b72919d5bf3`，`latest.yml` 为 362 bytes / `5119cecd6fcc800fcc7bd79c607fa7cb83a3c65e6dc757e456705468d22aacf0`。Mac DMG 为 468,445,338 bytes / `1ad1147c427a241bf5803c57e400e0e23a5c8aff8a177dfc23a99d4a07c398df`，ZIP 为 461,298,875 bytes / `972659e23b0018e9d955aa4b56d8ccd47f459026e208a672cb33a38c72afcaab`，`latest-mac.yml` 为 536 bytes / `320268579ba6b9adf3ad13f16e195ffb021370c0eeac958e1b18e50436f8cd13`。六项 GitHub digest/size、两个自动更新清单、Release target、Tag peeled commit 与 Latest 均一致；Mac 仍是 ad-hoc 签名、未 notarize 的技术预览。

# v3.0.5 双平台启动修复发布完成（2026-08-26）

v3.0.5 已从同一个固定源码提交 `d806dcddb4bf42d596e80e23f6ee3a50b5df67a2` 和正式 `v3.0.5` Tag 生成 Windows 与 Apple Silicon 资产，并进入同一个非草稿、非预发布 Latest Release：<https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.0.5>。本版补齐 `electron/i18n.cjs` 与 `electron/i18n-catalog.json`，Windows 与 macOS post-build 都通过共用的 7 项 `app.asar` 主进程启动合同。Windows 核心目录低资源正式链完成 NSIS、自动更新清单、provenance、sealed recovery、发布与校验；真实 `macos-15` arm64 workflow <https://github.com/T8mars/T8-penguin-canvas/actions/runs/32970660172> 以 `release_tag=v3.0.5`、`source_ref=v3.0.5`、`publish=true`、`signing=unsigned-preview` 完成同源绑定、私有源恢复、原生依赖、ad-hoc 签名、DMG/ZIP/清单验证、追加上传与三资产完整回下载。

Windows 安装包为 1,354,449,298 bytes / SHA-256 `fda5e9f55a6a5533bd43665cec735345560669e699ad2be8ac2f7b30ad96d680`，blockmap 为 1,413,385 bytes / `9b9b19cdd167a0dcb9bfb3325c3be086895e31d4e947cf4aa8d7f6f6c14c6c31`，`latest.yml` 为 362 bytes / `86cb22b40108f420803d8e72527f5eaa9b122a3779edc79287786ee219ebdcb8`。Mac DMG 为 468,460,995 bytes / `f4fe3af8bcc4777614997f4a48b67609afdfc12b5a7f70f3efbd1b0db02ee4ee`，ZIP 为 461,288,346 bytes / `80570dde9f97609c7efc8d851171fc8ed9fc818a15dc8123621e7defcdce1ebc`，`latest-mac.yml` 为 536 bytes / `3490b34b579734ab127698bd8a32181c41560f9749cb0156a9f859a5bbbd8580`。六项 GitHub digest/size、固定 Tag/target、两个自动更新清单与 Latest 均一致；Mac 仍未使用 Apple Developer ID、未 notarize，维持技术预览边界。

# v3.0.4 同源发布完成（2026-08-26）

v3.0.4 已按 Windows 与 Mac 同一固定提交、同一个正式 `v3.0.4` Tag、同一个 GitHub Release 的规则完成发布。固定源码为 `916007dd3b05abd3e7f84e7a6ac69fc010ac42b7`；Windows 在核心目录通过低资源 `dist:release` 完成 NSIS、blockmap、`latest.yml` 和三资产完整回下载，Mac 由真实 `macos-15` arm64 workflow <https://github.com/T8mars/T8-penguin-canvas/actions/runs/32902049267> 完成构建、ad-hoc 签名、追加上传和三资产完整回下载。正式 Release 为 <https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.0.4>，非草稿、非预发布且为 Latest，target 与 Tag 的 peeled commit 均保持固定源码不变。

Mac DMG 为 468,308,603 bytes / SHA-256 `8834401dec5f5969e16687b52527459ddaeb7dc87c0386c867190605054462e5`，ZIP 为 461,121,544 bytes / `c32d0134bd59880581b9ea7c120e10e1c2be66682c9e2fb842e1e96a2eabc386`，`latest-mac.yml` 为 536 bytes / `21ddada43a45b9d8479b72b8a7b126e280813988db4e4ab1bfc472036c577afc`。同一 Release 的 Windows 安装包为 1,354,295,401 bytes / `62a00ca1f534f0e83b3a6db8bf2169858ee0d7a63a66815c5f6529f4d3643c26`，blockmap 为 1,414,035 bytes / `d60adf03a5f002a08503a07c233e4726bf6001234b394855bcb01be72c49c0df`，`latest.yml` 为 362 bytes / `55593e4d9d07e2109876aa9021f5b08226c2c7277f9cf41d65d2404d0c7e414e`。Mac 仍未使用 Apple Developer ID、未 notarize，维持明确的技术预览边界。

# v3.0.2 annotated tag 失败与 v3.0.3 修复（2026-08-26）

v3.0.2 的 Windows 三项自动更新资产已通过正式门禁并发布。随后同一正式标签触发的真实 `macos-15` arm64 workflow `32882092427` 在任何 Mac 构建与资产上传前失败关闭：旧 `dist-macos.cjs` 只读取 `git ls-remote origin refs/tags/v3.0.2` 的首项，将 annotated tag 对象 SHA 当成提交 SHA，与正确的 `HEAD` / `T8_RELEASE_TARGET` 比较后误判漂移。

v3.0.2 标签与资产保持冻结，不移动、不覆盖、不复用。v3.0.3 起，源码门同时请求直接引用和 `refs/tags/<tag>^{}`，优先取 peeled commit；lightweight tag 仍回退到直接引用，缺失引用仍失败关闭。修复由 annotated/lightweight/missing 三类测试锁定，Windows 与 Mac 重新从同一个 v3.0.3 固定提交和正式标签发布。

v3.0.3 已由固定提交 `64d9a708dd92d38a77b710e06855ddcf6b4e652c` 正式发布到 <https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.0.3>。真实 Mac workflow <https://github.com/T8mars/T8-penguin-canvas/actions/runs/32886208665> 成功通过源码绑定、私有源恢复、arm64 构建、ad-hoc 签名、FFmpeg/FFprobe、DMG/ZIP/清单验证及三资产完整回下载；DMG 为 468,133,250 bytes / SHA-256 `18ab11a8dfbf4f23a6a66f8167160a6bae1f00c758ddcd9ca796e181b890dfa5`，ZIP 为 461,084,588 bytes / `98ca092ffd2d5047276774880cec969dc7c99b9a82ebe3913681ee81a9be5aa0`，`latest-mac.yml` 为 536 bytes / `e8cc436f720968f90a26cafdeef4a7a6c0d08af399da635e20e296ab321471e1`。同一 Release 的 Windows 三资产也已完整回下载，并保持同一 target 与 Latest。
