# Strata 本地 LLM

状态：2026-10-19本地开发及两轮审查完成，v3.3.5发布准备中，发布事实见[专题](release-v3.3.5.md)。复用 OpenAI 兼容扩展来源和现有 LLM / Run 链；不新增节点、数据库 schema，不修改 Strata 引擎。本轮冷启动实机失败与用户暂缓决定见文末，不能由隔离绿测抵消。

## 使用

1. 在 Strata 选择模型并启动服务，复制页面“API连接”的 Base URL。设置页（本次用户实例为 `http://127.0.0.1:17880/`）不是推理接口；本次真实 API 为 `http://127.0.0.1:8080/v1`，这些端口都不是固定要求。
2. 画布右上“API设置”→“扩展平台”→“添加 Strata 本地服务”。填实际地址；根地址自动补 `/v1`，反代前缀同样确定性补 `/v1`。
3. 同机无Key模式只接受 `127.0.0.1` / `[::1]`。局域网选 API Key，先在 Strata 自己配置监听和 Key；不自动开放端口或修改防火墙。localhost 指画布**后端**所在电脑，不一定是浏览器所在电脑。
4. “连接并读取模型”只请求健康、状态和模型列表，不加载模型、不推理。读取 canonical/alias、上下文和视觉能力；冷加载列表为空时结合 protocol 1 的状态识别配置模型。修改地址/Key/认证后原连接提示失效。
5. 保存设置，在LLM节点“高级来源”明确选择 Strata 及模型。旧节点/复制/导入参数不自动改；可显式点击“采用本地推荐参数”，设置 `1024` 输出 token 与 `none` 思考。思考也可选 low/medium/high/API默认（省略）。输出预算不暗中截断输入。

关闭或删除来源、模型失效、服务断线时保留原选择并阻断，**不自动切云端、换模型或重交 POST**。保存的Key不会写入节点/画布工作流；none模式即使仍有历史Key也不发Authorization。私有设置备份仍按既有明文凭据导出提示保管，不应公开。

## 范围与失败语义

- 普通文本、多轮、图片问答（服务和模型都声明视觉时）、真正的外部文本增量流式、非流式与停止。结构化 JSON 可以被服务缓冲，不能保证逐字显示。
- 执行的媒体准备、提交、冷加载、服务端排队、响应头、完整JSON/SSE共用最长180秒截止；本地尚未提交的串行队列单独显示等待并可取消。超时后提示在Strata预热、由用户手动再试，不自动load/unload/kill。
- 同源服务默认串行1请求，不因providerId或Key不同增加并发；不改Strata batch/GPU设置。状态是服务全局信息，不伪称本次请求进度。
- 图片沿用受授权素材解析；本地路径转dataURL，转换失败阻断，不向LAN服务发送盘符或不可访问的`/api/resources`。公共HTTP图片保留既有引用语义，不新增自动全量下载。
- 视频仅在显式frames模式下抽帧观察，不含音轨；不将`video_url`冒充`strata_video`。原生视频、ASR、工具/MCP、引擎托管不在本功能范围。
- SSE缺结束标记、上游错误、仅思考无正文、length截断和无效JSON均不能记成功。部分流式内容留在界面并标记未完成，不写为成功结果。正常输出沿原Run/Attempt和素材链落库。
- ScriptMaster、Story文本分析、三种提示词增强器、MV文本阶段、Localization翻译和BatchTagger复用相同适配器；不因此替代这些节点的图像、视频、配音生成来源。原生视频需求仍明确拒绝。Story的Strata分支不自动JSON修复/本地降级。
- Creator首期不开放：目录过滤，两个真实runtime后端明确拒绝，不能绕过为未验收的多次生成、JSON repair或工具执行。Panorama3D出图也不纳入。

## 实现与检查入口

- `backend/src/providers/strata.js`：显式认证/最终URL门、GET发现、运行前模型与能力核对、串行队列；不保留原始机器/路径/进程status。
- `llmDeadline.js` / `openaiCompatible.js`：共享执行deadline、父取消跨响应体、SSE和JSON终态。既有OpenAI兼容来源不改变参数默认；仅补齐真实总时限和取消。
- `registry.js`、`advancedProviders.ts`、设置页：profile/authMode掩码往返、显式清Key、LLM-only前后端门。预检指纹包含profile/认证；运行时重新发现，不沿用陈旧服务能力缓存。
- `externalProviders.js` / `generation.ts` / `LLMNode.tsx`：真正的delta/status/terminal事件；停止经原Run取消和上游断连，不只恢复按钮。
- `node --test tests/strataProvider.test.cjs`；`node --import tsx --test tests/strataFrontend.test.ts`：本地HTTP协议与真实设置/前端传输/适配器链。
- `pwsh -NoProfile -File scripts/run-history-low-load.ps1 -Mode StrataCanvas`：完整App/Canvas、真实后端和新临时SQLite验收，沿用10%CPU / 4GiB Job / 768MiB Node限制。只接本地合成Strata，不是模型推理证据。
- 真实模型验证显式运行：设置进程环境`STRATA_BASE_URL`，需要认证时设置`STRATA_API_KEY`，执行 `node scripts/verify-strata-live.cjs --run --text --multi-turn --json --vision --cancel --report`。没有`--run`和具体场景拒绝推理，失败不自动重试，不启停用户引擎。

