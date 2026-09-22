# Qwen Image Global 2.1 与 Animate Motion Transfer

更新：2026-09-22。状态：开发完成、真实 Provider 验证完成，尚未发布。

## 权威来源

- 模型目录：<https://api.seedance.nz/docs/llms.txt>
- Qwen Image Global 2.1：<https://api.seedance.nz/docs/qwen-image-global-2.1.md>
- Animate Motion Transfer：<https://api.seedance.nz/docs/animate-motion-transfer.md>
- 参考实现：`F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance`

实现以当前文档和参考节点的交集为合同；字段名、默认值、限制和端点均经真实 API 验证，不从产品名称推断。

## 节点位置与合同

### Qwen Image Global 2.1

放在现有图像节点中，作为独立 `Qwen 2.1` Tab，不混入 Qwen Image 3.0 的尺寸模式。

- 模型固定为 `qwen-image-global-2.1`，提交/查询均走 `/v1/image/generations`。
- Prompt 必填；参考图为 0–10 张，0 张是文生图，1–10 张是图生图/编辑。
- `resolution` 只支持 `1k / 2k / 4k`，默认 `2k`。
- `ratio` 只支持 `1:1 / 2:3 / 3:2 / 3:4 / 4:3 / 9:16 / 16:9 / 21:9`，默认 `3:4`。
- `seed=-1` 只表示前端随机，提交时省略；非负值必须为 JavaScript 安全整数。
- 单次只输出一张图，不发送 Qwen 3.0 的 `size / n / negative_prompt / prompt_extend` 等字段。

### Animate Motion Transfer

放在现有视频节点中，作为独立 `Animate Motion Transfer` Tab，避免与普通文生视频/图生视频混用 Prompt、Seed、音频或时长字段。

- 模型固定为 `animate-motion-transfer`，提交/查询均走 `/v1/video/generations`。
- 必须且只能提供 1 张人物/角色图与 1 个动作视频；两类素材都支持画布连接、本地上传或公网 URL，但同类来源不可重复。
- `resolution` 为 `480p / 720p / 1080p`，默认 `720p`。
- `ratio` 为 `adaptive` 或两边均在 1–999999 的 `W:H`。
- `frame_rate` 默认 30；`max_frames=0` 时省略并使用上游默认 840；`skip_frames` 默认 0。
- 1080p 时 `max_frames` 不能超过 `frame_rate × 10`。
- `pose_method` 为 `vitpose / sdpose / wuwupose`。
- 完整保留 `normal_mode`、`neck_correction`、`pose_strength`、`camera_motion`、`camera_strength`、`mask_mode`、`expression_strength`、`chest_motion_strength`。

两模型沿用平价小屋 API Key、共享 15 分钟媒体边界、受理后同任务轮询、运行恢复和受信 Provider 结果落盘；不会自动重放结果不明的付费提交。

## 可复用工作流

- [Qwen 文生图](workflows/qwen-image-global-2.1-t2i.json)
- [Qwen 图生图](workflows/qwen-image-global-2.1-i2i.json)
- [Animate 本地素材](workflows/animate-motion-transfer-local.json)
- [Animate 公网 URL](workflows/animate-motion-transfer-url.json)

四份文件都是无凭据 `t8-workflow-fragment`，不包含 API Key、任务 ID、签名 URL 或真实产物地址。

## 真实 API 验证

验证脚本：`npm run verify:qwen21-animate:live`。默认依次执行 `t2i,i2i,animate`；崩溃恢复或分段验收可通过 `QWEN21_ANIMATE_LIVE_PHASES` 只选择尚未提交的阶段。凭据只从隐藏标准输入或 `SEEDANCE_API_KEY` 进程环境读取。

| 场景 | Provider 结果 | 本地产物验证 |
| --- | --- | --- |
| Qwen 文生图 | 提交成功，第 3 次轮询 `succeeded` | 终态后 Node 直连下载 TLS 断开；为避免重复计费未重新提交 |
| Qwen 图生图 | HTTP 200，第 4 次轮询 `succeeded`，usage 可见 | 终态已写入脱敏报告；当次结果下载 TLS 断开，未重新提交 |
| Animate 动作迁移 | HTTP 200，第 13 次轮询 `succeeded`，usage 可见 | 219,482 bytes，H.264，480×848，2 秒，SHA-256 `0753bc6fad924eb91eb99c0a0c2e6c58bf27d9991b19bb15736f63b7d5776e45` |

脱敏本地报告位于 `output/qwen21-animate-live-2026-09-22T14-16-19-274Z/report.json` 与 `output/qwen21-animate-live-2026-09-22T14-18-31-866Z/report.json`；`output/` 保持忽略，不进入源码或发行包。报告不保存任务身份、结果 URL、原始响应或凭据。

## 离线验收

- 新模型合同、独立 Tab、素材拖入、参数限制与四份无凭据工作流：26/26 通过。
- Seedance Provider、受信结果下载与运行恢复相邻回归：86/86 通过。
- `type-check`、`i18n:check`、`feature-sync:check`、项目上下文检查与生产 `npm run build` 通过；构建转换 2,985 个模块。
- 宿主 Node 的 `better-sqlite3` ABI 与当前 Electron 二进制不一致，因此未在宿主 Node 下冒充数据库套件通过，也没有为此重编原生依赖或读取保留数据库。

真实验证只证明当次上游合同与任务链可用，不替代长期可用性、计费、安装版、外部用户环境或主观质量验收。
