# GPT Image 2.6、Z-image、Krea、Hitem3D 与 Meshy

2026-11-06：十一款可用模型已开发，十六条实网路径、图像／3D画布分场与最终组合验证通过，用户已授权v3.4.7同源双平台打包发布，进度见[发布专题](release-v3.4.7.md)。依据[当前官方文档](https://api.seedance.nz/docs/llms.txt)与只读参考项目 `F:\AI-T8-video-onekey\ComfyUI\custom_nodes\ComfyUI_Seedance`；以更新后的官方合同为准。共享参数见 [g26Krea3dContract.json](../backend/src/shared/g26Krea3dContract.json)。

## 节点与参数

全部使用贞贞的平价AI小屋和现有 `zhenzhenSd2ApiKey`。既有图像节点增加 `gpt-image-2.6`、`z-image`、`krea` 三个 Tab，既有 3D 节点增加 `hitem3d`、`meshy`；节点类型仍为85种，运行目录增加十一项至343项。

| Tab | 可用模型 |
| --- | --- |
| gpt-image-2.6 | `zhenzhen-image-g-v2.6-lowprice`、`zhenzhen-image-g-v2.6-flare`、`zhenzhen-image-g-v2.6-sunburst` |
| z-image | `z-image-t2i` |
| krea | `krea-v3-t2i`、`krea-v3-i2i` |
| hitem3d | `hitem3d-v2-image-to-3d`、`hitem3d-v2-multi-image-to-3d`、`hitem3d-portrait-v2.1-image-to-3d`、`hitem3d-portrait-v2.1-multi-image-to-3d` |
| meshy | `meshy-6-global-image-to-3d` |

初查官方明确暂时下架 `meshy-6-global-text-to-3d`，原因是上游任务异常；未展示为可运行模型，待渠道实际恢复后接入。

用户提示恢复后，于北京时间11月6日再次拉取无缓存文档并直接核验API。文档仍标注下架；该Key的 `/v1/models` 未列出文生模型，最小 `model+prompt` 请求返回HTTP503、`model_not_found`，说明 `default` 分组无可用渠道，未取得任务身份。未反复提交或加入可运行菜单；待该分组实际恢复后再接入。私有回执见 `local-private/models-g26-3d-20261105/meshy-text-report.json`。

- G2.6 LowPrice：0–2张有序参考图，固定 `resolution=1k`、`n=1`。静态图或由提示词触发 GIF；GIF 请求明确补充循环动画描述，不发送 `output_format`、帧数或时长字段。1K为请求档位，不保证实际输出恰为1024像素。
- G2.6 Flare／Sunburst 静态图：0–16张参考图、`n=1–4`、1k/2k/4k、PNG/JPEG/WebP、六种质量及可选复杂度。自定义宽高均为16倍数、最长边3840、总像素655360–8294400、长宽比不超过3。蒙版与标注URL互斥，依赖第一张参考图；尺寸对齐由服务端校验。
- 两个官方变体 GIF：仅文生、`n=1`、2–16帧、每帧至少20ms且为10的倍数；单帧 `auto` 或精确像素。完整拼图采用4×2、3×3、4×3或4×4固定格数，可交换轴，含空格；边长不超过3840、面积不超过8294400、长宽比不超过3。禁止参考图、蒙版、标注和压缩。
- 两个官方变体 SVG：仅文生、`output_format=svg`、`n=1`、`svg.model=gpt-5.4-mini`。支持auto、比例和符合静态约束的精确像素。不复制参考实现中较旧的“无SVG”限制。
- Krea：尺寸使用顶层 `WIDTH*HEIGHT`，每边256–4096且最多4220000像素；`metadata.model_variant=berry/jam`、`metadata.reasoning_level=low/medium`、PNG/JPEG、原生seed 0–2147483647（-1省略）、可选负面词。T2I禁止参考图，I2I需要1–8张、单张不超过30MiB；不发送 `n`。
- Z-image：只发送模型、Prompt和 `metadata.ratio`，可选 `metadata.seed=0–9007199254740991`（-1省略）。八种比例；不发送参考图、分辨率、格式或批量字段。
- Hitem：单图恰好一张；多图2–4张，顺序为正、后、左、右。`request_type=mesh/both`，普通版1536/1536pro，人像版仅1536pro；`face=100000–2000000`。不发送混元的Prompt、`face_count`或`generate_type`。
- Meshy：恰好一张参考图；可选拓扑triangle/quad、目标多边形100–300000、对称off/auto/on，及重新拓扑、PBR、T/A姿势、纹理布尔项。平台默认省略相应字段；显式关闭保留JSON false。

先校验所有参考图及PNG编码大小，再上传；不截断输入、不去重有序重复槽。沿用共享Run、素材落盘与超时政策；新3D轮询预留至少45分钟，覆盖本次超过21分钟的真实多图任务。恢复通过原任务GET，不重新生成。

## 原文件与预览

GIF沿用原始字节的原子落盘，界面绕过只解码首帧的缩略图。SVG校验为自包含静态绘图并确认可渲染，保留原矢量文件；通过带sandbox CSP的独立预览入口显示，普通静态文件入口继续拒绝活动文档。节点提供“保存原文件”；共享另存按真实内容保留GIF／SVG扩展名和字节。

3D按真实GLB头、版本、完整长度、JSON及二进制结构校验。ZIP结果保留原归档，并在受限解包后将自包含GLB单独原子落盘，供原有3D预览节点使用；不把ZIP直接改名为GLB。

## 工作流与实测

`node scripts/generate-g26-krea-3d-workflows.cjs` 保存16份无凭据工作流：G2.6三个模型的静态／GIF、两个官方SVG、Krea双路径、Z-image，以及五个可用3D模型。参考图节点需选择自己的文件；模板不含Key、任务身份或结果。

十一条图像路径与五条3D路径实际完成上传（如需）、提交、原任务轮询、下载及解码／结构检查；全部上游HTTP200、终态成功。Flare静态双输出完整保留。GIF逐帧完整解码并验证帧间变化；SVG完整渲染；GLB有非空网格位置数据。

| 实测路径 | 结果 |
| --- | --- |
| LowPrice双图静态／参考图GIF | 1254×1254 PNG；376×504、8帧GIF |
| Flare／Sunburst静态 | 1024×1024 PNG；Flare两张 |
| Flare／Sunburst GIF | 512×512、2帧，200ms/帧 |
| Flare／Sunburst SVG | 可渲染的1024×1024矢量文件 |
| Krea T2I／I2I | 256×256 PNG／JPEG，分别berry／jam |
| Z-image | 1024×1024 PNG |
| Hitem普通单图／人像单图 | GLB 12228592／12913396字节，约328／360秒 |
| Hitem普通多图／人像多图 | GLB 21992156／18507680字节，均有两份纹理，约1284／921秒 |
| Meshy图生 | GLB 11636字节，312个位置条目 |

位置条目不冒充精确面数。私有证据在 `local-private/models-g26-3d-20261105/`，真实任务受理后不重复POST；密钥只进入隐藏stdin／子进程环境，未写入源码或报告。真实API回执为 `image-report.json`（十一条图像路径）及 `3d-report.json`（五款3D）。

## 画布与回归

完整开发App、真实临时SQLite与共享Run／素材路由，在外部HTTP替身下分场验证；该证据独立于上述真实API，不替代安装版或用户设备。

- 图像场：三个GIF模型、两个SVG模式、LowPrice上游参考图、本地上传切换Krea T2I／I2I、Z-image准确请求、原文件浏览器下载逐字节一致、保存重载和中英文／明暗四组合通过。见私有 `canvas-ui-image.json` 与资源回执 `artifacts/history-low-load-runner/642a3221bac1434094f8718c5629e762.json`。
- 3D场：五款模型、正后视图顺序、显式false、资产登记、ZIP原件保留与GLB预览、保存重载及双语主题通过；截图可见非空网格。见私有 `canvas-ui-3d.json` 与回执 `artifacts/history-low-load-runner/2436d28425e14501a442396d585c0519.json`。
- 两场均保持CPU10%、Job4GiB、Node768MiB、Go512MiB、软件渲染；峰值约1.53／1.58GiB，强制终止0、残留0。
- 最终组合场在相同限制下完成全部生成、两个原件下载、五款3D、参数重载与主题切换，页面错误0、原生异常退出记录0、强制终止0、残留0。见私有 `canvas-ui-all.json`、截图 `canvas-complete-all.png` 与回执 `artifacts/history-low-load-runner/6567839a0f1947d48eadeaa317b78c8f.json`。此前一次组合会话的渲染崩溃原因未定位，最终复验未重现；原失败报告保留，不宣称用户GPU／安装版已验收。
- 实际操作发现并修复：未选中节点的生成按钮冒泡改变选择状态，触发启动快照保护；按钮停止冒泡，CAS／输入变化门不放宽。3D结果补用共享 `assets` 事务登记，避免把受保护 `node.output` 作为普通日志写入。
- 新合同4项、新前端与真实处理器10项、SVG／Creator相关15项、原件另存与B3边界9项，以及相邻协议／历史／恢复／权限回归通过。初次测试加载器无法解析三个UI文件，已用tsx正确执行；失败日志保留，不计为通过。type-check、feature-sync、i18n、public、RH工具箱及上下文门通过。

验证入口：`scripts/verify-g26-krea-live.cjs` 只对尚无受理记录的图像路径提交；原任务恢复仅GET。画布使用 `scripts/run-history-low-load.ps1 -Mode G26Canvas`，可设置 `T8_G26_CANVAS_CASE=image|3d|all`，不提高资源限制。临时数据库按同次回执确认退出后清理，不读取历史用户库。工作流导入、凭据检查及实际生产事件处理器的回归见 `tests/g26KreaModels.test.ts`。
