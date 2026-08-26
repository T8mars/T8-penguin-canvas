# 3.0 核心接入点

当前官方 3.0 客户端没有运行时插件宿主，因此本目录中的能力代理需要由核心构建接入一次。接入后，插件本身和插件数据均可放在安装目录旁的 E 盘目录。

## 必须接入的能力

1. 在 Electron 启动早期创建 capability registry，并调用 `registerVolcengineAssetsCapability`。
2. 在 Electron IPC 中调用 `installPluginDirectory`，安装到 `layout.pluginRoot`；安装完成后重启加载，首版不热更新。
3. 在后端路由注册阶段使用 `loadInstalledPlugins`，将 `ctx.capabilities.invoke` 和 `ctx.registerRouter` 传入。
4. 在前端节点注册阶段合并插件的 `nodeDefinition`。
5. 在画布节点 Schema 合并 `schema/volc-asset.node.json`。
6. 对 Provider 媒体解析增加仅限 Volcengine 的 `asset://asset-...` 受控透传。

## 凭据边界

`volcengineAssetsCapability.cjs` 只从核心设置加载 AK/SK，插件请求只能调用白名单 Action。AK/SK 不会进入插件前端、节点数据或响应体。

## E 盘目录

`storageRoot.cjs` 会把已安装客户端 `E:\\T8整合包\\T8-PenguinCanvas\\T8-PenguinCanvas.exe` 解析为：

`E:\\T8整合包\\T8-PenguinCanvas-Data`

可通过核心传入 `ctx.paths.pluginDataRoot` 或环境变量 `T8_PLUGIN_DATA_ROOT` 覆盖，但必须是绝对路径。
