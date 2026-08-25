# macOS 桌面发布流程

本流程用于 T8 Penguin Canvas 的 Apple Silicon（arm64）DMG、ZIP 与 `latest-mac.yml`。Windows 继续使用原有本机正式 `dist:release` / NSIS 流程；两套产物进入同一个正式 GitHub Release，但任何一方都不得覆盖另一方资产或移动已经发布的 Tag。

## 当前边界

- 首个 Mac 包为 v3.0.0 Apple Silicon 技术预览，最低 macOS 12。
- 当前仓库尚未配置 Apple Developer ID 与公证凭据，因此首包只做 ad-hoc 完整性签名，不冒充 Apple 签名或公证版本。
- 首包包含画布、数据库、云端 Provider、私有后端能力和 Mac 原生 FFmpeg / FFprobe。
- Windows 专用 `remove-ai-watermarks` / ParseHub Python 离线归档不会塞进 Mac 包；相关本地工具需要用户自行安装兼容 Python 环境。其缺失不得影响普通画布和云端节点启动。
- 首个未公证预览升级到未来 Developer ID 正式版时，按手动覆盖安装处理；配置正式签名后，后续版本才把 `latest-mac.yml` + ZIP 视为可交付的 Mac 自动更新链路。

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
# v3.0.2 annotated tag 失败与 v3.0.3 修复（2026-08-26）

v3.0.2 的 Windows 三项自动更新资产已通过正式门禁并发布。随后同一正式标签触发的真实 `macos-15` arm64 workflow `32882092427` 在任何 Mac 构建与资产上传前失败关闭：旧 `dist-macos.cjs` 只读取 `git ls-remote origin refs/tags/v3.0.2` 的首项，将 annotated tag 对象 SHA 当成提交 SHA，与正确的 `HEAD` / `T8_RELEASE_TARGET` 比较后误判漂移。

v3.0.2 标签与资产保持冻结，不移动、不覆盖、不复用。v3.0.3 起，源码门同时请求直接引用和 `refs/tags/<tag>^{}`，优先取 peeled commit；lightweight tag 仍回退到直接引用，缺失引用仍失败关闭。修复由 annotated/lightweight/missing 三类测试锁定，Windows 与 Mac 重新从同一个 v3.0.3 固定提交和正式标签发布。

v3.0.3 已由固定提交 `64d9a708dd92d38a77b710e06855ddcf6b4e652c` 正式发布到 <https://github.com/T8mars/T8-penguin-canvas/releases/tag/v3.0.3>。真实 Mac workflow <https://github.com/T8mars/T8-penguin-canvas/actions/runs/32886208665> 成功通过源码绑定、私有源恢复、arm64 构建、ad-hoc 签名、FFmpeg/FFprobe、DMG/ZIP/清单验证及三资产完整回下载；DMG 为 468,133,250 bytes / SHA-256 `18ab11a8dfbf4f23a6a66f8167160a6bae1f00c758ddcd9ca796e181b890dfa5`，ZIP 为 461,084,588 bytes / `98ca092ffd2d5047276774880cec969dc7c99b9a82ebe3913681ee81a9be5aa0`，`latest-mac.yml` 为 536 bytes / `e8cc436f720968f90a26cafdeef4a7a6c0d08af399da635e20e296ab321471e1`。同一 Release 的 Windows 三资产也已完整回下载，并保持同一 target 与 Latest。
