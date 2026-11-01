# Hunyuan / Muse / Flux 与 Motion Video 文档复核

2026-11-01开发及验证完成，用户已授权v3.4.6同源双平台打包发布，进度见[发布专题](release-v3.4.6.md)。

## 放置与来源

全部使用贞贞的平价AI小屋、`zhenzhenSd2ApiKey`。既有节点类型、默认模型和旧工作流保留。

| 位置 | 模型 |
| --- | --- |
| 图像 → Hunyuan Image | `zhenzhen-image-hy-v3.5-preview` |
| 图像 → Muse Image | `zhenzhen-image-muse` |
| 视频 → Muse Video | `zhenzhen-video-muse` |
| 既有图像 → Flux | 追加 `flux-3-image-t2i`、`flux-3-image-i2i`、`flux-3-image-klein-t2i`、`flux-3-image-klein-i2i`；旧`flux-3-image`仍为默认 |

依据：[官方文档](https://api.seedance.nz/docs/llms.txt)及只读参考项目`F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance`的`skill.md`、`core/preview_models.py`、`core/flux3_variants.py`。参考项目的独立节点设计没有移植到本画布。

## 参数合同

共享枚举为[previewMuseFluxContract.json](../backend/src/shared/previewMuseFluxContract.json)。图像沿用POST/GET `/v1/image/generations`；Muse视频使用POST/GET `/v1/video/generations`，不混用普通视频端点。

- Hunyuan：Prompt必填，0–5张有序图片，`n=1`；顶层`size`支持auto、十种比例或精确像素；`resolution=1K/2K/4K`。界面自定义宽高256–8192，总像素≤8,294,400，不强制16倍数。宽高优先于size，所有提交值均校验。可选负面词及非负安全整数seed，0为随机。图片小于7MB是官方建议，不按7MB拒绝；本地文件受共享50MiB上传上限限制。
- Muse Image：Prompt必填，0–9张有序图片，总计≤11MiB；auto或七种比例，`n=1`。不发送分辨率、输出格式、Seed、宽高、负面词。实际尺寸/格式由模型选择。
- Muse Video：Prompt必填，0–9张有序图片，总计≤11MiB；auto或七种比例，固定`duration=10`、`resolution=720p`、`n=1`、`audio=true`。不支持参考视频/音频、首尾帧、无声、Seed和负面词。参考图用于构图，不保证相同首帧。
- 四个Flux新变体：分辨率`768sq/1k/1.5k/2k/4k`，auto及原15种比例；T2I拒绝参考图，I2I需要1–10张，每张PNG编码后≤10MiB；四者均不发送`n`。
- Flux标准变体：`grounding`默认true，`safety_tolerance=0–4`默认2；不发送Seed、steps、格式。Klein不发送grounding，支持seed=0–2147483647、可选`metadata.steps=1–16`与顶层`output_format=jpeg/png`。界面步数0/格式“平台默认”省略相应字段。旧Flux的`n=1`合同保持原样。

所有参考图先解析并编码为PNG、检查单图与总大小，再开始上传；不静默截断或去重重复素材槽。显式0与false保留。控件变化只写当前节点，不更换历史节点来源。

提交、轮询、恢复和可信结果下载沿共享15分钟以上媒体边界。复用RunIntent/Run/NodeRun/Attempt、素材原子落盘和历史输入；已受理只查原任务，受理不明不重发。Muse新增恢复类型`muse`固定查询兼容端点，重启不依赖内存任务缓存。参数恢复保留新字段，不复制任务身份或旧产物。CLI目录、模型权威与schema同步，仍为85种节点、332个运行条目。

## Motion Video

重新核对最新文档：标准版底层已是`deepseek/deepseek-v4.1-flash`，Pro为`zhenzhen-op-5.5`；这是服务端实现信息，不作为客户端生成模型提交。

公开模型仍是`zhenzhen/motion-video`与`zhenzhen/motion-video-pro`。端点、15/30/45/60秒、三种比例、720p/1080p、十种模板、motion字段和修订协议均未改变，无需编造客户端协议迁移。既有代码动画保留完整版本/分镜/修订/恢复功能，详见[开发专题](motion-video-development.md)。本次重新真实生成标准版15秒720p，成功下载并解码；没有把本次标准版证据扩称为Pro或全部修订规格重新验收。

## 十一份工作流

使用`node scripts/generate-preview-muse-flux-workflows.cjs`生成。模板不含Key、任务ID、签名地址或结果，不自动执行；参考图上传节点需选择自己的文件。

- [HY文生](workflows/hy-preview-text.json)、[HY双图](workflows/hy-preview-reference.json)、[HY双图自定义尺寸](workflows/hy-preview-custom.json)。
- [Muse Image文生](workflows/zhenzhen-image-muse-text.json)、[双图](workflows/zhenzhen-image-muse-reference.json)。
- [Muse Video文生](workflows/zhenzhen-video-muse-text.json)、[双图](workflows/zhenzhen-video-muse-reference.json)。
- [Flux文生](workflows/flux-3-image-t2i.json)、[编辑](workflows/flux-3-image-i2i.json)、[Klein文生](workflows/flux-3-image-klein-t2i.json)、[Klein编辑](workflows/flux-3-image-klein-i2i.json)。

## 实测证据与边界

用户本轮Key只经隐藏stdin进入子进程环境/内存，未保存。十一条路径各一次付费POST；轮询只查原任务，全部上游HTTP200、终态成功，图片完整解码，视频FFprobe与FFmpeg完整解码通过。

| 路径 | 解码产物 |
| --- | --- |
| HY文生 / 双图自定义 | 1024×1024 / 1280×720 |
| Muse Image文生 / 双图 | 均1920×1280 |
| 四个Flux变体 | 均768×768；Klein显式seed42、steps4、PNG通过 |
| Muse Video文生 / 双图 | 均1280×720、10秒、有音轨 |
| Motion标准版 | 1280×720、15秒、有音轨 |

- [实网报告](../local-private/models-20261101/report.json)；媒体和原任务回执仅本机忽略目录保存。复测脚本`node scripts/verify-preview-muse-flux-live.cjs --launch`，隐藏输入Key；已有受理回执不允许重新POST。
- [105项专项及相邻回归](../local-private/models-20261101/regression-final.log)与[25项实际处理器/历史回归](../local-private/models-20261101/adjacent-ui-passed.log)通过；真实协议、原任务恢复、工作流、错误来源Key、旧模型、账本和超时均有覆盖。旧测试夹具补充生产代码新增变量及早先缺少的分支变量，没有修改生产逻辑迎合夹具。
- [完整App/Canvas报告](../local-private/models-20261101/canvas-ui.json)：真实新建临时SQLite、生产路由/Run/资产，实际操作三个新Tab、四个Flux、HY自定义、上传、生成、落盘、保存重开、浅深×中英四组。外部HTTP使用夹具，该报告不冒充实网或安装版。
- [资源回执](../artifacts/history-low-load-runner/2e6b74533bbd488aa84f7dcc8c4d5897.json)：CPU10%、Job4GiB、Node768MiB、Go512MiB；峰值约1.55GiB，退出0、强制退出0、残留0，成功临时库已清理。
- 未重新验收全部分辨率/比例、Pro/修订、安装升级、用户设备和F8–F10；不改变27/32验收边界。类型、i18n、能力同步和公开边界检查见本机`final-gates.json`。
