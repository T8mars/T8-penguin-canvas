# Seedance 2.5 Flash / H3 Comfy 扩展

2026-11-17，开发完成，尚未打包发布；产品版本仍为 3.5.2。旧 H3/Turbo 三模型见 [原专题](h3-turbo.md)。

## 范围

全部使用贞贞的平价AI小屋 `seedance-nz`，不新增节点类型。视频节点的 Seedance 2.5 分类及独立 SD2.5 节点均追加：

- `seedance-2.5-global-flash-multi`
- `seedance-2.5-global-flash-i2v`
- `seedance-2.5-global-flash-t2v`
- `seedance-2.5-flash-i2v`
- `seedance-2.5-flash-multi`
- `seedance-2.5-flash-t2v`

原视频节点的 Minimax H3 Lowprice 分类追加：

- `minimax-h3-comfyui-charswap`
- `minimax-h3-comfyui-wuxi`
- `minimax-h3-comfyui-max-10020`（WF）
- `minimax-h3-comfyui-max-10021`（SelfLift）

原模型、默认模型、旧画布渠道、旧 Standard 30/10/10 上限和旧 Max 的参数合同不变。仅显式切换具体模型时初始化相应默认控件。

## 核实依据及合同

官方 [llms.txt](https://api.seedance.nz/docs/llms.txt) 当日快照与本机 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance\core\seedance25_flash.py`、`core\h3_comfy.py`；该参考项目只读。

Flash 走 `POST /v1/videos`、`GET /v1/videos/{id}`。分辨率仅 480p/720p；4–30 秒或自动（自动时省略顶层 seconds、发送 `metadata.duration=-1`）；不支持 draft。固定时长仍发送字符串 seconds。

- T2V 仅提示词；I2V 接收首帧和可选尾帧，比例仅 adaptive。
- Multi 最多 10 图、5 视频、5 音频；单段音视频 2–30 秒、总计至多 30 秒。图片每张 30 MiB，MP4、MP3/WAV 每个 50 MiB。
- 两入口共享“自动／参考生成／编辑／延长”控件。自动省略 `omni_reference_task_type`；编辑与延长要求视频及 adaptive，编辑还要求自动时长。
- 全部素材先校验、实际读取音视频时长，再上传；保留顺序和重复槽，不截断超限素材。Flash 的 Seed 0 可正确传递。

四个 H3 走 `POST /v1/video/generations`、`GET /v1/video/generations/{id}`；音频用 `metadata.audio_urls`，视频用 **数组** `metadata.video_url`。

| 模型 | 图片 | 音频 | 视频 | 时长与额外要求 |
| --- | --- | --- | --- | --- |
| CharSwap | 必需 1–9，10 MiB/张，合计 50 MiB | 不接受独立音频 | 必需恰好 1 个含音轨 MP4，50 MiB | 5–15 秒或 22+17n 帧（22–362）；帧模式省略 seconds；原生 Seed |
| Wuxi | 至多 9，10 MiB/张，合计 50 MiB | 至多 3，合计 10 MiB | 至多 3 个 MP4，合计 50 MiB；有视频须有图 | 5–15 秒；原生 Seed；不接受 `<Audio n>` 标签 |
| WF | 至多 6，20 MiB/张，合计 80 MiB | 至多 3，合计 10 MiB | 不支持 | 3–15 秒；无原生 Seed；输出 H.265 原文件 |
| SelfLift | 至多 9，20 MiB/张，合计 80 MiB | 至多 3，合计 10 MiB；有音频须有图 | 不支持 | 3–15 秒；无原生 Seed |

图片仅 PNG/JPEG/WebP，音频仅 MP3/WAV；字节、实际解码、合计大小均在第一次上传前检查。CharSwap 在本地检查音轨；不自动改写用户视频。所有时长、分辨率、比例及依赖关系由共享合同控制。CharSwap 的 auto 分辨率只允许 auto 比例；480p/1088p 只允许 auto/16:9/9:16，768p 另外支持 1:1/4:3/3:4/21:9。

原生 Seed 只在 CharSwap/Wuxi 控件出现，-1 省略、0 有效；WF/SelfLift 不携带通用 Seed。Picture/Audio 的编号按实际有序素材数校验。新增字段进入共享节点 schema、历史快照与恢复设置；运行声明、能力目录和恢复器保留准确渠道与模型身份。

## 实网发现与修正

1. CharSwap 无音轨 MP4 被上游明确拒绝。首次任务已终态失败；补加本地检查及中英提示后，使用带音轨测试样片只新建一次修正任务，成功返回 124 帧。没有重交受理不明的任务。
2. WF/SelfLift 的真实 TaskDto 在 `data.model` 分别返回 `minimax-h3-comfyui-max/10020`、`minimax-h3-comfyui-max/10021`。只映射这两个已观察到的精确别名，其他未知或与原任务冲突的身份继续拒绝。两个原任务只重新查询、下载，没有重复生成。
3. WF 实际输出 HEVC，已完整解码；保存原文件，不因浏览器缺少 HEVC 解码能力把生成判为失败。SelfLift 的本次 480p 请求实际返回 1728×960，保留上游原结果，不假称输出必为 480p。

## 工作流与证据

`docs/workflows/` 已保存 17 份：Flash 六模型各有视频节点和 SD2.5 两入口示例，共 12 份；H3 四模型各一份，另有 CharSwap 帧模式示例。文件名以完整模型 ID 命名；SD2.5 示例加 `-sd25`，帧模式加 `-frames`。不含密钥、真实任务身份、产物地址。

实网十个模型均已完成提交、原任务查询、安全落盘、SHA-256 与 FFmpeg 全片解码；共 11 次生成创建（含一次已明确失败的无音轨样片）。预估接口不创建任务。媒体超时沿用最低 15 分钟共享策略，结果下载沿用 trusted Provider 共用路径。

本机忽略证据目录：`local-private/sd25-flash-h3-20261117/`。`verification.json` 汇总十个唯一模型的成功、字节数、散列和真实编码；原失败及修正记录分别保留在 `live-report.json` / `charswap-audio-report.json`，受理不明的创建记录禁止重放。

专项回归、相邻回归及完整 App 状态以同目录报告为准；完整 App 第一次运行因测试脚本把独立 SD2.5 的“生成视频”按钮写成“生成”而中断，十个视频模型生产链路已执行，失败证据保留。修正后完整 App 十模型及独立 SD2.5 共 11 次生产路由/账本运行通过（仅上游网络边界为夹具，不额外付费），含有序混合素材、帧模式、Seed 0、保存刷新及中英/浅深主题；正常退出，强制 0、残留 0。专项及相邻回归 124 个唯一测试通过；两项 C 盘空间门失败已在 G 盘新建临时库复验通过，测试数据库已清理。完整 App 报告见同目录 `canvas-ui.json`，资源回执见 `artifacts/history-low-load-runner/a880d58f017547c6a501b4c552a6122b.json`。安装版、Mac 现场、用户设备及 F8–F10 外部证据本轮未覆盖；自动／编辑／延长的组合边界为离线验证，实网 Multi 样本使用参考生成。

最终 type-check、能力同步、i18n、public-clean、worktree/development、diff 及上下文预算门均通过；两份受保护运行时散列不变。最后一次受影响专项 34/34 通过，没有生产 build。

复用入口：`npm run workflows:sd25-flash-h3`；实网必须显式 `--confirm-live` 且 Key 只放进程环境。完整 App 用 `scripts/run-history-low-load.ps1 -Mode SD25FlashH3Canvas`，遵守原资源门。所有正式 build、打包、版本升级及发布等待用户另行授权。