## 当前证据与未覆盖

2026-10-18用户启动的Strata protocol 1，模型 `sc117-qwen3.8-flash-next-abliterated-iq3_s`：冷加载后的流式 `STRATA_OK` / stop 约33.9秒；JSON `{"strata_ok":true}`约1.37秒；128×128合成红图回答Red约0.96秒。取消首delta暴露的拒绝Promise未观察已修复，新增专项和真实取消复验进程正常0退出。原始失败未冒认为整套通过。

最终真实模型5/5通过：文本流式、多轮历史、JSON、图片问答和首delta取消，进程正常0退出。四个核心适配器源码散列与脱敏结果在本地 `live-report.json` / `live-report-multi-turn.json`；热机文本2.84秒、多轮1.27秒、JSON9.55秒、视觉1.54秒，不能据此保证其他设备速度。

首轮Electron限定回归232/232通过（含13项Strata专项和2项前端/真实HTTP链，不重复相加）。完整App/Canvas、真实后端和新临时SQLite的11组操作通过：配置/发现/保存、旧参数保留、显式本地参数、增量先于终态、Run成功/落库、停止/上游取消、停止状态保存后重开、停用来源不落云端、中英文及浅深色800×600设置页。唯一成功生成POST与一次取消POST符合预期，0意外云端调用。Windows低负载runner正常0退出，强制结束0、残留0，峰值Job约1.49GiB；其中失效来源的Run终态断言在下述复查中补齐。

完整报告及失败尝试保留于本地 `local-private/strata-llm-verification-20261018/`，不公开或打包；runner回执索引在 `canvas-ui.json`。早期测试的模态自动关闭、折叠控件定位、停止保存时序和断流取消问题均保留失败记录，不用最终绿测覆盖。普通Node的原生ABI不匹配后改用项目既有Electron测试入口，没有重建依赖；相关测试数据库位置也已改为系统临时目录。最终`type-check`、feature-sync、i18n、public、worktree、diff及上下文归档/预算门通过；另做超时策略/Run/能力清单等59项复查，与232项有重叠，不相加。

Strata参考基线见规划散列快照；其Git索引异常未修复，本次没有修改Strata源码。现有文本消费者复用协议路径并通过相邻回归，但没有逐个消费者运行真实大剧本/长视频模型任务，不将其质量或资源边界宣称为已验收。

没有验证其他GPU、LAN、安装版升级、用户大画布、原生视频/音频或Creator工具协议，不能拿本机/mock结果替代这些证据。2026-10-19用户另行授权发布，外部证据后补但未标记通过。

## 2026-10-19：20轮BUG复查

按用户要求新增一个子AGENT完成顺序R01–R20交叉审查，主线程独立执行真实画布并核对账本；共发现并修复以下六项，未扩大到引擎管理或打包发布。

| 问题 | 修复与验证 |
| --- | --- |
| 自定义端点空白字符导致校验地址与实际POST地址不同 | 复用适配器最终URL构造，并固定已校验端点；空格/Tab/CRLF及两种端点字段均验证跨域0请求，同源仍可用。 |
| 旧连接回包重新显示新配置“连接成功” | 按来源记录请求代次；编辑、删除、表单重置和备份导入使旧请求失效，成功/失败/异常都不能回写；20项实际生产处理器测试及完整画布延迟回包通过。 |
| ScriptMaster对Strata硬编码16384输出预算 | 使用Strata配置预算/默认1024，其他来源不变；5项实际分析处理器测试通过。该节点是既有被动工作台，本轮未新增Run/停止UI，不宣称已验证真实大剧本质量。 |
| 图片压缩后超预算或异常回送原图 | 仅Strata strict路径压缩后复查字节预算，转换异常不回退原图；超预算/损坏图在提交推理前失败，其他来源兼容路径不改。 |
| 导入来源ID与内置渠道同名时Creator可能先走云端 | 两个真实resolver先检查Strata profile，再处理内置渠道；保留ID加合成云端Key仍明确拒绝，无意外云端调用。 |
| 节点预校验/调用失败但Run可能记成成功 | 主线程实际画布账本发现：React节点更新尚未应用，已resolve回调会让共享Run读取旧success。LLM回调预校验明确抛错，catch记录界面后传递原异常；7项实际生产回调测试覆盖预校验、流式/非流式错误及取消，保留旧success快照仍可正确拒绝。 |

