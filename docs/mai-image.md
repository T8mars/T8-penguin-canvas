# 平价小屋 Mai 图像

更新：2026-10-11。模型合同与验证记录；v3.3.3 已获本轮发布授权，实际发布状态见[发布专题](release-v3.3.3.md)。

## 入口与合同

图像节点切到“贞贞的平价AI小屋”，选择新 **Mai** Tab：`mai-image-2-6`、`mai-image-2-6-flash`。默认选普通版；不修改原图像默认模型、旧节点、端口或已有工作流。

依据为当日[官方 API 文档](https://api.seedance.nz/docs/llms.txt)与只读参考项目 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance` 的 `skill.md`、`MAIImage26` 及其测试。共用枚举/限值见 [maiImageContract.json](../backend/src/shared/maiImageContract.json)。

- `POST /v1/image/generations`、`GET /v1/image/generations/{id}`；沿用平价小屋 Key，不接受工坊 Key 代替。
- Prompt 必填，上游约 32000 **Token**，不错误套用字符数上限。0–5 张有序参考图，保留重复槽；超限先提示，不截断。参考图经共享上传器转换为真实 PNG，包含 WebP/GIF 输入。
- 固定 `n=1`，一张 PNG；不发送 Seed、mask、输出格式、质量或其他模型遗留参数。
- 文生图：`size=auto` 或 1:4 至 4:1 的正整数比例，`resolution=1k|2k`；支持自定义比例与精确像素。
- 精确宽高必须成对，每边至少 768，总像素最多 2359296；按原始值校验后向下取整为 32 倍数。宽高替代 `size/resolution`；API 兼容 `WxH/W*H/W×H`。
- 自动画幅启用时发送 `size=auto`；`web_grounding` 是 Bing 联网检索开关，默认关闭。
- 有参考图时，由上游确定约 1M 像素输出；界面隐藏尺寸控件，忽略旧尺寸值，不发送 `size/resolution/width/height/auto_aspect_ratio`。

继续复用共享 RunIntent/Run/Attempt、媒体至少 15 分钟超时、可信 Provider 下载与原子落盘。受理不明不重交，恢复只查询原任务；历史保留 Mai 的显式标量参数。

## 六份可导入工作流

| 模型 | 文生图 | 单图编辑 | 双图参考 |
| --- | --- | --- | --- |
| Mai 2.6 | [1K / 1:1](workflows/mai-image-2-6-t2i.json) | [编辑](workflows/mai-image-2-6-i2i.json) | [组合](workflows/mai-image-2-6-multi-reference.json) |
| Mai 2.6 Flash | [1536×1024](workflows/mai-image-2-6-flash-t2i.json) | [编辑](workflows/mai-image-2-6-flash-i2i.json) | [组合](workflows/mai-image-2-6-flash-multi-reference.json) |

在画布导入 JSON，设置平价小屋 Key；编辑/组合模板的上传节点需要自己的素材。不含凭据、任务身份、产物 URL 或测试图片。`npm run workflows:mai` 可重建模板；工作流按生产解析器、运行身份和来源预检验证。

## 验证与边界

实网：使用本轮提供的 Key 完成 **6/6** 原任务，上游 HTTP 200、终态 succeeded。两模型各有文生图、单图编辑和双图参考；六张 PNG 经生产可信下载器及原子落盘，全部完整解码、非空检查通过。普通版文生图为 1024×1024，Flash 精确像素请求为 1536×1024，其余四图为 1024×1024。见本地忽略目录 [report.json](../local-private/mai-live-20261011/report.json)。没有重新提交受理不明的任务。

回归：**135/135** 合同、真实上传转换、超限/参数失败前置、原任务 GET 恢复、工作流、历史、双语面板、生产事件处理器及相邻模型用例通过，见 [最终日志](../local-private/mai-live-20261011/regression-tests-complete.log)。TypeScript、双语键与能力同步通过；目录为 315 个运行条目，节点保持 83 个。

后端运行身份、Creator 执行、原任务恢复与能力清单 **49/49** 通过，见 [最终后端日志](../local-private/mai-live-20261011/backend-tests-final.log)。早期失败日志保留：旧测试夹具缺少新闭包标志、按旧内联文本检查已提取的共享 Seedream 合同，以及 Windows 临时目录清理 ENOTEMPTY；只校正夹具/有界清理重试，没有更改旧模型产品逻辑。第一次 TypeScript 的 768 MiB 堆不足，改用单核低优先级、有限 3 GiB 堆后通过。未将失败运行改写为通过。

边界：联网检索、2K、自动/自定义比例和五图极限为离线合同验证，不冒认为逐组合实网通过。完整浏览器端到端、安装版、用户现场与 F8–F10 按 `owner-approved-post-release-v3.3.3` 后补且未验收；没有效果评测。发布技术门不可延期。

复验：`npm run verify:mai:live`，隐藏 stdin 输入 Key，只传子进程环境，不存盘。默认证据目录复用已验证结果与原任务身份，拒绝再次付费 POST；不要删除状态文件来触发重交。私有证据与素材不公开或打包。
