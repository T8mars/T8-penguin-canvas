# DSH 已保存素材交接

已随v3.3.7双平台发布，正式包及下载验证见[发布专题](release-v3.3.7.md)；真人批准/网关/付费生成仍未验收。下文保留开发态临时库证据。

2026-10-20。DSH-zhen 在既有保存记录上核对文件与摘要，分别请求原生
asset.import 与 asset.place 审批；Native 导入器、Blob store 和 CanvasPatch
保持权威。没有新增私有付费账本或生成入口。

新增只读能力标记、精确内容摘要过滤、按当前 session/目标查询原操作审批和
最小 Patch 回执。只读预览延迟初始化导入器，避免提前创建复制存储。
metadata.size 正确保留到放置/导出预览；L0 重复放置沿用现有 Patch 恢复逻辑。

DSH 的独立验证使用本工作源码和原生 Electron/SQLite，只创建系统 TEMP
数据库：一个真实导入素材和一次放置、丢审批/完成回执恢复、重复复用均通过。
窗口确认由测试 IPC 模拟，保存记录元数据由测试提供；没有真实网关下载、
用户库读取或 Provider 调度。DSH C32 的数据库/复制为合成夹具，证据不混用。
DSH 证据：`.runtime/evidence/native-canvas-asset-transfer.json`（在 DSH 工作目录）。

实际安装版 3.3.6 后台运行，但控制 status 返回兼容清单不可用。只读检查确认
provider 清单位于 resources/backend-enc/shared，而原查找遗漏此位置；已补
这一候选并保持普通资源目录优先。专项先复现失败后通过。12 项素材/恢复/
兼容专项与 feature-sync 通过；其他既有失败维持原记录，不能视作全项目绿测。

本批没有修改安装版、版本、生产构建或发布。真实窗口和完整业务交接仍待验收。
DSH 仓库另保存本批有限源代码 patch，供恢复与人工审阅，不会自动覆盖本仓库。
