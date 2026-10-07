# RH 媒体字段被误判为旧枚举值

日期：2026-10-07。基线 package `3.2.5`、HEAD `f16fb8eddc3db8ae949424de8d3910738e350cad`，canonical core；本轮只修复源码，不升级、打包、推送或发布。

## 根因与修复

用户报错为 `#15 image` 的本地素材地址不在应用真实选项中。该文案来自前端 `resolveRhFieldValue()`，发生于 `buildRawNodeInfoList()`、上传和付费提交之前；这条错误是客户端校验拒绝，不能据此归因于 RH 后端或用户图片。

共享解析器把 IMAGE/VIDEO/AUDIO 字段中的文件列表元数据也当成了封闭枚举，既拒绝新素材地址，又把 `valueType` 改成 `select`，使上传流程失效。RH 官方[高级集成示例](https://www.runninghub.ai/runninghub-api-doc-en/doc-8287470)仍区分 LIST 与媒体字段：媒体先上传，再把返回路径写入 `fieldValue`。

现在 `src/utils/rhFieldOptions.ts` 优先按明确的媒体 `fieldType` 排除枚举解析。普通 RH、钱包共用组件、RH 超市与工具箱制作器共用的解析入口同时获得修复。保留真正 LIST/SELECT 等字段及带真实元数据的 TEXT/NUMBER 枚举校验；不按字段名、URL 外观猜类型，不关闭全部校验。已有画布输入不改写，仍沿用原上传、双站、实例选择、运行与取消协议。

## 可复现证据

`tests/runningHubFieldOptions.test.cjs` 执行生产解析器、实际提交 builder 和异步上传 resolver，不复制业务实现：

- 修复前 10/15 通过、5/15 失败，媒体解析断言失败，两个生产 builder 均抛出 `RH_FIELD_OPTION_INVALID`。
- 最终18/18通过（加入三个真实元数据回归）：三种媒体、JSON/数组/嵌套及对象元数据、本地资源/素材集/项目资产/文件和远程地址；验证每项只上传一次、提交 RH 文件名、保持原输入、站点衔接、已上传文件不重复上传和上传失败向上抛出。
- 原完整枚举、数字外观字符串、零值、非插值与 LIST 名为 `image` 仍拒绝无效地址的反例保持通过。
- 四套相邻 RH 回归 40/40 通过（文本绑定、双站路由、文本输出、工具箱）；与上述专项不同，不包含实网生成。
- TypeScript、RH 工具清单、生成能力合同、diff 检查通过；两份保护文件散列未变。

## 用户提供 Key 后的真实验证

用户随后提供 RH Key 并要求不要靠猜，因而增加实网验证；Key 仅来自进程环境，未读取用户设置或历史数据库、未写入文件。本地数据与资源索引全部新建于系统临时目录，用后清理。

- 国内站两个内置应用 `2066002530877927426`（抠图）、`2066353965784199169`（放大）的真实 app-info 均 HTTP200 / code0。两个图像字段都明确返回 `fieldType: IMAGE`，同时 `fieldData` 为 `[["example.png", "None", "example.png", "keep_this_dic"], {"image_upload": true}]`。
- 将相同响应输入修复前 HEAD 的生产解析器，两个字段均抛出 `RH_FIELD_OPTION_INVALID`；没有发出生成 POST。这直接验证原版与 RH 当前真实参数不兼容，而非用户图片或凭据的问题。
- 以临时资源库生成的512×512企鹅测试图，执行当前 RunningHub 生产 builder/resolver、真实 Express RH app-info/upload/submit/query 路由。唯一适配是只从进程内存供应测试设置，网络、素材读取、上传、生成、结果下载均未替身化。
- `/api/resources/file/res_rh_live_fixture` 已通过真实素材读取与上传（16,590 bytes、code0），再以 RH 返回文件名提交一次。原任务经过 QUEUED/813、RUNNING/804、SUCCESS/0，约50.46秒完成；未重交生成。
- 生产查询路由已将结果存至临时输出目录，22,463 bytes、512×512 RGBA，完整像素解码通过并已查看，图像包含所上传测试企鹅。验证的是输入传递与任务/结果链路，不将本次样图冒认为抠图质量验收。
- 无凭据参数快照保存在 `tests/fixtures/rh-media-app-info-20261007.json`；私有实网回执和输入/结果图保存在 `local-private/rh-media-live-20261007/`。私有验证器按回执续查原任务，受理不明不重复提交。

仍未取得反馈用户的具体 WebApp ID 或客户端，不将一个应用实网成功冒认为所有 RH 应用、双站或安装版已完整验收。若某应用实际将该字段标为 LIST 等非媒体类型，需对应字段证据，不能通过字段名强行跳过真实枚举。

## 启动慢

用户要求先修 RH，并询问反馈用户启动慢的次数、耗时与卡住阶段；本轮启动路径只有只读检查，没有改动，也未宣称已解决。