最终串行Electron限定回归288/288、TypeScript、能力清单、i18n、public、worktree及diff门通过。288包括上述新增专项与相邻回归，不与前次232/281或子AGENT重复运行相加。保护运行时散列未变，未暂存/提交、升级版本或发布。

新的完整App/Canvas/后端/临时SQLite夹具覆盖延迟旧回包、流式先于终态等12组操作；真实Strata文本场景覆盖12组。两份早期报告均未核对停用来源的Run失败终态，不能据此证明账本正确，主线程随后发现第6项并补强断言。最新真实视觉场景13组实际操作包含文件输入上传红图、识图返回`Red`、非流式、停止、保存/重开、停用来源0POST且Run=`failed`，以及中英文/浅深色800×600设置页；同次两条Run成功、一条主动停止、一条本地阻断失败，3次模型POST，没有自动重试或云端请求。不能代替安装版或LAN验收。

顺序审查、每次尝试和截图保存在本地 `local-private/strata-llm-audit-20261019/`；`review-agent.md`逐轮说明证据，`canvas-fixture/`、`canvas-live/`、`canvas-live-vision/canvas-ui.json`分别索引同次runner回执。早期脚本退出后读取计数、图片预览定位错误均保留失败记录。另一次视觉功能断言通过但runner回收了1个测试子进程，按规则不算整体验收；没有保留其进程类型，不猜为用户客户端缺陷。验收脚本已补构建辅助服务正常stop及所持ChildProcess的close等待；最终同次回执`02453c3ee8fe4126a86249dc12bee9e6.json`已核对runner/child均0退出、外层强制0、残留0，峰值Job约1.50GiB。esbuild通过自身stop API关闭，Electron测试主进程0退出；五份运行源码散列与报告一致，用户Strata仍运行且in-flight=0。

可复现真实画布验收：在低负载runner运行前显式设置`T8_STRATA_CANVAS_LIVE_URL`为已启动的本机API，再执行`pwsh -NoProfile -File scripts/run-history-low-load.ps1 -Mode StrataCanvas`；仅允许本机无Key服务，不启停引擎。默认仍为隔离HTTP夹具。额外设置`T8_STRATA_CANVAS_VISION=1`可通过节点实际文件输入上传128×128红图做视觉验收，结果独立保存，不覆盖文本或失败尝试。

## 第二轮独立20轮审查及当前边界

第二个独立子AGENT完成R01–R20，新发现并修复2项：LLM在等待完成账本响应时停止，旧回调仍可能采纳成功结果；ScriptMaster导入的Strata来源ID与内置渠道同名时可能先走云端。真实生产处理器红绿测试锁定，成功提交前复核取消信号和执行身份，保留ID明确拒绝且0云端调用。两轮累计8项修复，最新串行Electron回归315/315通过，不与旧288或子AGENT32重复相加。

最新完整App/Canvas/真实后端/新临时SQLite的隔离验收16项通过，包含实际点击“发送/停止”、延迟provider.response时停止、不采纳不完整回复、保存重开及Run/NodeRun/Attempt终态一致；3次合成POST对应1成功、2停止，另1次来源阻断失败，0云端请求。报告`local-private/strata-llm-audit-20261019-round2/canvas-fixture/canvas-ui.json`与当前五文件散列一致，同次runner回执`35a9755ab72745da86fee928a7bfdc8f.json`正常退出0、强制0、残留0。较早夹具对停止后autosave读取过早的失败保留，补等待持久化后复验，未据此修改产品。

真实冷启动画布本轮**未通过**：连接查询没有加载模型，实际发送后Strata返回HTTP503/`[WinError 5] 拒绝访问。`，模型/视觉仍未加载。失败截图与报告在同专题目录`canvas-live-vision/`，不是画布已修复的故障。用户随后明确其他人在使用、暂不处理，因此不再重启、卸载或推理，不猜具体权限根因。前轮真实模型成功证据仅代表其当时状态，不能抵消本轮失败；发布授权为证据后补，不改变此结论。
