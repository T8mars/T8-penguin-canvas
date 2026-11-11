# Tripo 3D：现有 3D 节点扩展

2026-11-11，开发与限定验证完成；已随[v3.5.1双平台发布](release-v3.5.1.md)；功能与现场验收边界仍以下文记录为准。既有 Hunyuan / hitem3d / Meshy 入口和默认值保留，旧模型合同见 [G2.6/3D](g26-krea-hitem-meshy.md)。

## 合同来源与界面

以 [平价小屋官方 llms.txt](https://api.seedance.nz/docs/llms.txt) 的 `POST /v1/3d/generations — Tripo 3D（25 个模型）` 为准，核对只读参考 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance\core\tripo.py`、`core\tripo_artifacts.py` 及当前交接结论。不在参考项目写代码。

在原有 **3D 节点 → Tripo 3D** 下拉选择模型，沿用贞贞的平价AI小屋 API Key；不是新增节点。参数按模型、输入方式及联动选项显示，中文/英文同步。公共定义在 `backend/src/shared/tripo3dContract.json` / `.mjs`，前端与 Provider 共同校验；运行能力目录同步新增 25 项（总数 371）。

| 类别 | 模型 |
| --- | --- |
| H 系列 9 项 | `tripo-h-v3.1-{text-to-3d,multiview-to-3d,image-to-3d}`、`tripo-h-v3.0-{text-to-3d,multiview-to-3d,image-to-3d}`、`tripo-h-v2.5-{text-to-3d,multiview-to-3d,image-to-3d}` |
| P 系列 6 项 | `tripo-p-p2-{text-to-3d,multiview-to-3d,image-to-3d}`、`tripo-p-p1-{text-to-3d,multiview-to-3d,image-to-3d}` |
| 纹理 | `tripo-texture-v3.0`、`tripo-texture-v2.5` |
| 重拓扑 | `tripo-retopology-v2`、`tripo-retopology-v1` |
| 网格 | `tripo-mesh-smartsegment`、`tripo-mesh-segment-v2`、`tripo-mesh-segment-v1`、`tripo-mesh-complete` |
| 其他 | `tripo-image-to-splat`、`tripo-convert` |

## 输入与参数

- 文生提示词 1–1024 Unicode 码点，负面提示词最多 255。图生恰好 1 图；多视图 2–4 图，顺序 **正 → 左 → 后 → 右**，与旧 Hunyuan 的顺序不同。多视图原生任务复用模式只传 `multiview_task_id`，不再传图片。
- 图片使用既有上游素材订阅和排序；JPG/PNG/WebP 转换为 PNG 后每张最多 20 MiB；整批图片和本地模型先校验，全部通过后才上传。模型连接单个 3D 上游或填写直链；本地 GLB/GLTF/FBX/OBJ/STL 走既有上传缓存，最大 150 MiB。多模型、手填与连接冲突均提交前拒绝。
- 支持纹理、PBR、UV、几何/纹理质量、面数、种子、四边形、低多边形、部件生成等真实字段。接口默认省略；显式 false 和种子 0 保留；种子 -1、面数/纹理尺寸 0 省略。面数随 H/P 版本及四边形选项校验，不能混入旧 Hunyuan 的 `face_count/enable_pbr/generate_type`。
- `compress` 仅 `geometry`，不是布尔开关；v2.5 不显示不支持项。几何压缩结果由 GLTFLoader 的 MeshoptDecoder 读取。
- 纹理可选文字（可附风格图）、单图或完整四视图；分割 v2 的参考图与粒度/连通性设置互斥；智能分割模型模式要求 16 项列主序变换矩阵。转换格式及附属选项按文档联动。
- 补全连接分割结果，自动读取 **Tripo 原生 ID**；平台查询 ID 不可替代。部件名称取 GLB `nodes[].name`，支持 JSON 数组/逗号列表，区分大小写、去首尾空格、拒绝重复/空项/嵌入逗号，总长最多 1024；空白交由接口处理全部。中继/输出素材保留同一模型的原生 ID、部件和文件信息，多任务歧义不自动选一个。
- POST 仍走共享 RunIntent/Run/NodeRun/Attempt；轮询/恢复只 GET 原任务，不重交受理不明任务。正常轮询 5 秒、45 分钟，符合媒体至少 15 分钟策略。

## 结果、历史与模板

只按 `data.data.content.files` 的角色/格式解释结果：`modelUrl` 为主模型，`renderedImageUrl`、`generatedImageUrl` 等附件按顺序保留，外层 `result_url` 的镜像不抢占主模型。`file_url/file_urls` 若出现须与 typed manifest 相符。原生 ID 缺失保持空白，不用平台 ID 冒充。

复用受信 Provider 下载、完整文件校验和原子物化。GLB、GLTF、FBX、OBJ、STL、USDZ、3MF、Splat、ZIP 保留真实格式；即使标为 GLB 而返回有效 ZIP，也保存 ZIP，不改后缀伪装模型。ZIP 检查路径、数量、展开量及各项 CRC；主文件下载未完成保持 materializing，重试原结果 GET。预览图失败不阻断已经完整校验的主模型。

附属结果信息绑定本地完成回执的 SHA-256、模型和原任务；主机提交历史资产时读取该回执，忽略客户端自报 metadata。刷新恢复保留全部附件与原格式，历史放回画布可继续使用原生 ID。Splat、ZIP、3MF 当前支持保存/下载，**不宣称已有原生可视化预览**；不支持格式继续使用原预览节点的说明。

`npm run workflows:tripo` 生成 [25 份无凭据模板](workflows/)；文件名为各完整模型 ID。用户先补入自己的图片/模型后运行。补全模板已包含“模型上传 → 分割 → 补全”，不包含测试任务 ID、产物 URL 或密钥。

## 验证与边界

按用户费用限制只创建三个实网任务，全部复用 T8 Provider 和生产下载器，没有为剩余 22 项追加付费测试：

| 模型 | 成功时间 | GLB 大小 | 完整解析 |
| --- | --- | --- | --- |
| `tripo-p-p1-text-to-3d` | 86.4 秒 | 1,839,496 bytes | 1 mesh / 原生 ID 有返回 |
| `tripo-mesh-segment-v1` | 151.7 秒 | 2,895,292 bytes | 16 meshes / 16 部件 / 原生 ID 有返回 |
| `tripo-mesh-complete` | 35.9 秒 | 1,683,856 bytes | 使用前一分割原生 ID 和指定部件，16 meshes |

私有实网报告：`local-private/tripo-20261111/live-report.json`。三项任务/下载原始记录保持本地忽略，真实密钥只放进程环境。完整画布以系统 TEMP 新库验证，Provider HTTP 边界为确定性数据，不能冒充剩余模型实网或安装版证据；详见同目录 `canvas-ui.json`。参考项目没有被修改。

82 项不同回归通过：Tripo 合同 15 项、其他后端资产/恢复 32 项、前端与相邻节点/端口/恢复 35 项。完整 App 的临时 SQLite 画布实际操作通过：25 模型切换、旧 Tab 切回、生成→中继→分割→输出素材→原生 ID 补全、模型上传、ZIP/Splat 原格式保存及原文件下载、五份资产独立 SHA-256/原生身份、刷新和中英/明暗主题；五条确定性任务不是付费实网测试。类型、功能同步（371 runtime entries）、i18n、公开边界和上下文预算检查通过，日志在 `local-private/tripo-20261111/`。安装版、真实大模型负载、其余模型实网不在本次声明通过范围。

一次初始脚本等待控件失败留下的隔离临时目录，其递归清理被自动审批拒绝（仅返回 `blocked by policy`），该目录保持保留。成功场景自行正常退出、无强杀及残留进程，临时库已由验证脚本清理；未清理用户数据目录。
