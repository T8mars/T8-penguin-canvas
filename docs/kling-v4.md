# Kling 4：既有视频节点中的模型扩展

2026-10-27 开发完成，用户追加授权v3.4.5发布，进度见[发布专题](release-v3.4.5.md)。位置：**视频 → 贞贞的平价AI小屋 → Kling → 具体模型**。增加五个选项，不增加节点类型，旧 Kling 默认与协议保持原样。

| 模型 | 输入与结果 |
| --- | --- |
| `kling-v4-t2v` | 提示词 → 视频 |
| `kling-v4-i2v` | 首帧、可选尾帧 → 视频；不发送比例 |
| `kling-v4-omni` | 文本、图片、视频、主体/音色 ID → 视频 |
| `kling-v4-custom-element` | 正面图与不同视角图，或单个主体视频 → 主体 ID |
| `kling-v4-custom-voice` | 原始音频或提供商 videoId → 音色 ID、可选试听 |

三种视频支持 3–30 秒整数、720p/1080p；文生比例 21:9/16:9/1:1/9:16，Omni 另支持 adaptive。水印提供服务默认/关闭/开启三态，不混入旧负面提示词、Seed、声音或多镜头开关。英文字符数/26000 + 非英文字符数/11000 ≤ 1；I2V 提示词可选。

Omni 最多 10 图、5 视频、7 主体、3 音色；图/视频/主体合计≤15，视频主体≤3，视频与视频主体合计≤5，参考视频总时长≤30秒。图片主体与视频主体 ID 分开输入，按官方顺序合并。保留素材顺序，超限明确报错，不截断。每图最多30MiB；视频直链每段最多300MiB，本地上传沿用共享50MiB限制。

图片主体要求2–4张不同图片，正面在前；每张最多10MiB、最短边300px、比例0.4–2.5。共享上传前转PNG并检查重复。视频主体要求单个3–8秒MP4/MOV、1920×1080或1080×1920；直链最多200MiB、本地最多50MiB。主体名称1–20字、描述1–100字；支持关联一个音色及o_101至o_108标签。

音色使用≤10MiB音频或提供商videoId二选一。**videoId不是生成task_id。**实网发现voiceName上限20字符，已校验1–20字符。官方将主体/音色列为免费辅助接口，视频按平台实际消耗结算；以平台账单为准。

主体/音色结果按 `result_text.results[].name` 提取ID，保存为带schema的文本资产；没有试听仍可成功。节点展示ID/复制按钮/试听。把结果文本连到Omni即可自动取对应ID；音色节点的试听不作为Omni原始音频发送，其他无关音频仍报错。主体/音色不会伪装成视频结果。现有null输出口按模型解析类型，前后端同一合同，85种节点数量不变。

五模型共用 `/v1/video/generations` 提交/原任务查询。沿用独立平价Key、媒体最低15分钟、RunIntent/Run/NodeRun/Attempt、共享下载与资产落库。受理不明时不自动重交；明确受理后保存任务身份，中断/重开仅GET原任务。终态失败才清除待查身份；结果落盘失败继续原任务下载。异步界面写回检查画布/实体/归档状态，离开画布的结果保留在共享历史。历史记录精确输入；参数恢复不覆盖当前素材URL或主体/音色ID，完整输入恢复范围不扩大。

## 已执行的验证

- 官方[llms.txt](https://api.seedance.nz/docs/llms.txt)与本机 `ComfyUI_Seedance/core/kling_v4.py`、节点定义交叉核对；参考项目独立节点设计没有照搬到T8。
- 真实API六条成功：音频建音色、图片建主体、带音色的视频建主体、T2V、双帧I2V、图片/视频/两种主体/音色共同输入Omni。三个视频和试听全量下载、ffprobe及FFmpeg完整解码通过。三个视频分别636608、643228、742516字节，均约3.042秒；I2V实际940×940，其余1280×720。
- 初次音色名22字符被上游任务拒绝；保留失败后缩短名称，只对该确定参数错误定向重测。无网络失败自动重交。提供商videoId建音色仅合同覆盖，未声称实网通过。
- 133项专项/相邻回归通过：协议、限额、顺序、异常、原任务GET、端口、工作流、旧视频执行/历史/来源与恢复。
- 完整开发App/Canvas在新建临时SQLite实际操作通过：参数编辑、五模型选择、ID与试听落库、主体/音色连接Omni、停止/保存/重载/GET续查、浅深色及中英文。仅外部HTTP使用夹具；实网证据为上一条独立API验证。CPU10%、Job4GiB、Node768MiB、Go512MiB；峰值Job约1.53GiB，正常退出、强杀0、残留0。不是安装版/用户现场/F8–F10验收。
- 复现入口：`node scripts/generate-kling-v4-workflows.cjs`；`pwsh -NoProfile -File scripts/run-history-low-load.ps1 -Mode KlingCanvas`（需配置已有Playwright依赖路径）。

私有证据：[实网报告](../local-private/kling-v4-20261027/live-report.json)、[首次成功](../local-private/kling-v4-20261027/live-first-success.json)、[失败记录](../local-private/kling-v4-20261027/live-initial-failure.json)、[画布报告](../local-private/kling-v4-20261027/canvas-ui.json)、[画布截图](../local-private/kling-v4-20261027/canvas-complete.png)、[回归](../local-private/kling-v4-20261027/regression.log)、[资源回执](../artifacts/history-low-load-runner/b6f996d4bc4b4d96975abe61f1705c76.json)。密钥只在一次性进程中使用，不写文件。

## 无凭据工作流

- [文生视频](workflows/kling-v4-t2v.json)
- [首尾帧图生视频](workflows/kling-v4-i2v.json)
- [Omni](workflows/kling-v4-omni.json)
- [图片建主体](workflows/kling-v4-element-images.json)
- [视频建主体](workflows/kling-v4-element-video.json)
- [音频建音色](workflows/kling-v4-voice-audio.json)
- [提供商videoId建音色](workflows/kling-v4-voice-provider-id.json)（需用户自己的有效ID，未实网验证该分支）
- [音色→主体→Omni连接复用](workflows/kling-v4-linked-omni.json)

工作流仅含空素材槽/空ID字段和示例提示词；不含测试Key、任务身份、测试主体/音色ID或产物URL。导入后先上传自己的素材；不会自动执行。
