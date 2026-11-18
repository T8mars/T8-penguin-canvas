# Kling Image、Mai 2.7 与 Qwen Audio 3.1

2026-11-19，六模型已开发并获v3.5.4发布授权，均为贞贞的平价AI小屋渠道；进度见[发布专题](release-v3.5.4.md)。

依据：[官方合同](https://api.seedance.nz/docs/llms.txt)，以及本机只读参考实现 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance` 的 `core/image_nov19.py`、`core/qwen_audio31.py`、音色数据及对应测试。参数由前后端共用合同验证，不沿用旧模型猜测新参数。

## 入口与兼容

| 节点 / 模型类型 | 新模型 | 合同重点 |
| --- | --- | --- |
| 图像 / Kling Image | `kling-v4-image` | 最多10张有序参考图；独立生成1–9张或连续组图2–4张；2K/4K、九种比例、内容审核。组图不发送n；全部结果沿用共享图库和落盘路径。 |
| 图像 / Mai | `mai-image-2-7`、`mai-image-2-7-flash` | 最多5张参考图，1K/2K、自定义比例/像素、背景与内容审核。参考编辑不提交尺寸；不提交旧版联网搜索和自动比例参数。 |
| 音频 / Qwen-TTS | `qwen-audio-3.1-tts-flash`、`qwen-audio-3.1-tts-plus` | 分别69/4个官方系统音色；语言提示、表达指令、语速/音调/音量、SSML开关、格式/采样率、原生seed与AIGC开关。 |
| 音频 / Qwen-TTS | `qwen-audio-3.1-tts-next` | 最多3段WAV/MP3/OGG参考；按输入顺序使用@voice1–3；支持声道与MP3恒定码率，不提交系统音色、音调、表达指令或SSML字段。 |

Kling参考图转换为PNG后检查每边至少300像素、比例2:5至5:2、最多30,000,000字节。按输入顺序使用@Image1–10，重复参考槽不去重。Mai文生图每边至少768像素，总像素不超过4,194,304；先验证再向下取32倍数，比例1:4至4:1，不支持auto。Next每段参考不超过30秒及10,000,000字节，上传前实际解码检查。

保留Mai 2.6两模型、原家族ID与默认。Qwen只将可见家族名由Qwen3-TTS改为Qwen-TTS；持久化`qwen3-tts`及两个旧模型不改，新旧模型的参数面板分开。空白新建默认来源、旧节点来源/已选模型和历史默认不重写。

模型复用现有Run权威、恢复器、schema、Creator目录与可信媒体下载。媒体链最低15分钟；原任务只GET查询，不自动重交受理不明的付费POST。PCM按实际提交采样率/声道无损封装为WAV，双声道信息随恢复配方持久化；Doubao原有单声道与采样率限制保留。

## 无密钥工作流

共11份，导入画布后填写小屋Key，参考模板上传自己的素材。无凭据、任务ID或结果地址。生成器：`node scripts/generate-nov19-workflows.cjs`。

- Kling：[文生图](workflows/kling-v4-image-text.json)、[参考图](workflows/kling-v4-image-reference.json)、[连续组图](workflows/kling-v4-image-group.json)。
- Mai：[2.7文生图](workflows/mai-image-2-7-text.json)、[2.7参考](workflows/mai-image-2-7-reference.json)、[Flash文生图](workflows/mai-image-2-7-flash-text.json)、[Flash参考](workflows/mai-image-2-7-flash-reference.json)。
- Qwen：[Flash](workflows/qwen-audio-3.1-tts-flash.json)、[Plus](workflows/qwen-audio-3.1-tts-plus.json)、[Next文生](workflows/qwen-audio-3.1-tts-next.json)、[Next参考/双声道PCM](workflows/qwen-audio-3.1-tts-next-reference.json)。

## 实际验证

实网七条原任务全部成功：Kling参考图n=2、Kling连续组图max_images=2、Mai 2.7文生图、Mai Flash参考编辑、Qwen Flash WAV、Plus MP3、Next参考音频/48000Hz双声道PCM。六张PNG完整解码且非空；三段音频FFprobe确认参数、FFmpeg全段解码且非静音。所有任务在提交前通过官方费用估算；成功后下载或查询失败不重交生成。

证据在本地忽略目录：[实网报告](../local-private/kling-mai-qwen-20261119/live-report.json)、[进程退出/清理](../local-private/kling-mai-qwen-20261119/live-exit.json)、[七个已验证结果复核](../local-private/kling-mai-qwen-20261119/live-resume.log)。初次生成全成功，但Electron退出前清理词典文件触发EBUSY，原失败记录保留；改为退出后清理，再次运行只复核现有文件散列，七项均跳过提交，正常退出并完成清理。

完整App：新建TEMP小库、真实App/Canvas、真实路由/Run账本/上传/轮询/落盘，只有外部Provider响应使用固定夹具。11条工作流路径通过，共11次提交、11次查询、14个结果下载；刷新保存、旧Mai/Qwen配置保留、69/4音色选项、模式条件控件、Opus兼容采样率、种子0和PCM双声道通过。中英文、浅/深主题通过。报告：[canvas-ui.json](../local-private/kling-mai-qwen-20261119/canvas-ui.json)；[低负载进程回执](../artifacts/history-low-load-runner/f7edda2ec5da4dfbb1703d7b6f00fa01.json)：CPU10%、Job4GiB、Node768MiB、峰值约1.46GiB，正常退出、强制结束0、残留0，临时库已清理。

专项与相邻回归49项通过（23个后端、26个前端，按不重复测试计）：共享参数合同、末项媒体检查先于上传、旧Mai/Qwen请求不变、双声道字节保真、权威目录/schema、加密合同加载、原任务GET恢复、完整历史输入、真实React处理器事件清空/重放、无密钥工作流和双语面板。日志：[后端](../local-private/kling-mai-qwen-20261119/backend-regressions.log)、[恢复补验](../local-private/kling-mai-qwen-20261119/recovery-final.log)、[前端](../local-private/kling-mai-qwen-20261119/ui-regressions-final.log)、[新增工作流](../local-private/kling-mai-qwen-20261119/new-ui-final.log)。初次后端恢复测试因C盘低于物理空间门失败，保留原失败日志，仅将该测试的新TEMP库改到G盘补验通过，未改产品空间门。Kling新家族运行前检查漏走小屋Key的问题已由工作流用例发现并修正；轮询服务补齐新Qwen模型身份及默认采样率，覆盖后端任务内存丢失时的原任务GET配方。首轮旧测试profile清理被自动审批以“blocked by policy”拦截，目录保留；后续测试profile正常清理。

不将夹具当实网，不将开发Electron当安装版。4K、10图极限、全部音色/语言/采样率组合为合同验证，未逐项付费测试。未做安装发布、用户设备/GPU或F8–F10验收。旧Mai合同及旧证据见[Mai 2.6专题](mai-image.md)。
