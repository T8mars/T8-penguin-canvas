# 2026-11-08 模型选择、默认来源与 Flash 更新

状态：已随 [v3.5.0 双平台发布](release-v3.5.0.md)；旧节点配置保持原样，安装环境与F8–F10仍按原边界后补。前一批反馈见[独立记录](user-feedback-20261108.md)。

## 模型选择与新建默认来源

- 图像节点改为“模型类型 → 具体模型”两级下拉，复用原来源过滤、模型切换与参数校正，不增加节点类型。
- 既有 Kling 4 五模型一直在平价小屋的 Kling 分类内；原来位于 21 个旧选项之后。现在单独分组置于具体模型列表上方，新 Flash 同组可选；已选旧型号和默认型号保留。
- 按用户确认范围，空白新建 image/edit/video/llm/audio/seedance/director-storyboard 默认平价小屋。分别对应已有 GPT2、Grok、豆包 Mini、Suno、Seedance Fast 路径；不改旧节点组件的加载回退规则，不替换既有媒体或任务身份。
- 设置可分别选择产品默认、工坊、平价小屋，并可全部设为平价。产品默认现指平价；已有明确工坊/扩展来源偏好优先。旧两字段偏好可原样读回，新增四项为可选字段，仍严格校验枚举与额外字段。
- 复制、导入、模板、历史恢复和显式模型/来源绕过新建偏好。未加载成功继续阻止空白新建；没有平价 Key 不会偷换渠道。Creator 的适用空白创建也在批准前冻结偏好；音频 Schema 仅补两个合法 Suno 来源枚举。

## 新模型合同

依据[官方完整 API 文档](https://api.seedance.nz/docs/llms.txt)及只读 `ComfyUI_Seedance/core/flash_video.py`、`core/image_models_26.py`，未修改参考项目。

| 模型与入口 | 本次参数 |
| --- | --- |
| 图像 → gpt-image-2.6 → `zhenzhen-image-g-v2.6-lowprice` | 静态支持 1k/2k/4k、质量与 PNG/JPEG/WebP，n=1，最多16张有序参考图。GIF改为仅文生，明确发送 `output_format=gif,size=auto`，不发送旧静态/自定义帧参数；原始GIF完整保存。默认不发送 version，使用服务默认。 |
| 视频 → Kling → Kling 4 → `zhenzhen-video-kling-v4-flash` | 3–20整数秒、720p、16:9/9:16/1:1/21:9；最多10图或5视频，不能混传，不支持主体/音色ID及原始音频。 |
| 视频 → Veo → `zhenzhen-video-g-omni-1.2-flash-lowprice` | 3–15整数秒、360p/720p/1080p/4k、16:9/9:16；最多10图或1视频，不能混传。 |

两个 Flash 使用 `/v1/videos` 提交/原任务查询，分辨率与比例位于顶层，参考视频位于 `metadata.video_url` 数组。实网验证按字符串发送 seconds；带视频参考也保留 seconds，不套用 Omni 1.1 的省略时长或 generation_type。原 Kling 4 的混合参考、主体/音色、水印和旧接口保持独立。超限明确拒绝，不切片截断，不自动重交付费 POST。

运行身份检查发现后端手写列表缺少 Kling 分类，可能回退到其他型号。Kling 现在从共享目录读取精确型号，Veo补入新型号；已有 Kling 各型号均通过来源/身份测试。新 Flash 的首次受理恢复描述符指向原 SeedanceNZ 任务 GET，提交和恢复保持媒体最低15分钟策略。

## 实际验证与边界

- 120项限定回归全部通过（93项普通运行时、27项Electron原生运行时），覆盖生产参数构造、上传边界、旧默认、来源隔离、设置HTTP持久化、真实事件处理器、Agent创建、工作流端口及原任务恢复。
- 隔离 Edge/ReactFlow 挂载真实七类组件及新建工厂：18项实际操作通过、页面错误0。覆盖图像分类下拉、4K选择、原Kling五型号/Flash切换、浅色像素/深色/英文、七类新建平价、旧节点模型与渠道保留。内嵌浏览器工具启动故障后改用此隔离测试；不声称完整App或安装版验收。
- 9条真实任务全部提交、原任务轮询、生产受信下载、完整解码通过：LowPrice 2K/4K/GIF，两个Flash各文生/本地图片/本地视频。没有重复付费重试。2K实际2048×2048、6,012,306字节；4K实际2880×2880、10,483,476字节；GIF实际436×389、9帧、64,328字节。
- 视频均请求3秒。Kling文生实际1280×720/3.042秒，图片参考960×960/3.042秒，视频参考1280×720/5.042秒；Omni三条均640×360/约3.029秒。实测尺寸/时长与请求存在差异，未冒认精确遵从。16图/5视频最大容量仅离线边界覆盖，没有做满容量付费测试。
- 私有原始证据：`local-private/flash-refresh-20261108-live-20261010/report.json`及产物、`local-private/core-model-ui/report.json`及截图、`local-private/core-model-refresh-final-regressions.log`、类型/双语检查日志。无历史项目数据库读取；不新增F8–F10或用户安装环境证据。

九份空素材、无凭据示例通过 `node scripts/generate-flash-refresh-workflows.cjs` 生成：`docs/workflows/refresh-g26-{2k,4k,gif}.json`、`refresh-{kling-flash,omni12}-{text,image,video}.json`。旧 `g26-low-gif-reference.json` 保留路径但改为文生GIF，不再连接参考图。

本轮早期实网验证进程已退出；其专用临时Profile清理被自动审批拦截（仅返回 blocked by policy），目录保留。其余原生回归仅使用新建临时数据并由测试清理。
