# Seedream / Dola Seedream V5 Flash

状态：2026-10-02 开发及六路径真实验证完成；用户已授权纳入 v3.2.4，正式打包与发布待验证，见[发布专题](release-v3.2.4.md)。

## 入口与协议

图像节点 → 原有 **Seedream** Tab → API 来源选择“贞贞的平价AI小屋” → 模型系列选择国内或海外 Flash。连接参考图后自动选择图生图，未连接时选择文生图。原渠道、国内 Pro 默认与旧画布不变。

图像节点 → 原有 **Seedream分层** Tab → 具体模型选择国内或海外 Flash 分层。国内 Pro 分层仍是默认模型。

合同核对：[当前 API 文档](https://api.seedance.nz/docs/llms.txt)及 `F:/AI-T8-video-onekey/ComfyUI/custom_nodes/ComfyUI_Seedance`（HEAD `e971fe897b6635057777d1975ef0de524257ef28`）的 `skill.md` Flash 章节、`nodes.py` 与下载恢复实现。新增国内 Flash 图生图经用户明确补充确认。

| 用途 | 国内模型 | 海外模型 |
| --- | --- | --- |
| 文生图 | `seedream-v5-flash-t2i` | `dola-seedream-5.0-flash-t2i` |
| 图生图 | `seedream-v5-flash-i2i` | `dola-seedream-5.0-flash-i2i` |
| 分层 | `seedream-v5-flash-layer-decomposition` | `dola-seedream-5.0-flash-layer-decomposition` |

提交 `POST /v1/image/generations`，查询 `GET /v1/image/generations/{task_id}`，沿用独立 `zhenzhenSd2ApiKey`。前后端系列映射与上传限制共用 `backend/src/shared/seedreamNzContract.json`，服务端 RunIntent 使用相同身份映射；分层的精确模型不再回退到 GPT 默认身份。原运行账本、恢复器、结果落盘、历史输入字段及节点注册不变。

## 参数

- Flash 普通生成：提示词 5–5000 字符；`resolution=1k|1.5k|2k`，或自定义整数宽高 240–8192。选择分辨率时不发送自定义宽高；自定义时省略分辨率。
- 图生图：1–10 张有序参考图，每张最多 30 MiB，PNG/JPEG/WEBP；不丢重复槽。Pro 仍是 5–2000 字符、1k/2k、单张 10 MiB。
- 普通输出格式 PNG/JPEG；不混入 ratio、n、seed 或视频字段。选过 Flash 的 1.5K 后切回 Pro 会提示重新选择，不静默改成 2K。
- 分层：恰好一张图、最多 30 MiB；可选提示词最多 2000 字符；auto/1k/1.5k/2k；PNG/JPEG，默认 PNG。全部 `content.image_urls` 按原顺序保留，包括重复值；标量只作数组缺失时兜底。图层数量和尺寸可变，不设返回张数上限；每项完成下载、格式校验与落盘后才完成运行。
- 媒体链路沿用共享最低 15 分钟策略。受理后只查询原任务；下载失败不重新生成。

## 腾讯 COS 结果恢复

首个海外任务已成功，但首次下载发生 `ECONNRESET`。共享 `safeRemoteMediaFetch.js` 新增严格的受信结果 GET 回退：只对 HTTPS `<bucket>-<appid>.cos.<region>.myqcloud.com` 在网络类失败后尝试其官方 `.tencentcos.cn` 等价域名。保留同一对象路径与签名查询，跨域请求头凭据仍剥离；取消、403、安全拒绝和字节超限不触发回退，普通非受信 URL 策略不变，TLS 校验不关闭。域名合同见[腾讯云官方通知](https://cloud.tencent.com/document/product/436/67768)。

本次继续查询原任务后全部结果下载成功；另以只读 GET 实测官方新域名，同一对象完整解码且 SHA-256 与原结果完全一致。网络失败→别名回退及凭据/字节边界另有生产函数回归，不把本机网络证据冒认为所有 VPN 环境通过。

## 工作流与真实证据

六份无凭据工作流位于 `docs/workflows/<精确模型名>.json`，由 `scripts/generate-seedream-flash-workflows.cjs` 生成。图生图和分层均连接本地上传节点；不保存密钥、任务 ID、远程结果地址或实网产物。

真实验证使用 `scripts/verify-seedream-flash-live.cjs`、锁定 Electron 的 Chromium 系统网络、生产 Provider 提交/查询函数、生产可信下载及原子落盘函数。密钥仅从进程环境读取。每个模型只提交一次；测试任务身份只保存在忽略的私有验证目录，受理不明禁止自动重交，重启仅查询原任务。

| 路径 | 实测参数 | HTTP / 终态 | 完整下载解码 |
| --- | --- | --- | --- |
| 国内 / 海外 T2I | 1.5k、PNG、无参考图 | 200 / succeeded | 各 1 张，1872×1248 |
| 国内 / 海外 I2I | 1.5k、PNG、一张生成场景 | 200 / succeeded | 各 1 张，1872×1248 |
| 国内分层 | auto、PNG、一张场景、空提示词 | 200 / succeeded | 4/4：底图 + 3 张透明图层 |
| 海外分层 | auto、PNG、一张场景、空提示词 | 200 / succeeded | 5/5：底图 + 4 张透明图层 |

合计 6 个成功任务、13/13 张结果完整解码并逐张查看。编辑图中茶壶变红、背景变蓝；分层底图移除了主体，透明图层保持不同尺寸。脱敏报告：[本地报告](../local-private/seedream-flash-live-20261002/report.json)，产物同目录 `outputs/`；均不公开或打包。

验证入口：`tests/seedreamFlash.test.ts`、Seedance Provider/模型映射/两种 Seedream 路由、真实 ImageNode 处理器历史/结果保留、RunIntent/恢复/生成历史、可信下载与 COS 恢复、共享超时、能力同步及 i18n。最终 15 套专项及相邻回归 **263/263 通过**，无跳过或失败；`type-check`、`i18n:check`、`feature-sync:check`、上下文预算/JSON/归档及 diff 检查通过。能力数量断言改为从共享 schema/模型清单读取，拒绝未知节点、缺失处理器、风险或验收缺口的检查保留。详细输出见[回归日志](../local-private/seedream-flash-live-20261002/final-tests.log)及同目录 `final-typecheck.log`。

边界：开发阶段未打包发布；后续 v3.2.4 发布单独绑定固定源码并验证产物。真实 API 验证不替代安装版 UI、旧用户画布升级、Mac 安装或 F8–F10 外部证据；这些证据按当前授权后补、不记通过。
