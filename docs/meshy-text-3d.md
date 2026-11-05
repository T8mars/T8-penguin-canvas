# Meshy 6 文生 3D 恢复接入

2026-11-06：最新无缓存[官方文档](https://api.seedance.nz/docs/llms.txt)恢复 `meshy-6-global-text-to-3d`，同一平价小屋 Key 的模型目录与真实任务均已验证。本地代码补到既有 3D 节点的 Meshy Tab；用户已授权v3.4.8同源双平台打包发布，进度见[发布专题](release-v3.4.8.md)；v3.4.7已发布资产不变。

## 协议与界面

沿用 `POST /v1/3d/generations` 和原任务 `GET /v1/3d/generations/{task_id}`。提示词必填，去首尾空白后为1–600个Unicode字符；拒绝参考图。可选 `art_style=realistic|sculpture`，以及布尔 `enable_prompt_expansion`，平台默认分别为写实和关闭扩写。

共用拓扑、多边形数量、对称、重新拓扑、PBR及姿势选项；平台默认省略字段，显式false完整保留。`should_texture` 只用于图生模型；切换到文生时不发送残留的纹理开关、参考图、Hunyuan或Hitem字段。文生与图生各自显示有效控件，切换保留用户填写内容；不修改已有节点默认模型。

共享合同、请求类型、保存字段白名单、运行权威映射、恢复器和Creator目录同步更新。节点种类仍为85，运行目录为344项。沿用45分钟轮询预算、共享媒体超时和原子落盘，受理后恢复只查询原任务，禁止自动重交。

新增[无凭据工作流](workflows/meshy-6-global-text-to-3d.json)，全部对应模板现为17份。新模板不含参考图、Key、任务身份或产物地址。

## 实际证据

此前同日503及旧文档下架记录保留在[原专题](g26-krea-hitem-meshy.md)。本轮无缓存文档和模型目录已恢复；通过生产 `submitHunyuan3dTask` 提交写实、关闭扩写、100目标多边形、重拓扑开启、PBR关闭的原生布尔参数，提交及终态查询均为HTTP200。受理后约162秒成功。

GLB完整下载1,737,168字节，版本、长度、JSON/BIN及自包含检查通过，包含289个位置条目和一份纹理；位置条目不代表精确面数，关闭PBR也不代表上游不返回基础纹理。SHA-256为 `c9a04fa9eb0852cca9d6beb350706447b548de9db235b5353028f7131ccb486d`。密钥只进入隐藏stdin与子进程环境，未保存；私有回执在 `local-private/meshy-text-20261106/meshy-text-report.json`。

113项回归通过：共享合同/能力/运行权威32项（含5项新系列合同）、前端生产请求/事件处理器/恢复/工作流11项、相邻Provider70项。type-check、feature-sync、i18n、public及上下文门通过。

完整开发App、全新TEMP SQLite和共享Run/资产路由在外部HTTP夹具下验证六款3D模型；新增文生的风格/扩写/布尔、文图切换、GLB资产登记、保存重载及中英文/明暗四组合通过，页面错误和原生渲染异常均为0。私有 `canvas-ui-3d.json` 与 `canvas-complete-3d.png`，资源回执 `artifacts/history-low-load-runner/c283d302acad43c0bd57dcca32260c41.json`。CPU10%、Job4GiB、软件渲染保持；峰值约1.57GiB，强制0、残留0，临时库已清理。画布夹具证据与上文实网证据分开，实际安装版及用户设备未验收。

首次画布启动缺少浏览器测试依赖，改用应用已捆绑的Playwright后通过；首次共享回归用错Node ABI，改用当前Electron对应运行时后32项通过。首轮前端夹具假定所有3D均需图片，已补齐新增文生场景；失败日志保留，不计作通过。上述为开发验证边界；后续v3.4.8发布按独立授权和发布专题执行。
