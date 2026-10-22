# Moss Image（平价小屋）

状态：2026-10-23 已随v3.4.2同源双平台发布，见[发布事实](release-v3.4.2.md)。真实文生图/单图编辑通过；另一次上游终态失败保留，不冒认全部成功。

## 已核实的协议

依据[官方 API 文档](https://api.seedance.nz/docs/#moss-image)、[llms.txt](https://api.seedance.nz/docs/llms.txt) Moss 专节，以及参考项目 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance` 的 `skill.md`、`nodes.py::MossImage`。参考项目自己的测试记录不作为本画布通过证据。

- 通用图像节点新增 **Moss Image** Tab，仅归属 `seedance-nz`（贞贞的平价AI小屋），精确模型 `moss-image`。旧节点、默认来源及其他模型不变。
- 必填非空 Prompt；文档没有给出字符上限，不套用其他模型的限制。
- 可选 **0–1 张参考图**。复用有序素材链；超过一张在上传/提交前拒绝，不静默截断。实际参考图转换为 PNG 后走共享上传接口。
- 比例为 `1:1 / 2:3 / 3:2 / 3:4 / 4:3 / 9:16 / 16:9 / 21:9`，默认 `9:16`。
- `POST /v1/image/generations` 最终白名单为 `model / prompt / metadata.ratio / images?`；无分辨率、Seed、批量、输出格式、自定义像素参数。切换自其他模型时不会发送旧字段。
- `GET /v1/image/generations/{id}` 查询原任务；读取 `data.result_url` 或嵌套 `content.image_url/image_urls`。复用共享恢复、运行身份/权限、历史输入、可信结果下载及原子落盘；媒体超时最低15分钟，受理不明不重交。
- 中英文控件、能力目录与CLI同步更新；共320个运行目录条目，节点类型仍84个，未新增节点类型。

## 无密钥工作流

可从画布导入下列 JSON。图生图导入后，在参考图上传节点选择自己的素材；模板不含密钥、任务ID或产物链接。

- [默认9:16文生图](workflows/moss-image-t2i.json)
- [1:1文生图对照](workflows/moss-image-square-t2i.json)
- [单图编辑](workflows/moss-image-i2i.json)

可运行 `npm run workflows:moss` 确定性重建模板。

## 验证与证据

- Moss 专项12项：比例/白名单、PNG上传、提交前拒绝、原任务恢复、防重放、权限身份、凭据来源、历史恢复、三个模板导入，以及真实生产事件处理器和双语控件。
- 相邻144项：Mai 15项及 Provider/运行权威/恢复/超时/能力清单等129项。未以第一次测试运行方式不兼容或测试夹具断言错误冒认产品缺陷；修正测试方式/夹具后通过。
- `type-check`、`i18n:check`、`feature-sync:check`、`rh-toolbox:check` 通过。类型检查使用BelowNormal/3 GiB堆，测试串行/768 MiB堆；无正式构建。
- 隔离 Electron/Chromium 使用生产控件/主题，在14主题×2明暗×2语言×2宽度共112组合通过，8次真实DOM比例选择和状态往返通过。报告及截图：`local-private/moss-live-20261023/ui-report.json`、`controls-dark.png`、`controls-pixel-light.png`。这是独立控件夹具，**不是完整画布/安装版验收**。
- 实网由 `npm run verify:moss:live` 使用进程内凭据、临时Electron配置和私有测试状态运行，报告 `local-private/moss-live-20261023/report.json`；接受不明或已受理POST不重放。重跑只恢复原任务；已知终态失败同样保留，不删除状态伪造通过。
- 首次默认9:16文生图：上游HTTP200受理后约219秒进入 `FAILURE`，原任务GET确认 `data.data.error.code=805`、`工作流运行失败`、最终 `data.usage.amount=0`。请求回显与已核实协议一致。该结果**不算生成通过**，未重交原失败任务。
- 独立1:1文生图：HTTP200，原任务 `succeeded`，约169.6秒；PNG 1456×1456、2,852,318字节，完整解码、非空及SHA-256校验通过。
- 单图编辑：使用上述已解码文生图，经生产PNG上传后HTTP200受理，9:16、原任务 `succeeded`，约118.5秒；PNG 1088×1936、2,687,171字节，完整解码、非空及SHA-256校验通过。已实际看图，企鹅/黄色杯子保留，背景变粉色。
- 实网共3个任务，2成功/1失败；文生图与编辑两种路径均有真实成功证据，但不是3/3全绿。报告 `passed=false` 保留完整案例矩阵，`requiredModesPassed=true` 只表示两种模式均有成功案例，不能互相替代。没有自动循环付费重试，没有从一次805推断9:16全部不可用（同轮9:16编辑实际成功）。

完整画布实链、安装版、用户设备、完整8比例实网矩阵和F8–F10未验收。凭据、任务身份及签名URL不公开。
