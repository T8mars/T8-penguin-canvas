# macOS 桌面发布流程

本流程用于 T8 Penguin Canvas 的 Apple Silicon（arm64）DMG、ZIP 与 `latest-mac.yml`。Windows 继续使用原有本机正式 `dist:release` / NSIS 流程；两套产物进入同一个正式 GitHub Release，但任何一方都不得覆盖另一方资产或移动已经发布的 Tag。

## 当前边界

- 首个 Mac 包为 v3.0.0 Apple Silicon 技术预览，最低 macOS 12。
- 当前仓库尚未配置 Apple Developer ID 与公证凭据，因此首包只做 ad-hoc 完整性签名，不冒充 Apple 签名或公证版本。
- 首包包含画布、数据库、云端 Provider、私有后端能力和 Mac 原生 FFmpeg / FFprobe。
- Windows 专用 `remove-ai-watermarks` / ParseHub Python 离线归档不会塞进 Mac 包；相关本地工具需要用户自行安装兼容 Python 环境。其缺失不得影响普通画布和云端节点启动。
- 首个未公证预览升级到未来 Developer ID 正式版时，按手动覆盖安装处理；配置正式签名后，后续版本才把 `latest-mac.yml` + ZIP 视为可交付的 Mac 自动更新链路。

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

## 首次 v3.0.0 追加 Mac 包

v3.0.0 的 Windows Tag 已固定在旧源码提交。Mac 构建支持是在发布后补入的，因此只允许创建透明的辅助源码 Tag `v3.0.0-mac.1`，不得移动 `v3.0.0`：

1. 在核心目录完成代码、测试、文档与 `features.json`，提交并推送 `origin/main`。
2. 将 `v3.0.0-mac.1` 固定到该提交并推送。
3. 确认仓库 Secret `T8_MAC_LOCAL_PRIVATE_BUNDLE_B64` 已由本机四个私有后端源制作的 tar.gz Base64 写入；只检查“已配置”，绝不回显内容。
4. 手动运行 `.github/workflows/release-macos.yml`：
   - `release_tag=v3.0.0`
   - `source_ref=v3.0.0-mac.1`
   - `publish=true`
   - `signing=unsigned-preview`
5. Workflow 在 `macos-15` arm64 上执行依赖安装、定向合同测试、前端构建、Electron V8 字节码加密、私有后端加密、FFmpeg/FFprobe 准备、better-sqlite3 重建、DMG/ZIP 生成、Mach-O/媒体/签名/DMG/ZIP/更新清单验证，再只追加缺失资产。
6. 发布器在 v3.0.0 Release notes 追加 macOS 来源、签名边界和资产摘要；随后完整回下载三项 Mac 资产并复核。

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
