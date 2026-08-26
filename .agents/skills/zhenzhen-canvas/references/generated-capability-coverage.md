# Generated Creator Agent capability coverage

> Machine-generated from the real Canvas Node Schema, creative capability manifest,
> runtime model/action catalog, and handler bindings. Do not edit by hand.

- Aggregate SHA-256: `fc0dbfc30eeaee7564134823bde27ae0846a636573243c25c9d3b380be5f15c5`
- Capabilities / handlers: **31 / 31**
- Canvas nodes: **82**
- Referenced / unreferenced nodes: **73 / 9**
- Accounted / unexplained nodes: **82 / 0**
- Direct capability nodes: **73**
- Internal compatibility nodes: **1**
- Semantically superseded nodes: **8**
- Public capability gaps: **0**
- Fully operable nodes: **19**
- Runtime model/action entries: **277**
- Dynamic node inventory (total / executable / generatable): **82 / 63 / 12**
- Dynamic runtime inventory (LLM / image / video / audio / actions): **34 / 45 / 123 / 17 / 58**
- Operation risk contracts: **152** (L0 91, L1 44, L2 17, L3 0)
- Unknown node references: **0**
- Coverage receipt: `t8-creative-capability-coverage-receipt-v1` / `f425e4dcf82fdcdb81870a710e55b52f76c8f4b1d31ddec04d95d97c142a8437`

“Understand” means the node exists in the authoritative schema. Other columns are true only
when at least one registered high-level capability explicitly advertises that operation.

| Node | Category | Agent exposure | Exec | Gen | Capabilities | Plan | Preview | Apply | Run | Verify | Recover |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `upload` 上传素材 | input | direct-capability | yes | — | `asset.import`, `asset.place`, `canvas.node-add`, `edit.image`, `edit.video` | yes | yes | yes | yes | yes | yes |
| `model-3d-upload` 3D素材上传 | input | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `model-3d-preview` 3D模型预览 | input | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `model-3d` 3D | core | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `grok-image-tools` Grok 分割编辑 | core | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `material-set` 素材集 | input | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `generation-target` 生成目标框 | input | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `output` 输出素材 | input | direct-capability | — | yes | `asset.import`, `canvas.node-add`, `create.audio`, `create.image`, `create.script`, `create.video`, `delivery.package`, `edit.image`, `edit.video`, `image.remove-solid-background`, `image.resample-upscale`, `video.extract-frames` | yes | yes | yes | yes | yes | yes |
| `feishu-bitable-input` 飞书多维表格输入 | input | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `volcengine-assets` 火山素材库 | input | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `feishu-bitable-output` 飞书多维表格输出 | input | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `text` 文本 | core | direct-capability | — | yes | `asset.place`, `canvas.node-add`, `create.audio`, `create.image`, `create.video` | yes | yes | yes | yes | yes | yes |
| `image` 图像 | core | direct-capability | yes | yes | `canvas.node-add`, `create.image`, `edit.image` | yes | yes | yes | yes | yes | yes |
| `video` 视频 | core | direct-capability | yes | yes | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `video-edit` 视频剪辑 | core | direct-capability | — | — | `canvas.node-add`, `delivery.package`, `video-edit.compose` | yes | yes | yes | yes | yes | yes |
| `seedance` SD2.0 | core | direct-capability | yes | — | `canvas.node-add`, `create.video`, `edit.video` | yes | yes | yes | yes | yes | yes |
| `seedance25` SD2.5 | core | direct-capability | yes | — | `canvas.node-add`, `create.video` | yes | yes | yes | yes | yes | yes |
| `fashvsr-video-upscale` FlashVSR 视频超分 | core | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `director-storyboard` 导演分镜台 | core | direct-capability | yes | — | `canvas.node-add`, `director.materialize`, `video-edit.compose` | yes | yes | yes | yes | yes | yes |
| `story` Story 全自动制片 | core | direct-capability | yes | — | `canvas.node-add`, `create.story`, `director.materialize`, `story.adopt-preview`, `story.analyze`, `story.bind-asset`, `story.compile`, `story.import`, `story.plan-previews`, `video-edit.compose` | yes | yes | yes | yes | yes | yes |
| `script-master` 剧本大师 | core | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `audio` 音频 | core | direct-capability | yes | yes | `canvas.node-add`, `create.audio` | yes | yes | yes | yes | yes | yes |
| `llm` LLM | core | direct-capability | yes | yes | `canvas.node-add`, `create.script` | yes | yes | yes | yes | yes | yes |
| `minimax-h3-prompt-enhancer` MiniMax H3提示词增强器 | inspiration | direct-capability | yes | yes | `canvas.node-add`, `create.script` | yes | yes | yes | yes | yes | yes |
| `minimax-music3-prompt-enhancer` MiniMax Music提示词增强器 | inspiration | direct-capability | yes | yes | `canvas.node-add`, `create.script` | yes | yes | yes | yes | yes | yes |
| `minimax-h3-official-prompt-enhancer` MiniMax H3官方提示词增强器 | inspiration | direct-capability | yes | yes | `canvas.node-add`, `create.script` | yes | yes | yes | yes | yes | yes |
| `seedance20-prompt-enhancer` Seedance 2.0提示词增强器 | inspiration | direct-capability | yes | yes | `canvas.node-add`, `create.script` | yes | yes | yes | yes | yes | yes |
| `mv-music-master` MV 音乐大师 | core | direct-capability | yes | yes | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `runninghub` RunningHub | rh | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `runninghub-wallet` RH钱包应用 | rh | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `rh-config` RH 配置 | rh | internal-compat | — | — | — | — | — | — | — | — | — |
| `rh-tools` RH超市 | rh | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `rh-toolbox` RH工具箱 | rh | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `vibex` VibeX工作台 | rh | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `fal-toolbox` Fal超市 | fal | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `grok-oauth-agent` Grok OAuth Agent | grok | direct-capability | yes | — | `canvas.node-add`, `create.audio` | yes | yes | yes | yes | yes | yes |
| `codex-cli-agent` Codex CLI Agent | codex | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `codex-image-conjure` Codex 生图工作台 | codex | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `artist-style-master` 艺术风格大师 | inspiration | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `anime-tag-master` 动漫标签大师 | inspiration | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `comfyui-store` ComfyUI超市 | comfyui | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `comfyui-app-maker` ComfyUI应用制作工具 | comfyui | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `multi-angle-3d` 多角度 3D | special | semantic-superseded | yes | — | — | — | — | — | — | — | — |
| `panorama-720` 720 全景 | special | semantic-superseded | yes | — | — | — | — | — | — | — | — |
| `penguin-portrait` 企鹅肖像 | special | semantic-superseded | yes | — | — | — | — | — | — | — | — |
| `portrait-metadata` 肖像元数据 | special | semantic-superseded | — | — | — | — | — | — | — | — | — |
| `storyboard-grid` 分镜网格 | special | semantic-superseded | — | — | — | — | — | — | — | — | — |
| `drawing-board` 画板 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `browser` 浏览器 | utility | semantic-superseded | — | — | — | — | — | — | — | — | — |
| `image-compare` 图像对比 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `frame-extractor` 抽帧 | utility | direct-capability | yes | — | `video.extract-frames` | yes | yes | yes | yes | yes | yes |
| `frame-pair` 首尾帧获取 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `loop` 循环器 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `random-route` 随机路由 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `subflow` 子工作流 | utility | direct-capability | yes | yes | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `pick-from-set` 从合集获取 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `text-split` 文本分割 | utility | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `resize` 尺寸调整 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `combine` 合并 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `remove-bg` 抠图 | utility | direct-capability | yes | — | `image.remove-solid-background` | yes | yes | yes | yes | yes | yes |
| `upscale` 放大 | utility | direct-capability | yes | — | `image.resample-upscale` | yes | yes | yes | yes | yes | yes |
| `grid-crop` 宫格剪裁 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `grid-editor` 宫格编辑 | utility | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `edit` 编辑 | auxiliary | semantic-superseded | yes | — | — | — | — | — | — | — | — |
| `idea` 灵感 | auxiliary | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `bp` BP 蓝图 | auxiliary | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `relay` 中继 | auxiliary | direct-capability | — | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `remove-ai-watermark` 去AI水印 | auxiliary | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `video-output` 视频输出 | auxiliary | semantic-superseded | — | — | — | — | — | — | — | — | — |
| `cinematic` 电影感 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `video-motion` 视频运镜 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `multi-angle-visual` 可视化多角度 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `portrait-master` 肖像大师 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `pose-master` 姿势大师 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `aggregate-parser` 聚合解析 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `batch-processor` 批量素材处理 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `batch-tagger` 批量打标 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `topaz-image-upscale` Topaz图像高清化 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `topaz-video-upscale` Topaz视频高清化 | toolbox | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `face-expression-3d` 3D表情编辑 | 3d | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `previs-studio` 白模预演 | 3d | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |
| `panorama-3d` 3D全景 | 3d | direct-capability | yes | — | `canvas.node-add` | yes | yes | yes | — | yes | yes |

## Runtime catalog

Catalog presence only means “known”. Every runtime entry is generated fail-closed and must
receive installed / credential / region readiness at request time before it is executable.

- llm: **34**
- image: **45**
- video: **123**
- audio: **17**
- actions: **58**

## Coverage audit

- Nodes without direct capability binding: `rh-config`, `multi-angle-3d`, `panorama-720`, `penguin-portrait`, `portrait-metadata`, `storyboard-grid`, `browser`, `edit`, `video-output`
- Unexplained node types: none
- Internal compatibility: `rh-config`
- Semantically superseded: `multi-angle-3d`, `panorama-720`, `penguin-portrait`, `portrait-metadata`, `storyboard-grid`, `browser`, `edit`, `video-output`
- Public capability gaps: none
- Referenced without run coverage: `model-3d-upload`, `model-3d-preview`, `model-3d`, `grok-image-tools`, `material-set`, `generation-target`, `feishu-bitable-input`, `volcengine-assets`, `feishu-bitable-output`, `video`, `fashvsr-video-upscale`, `script-master`, `mv-music-master`, `runninghub`, `runninghub-wallet`, `rh-tools`, `rh-toolbox`, `vibex`, `fal-toolbox`, `codex-cli-agent`, `codex-image-conjure`, `artist-style-master`, `anime-tag-master`, `comfyui-store`, `comfyui-app-maker`, `drawing-board`, `image-compare`, `frame-pair`, `loop`, `random-route`, `subflow`, `pick-from-set`, `text-split`, `resize`, `combine`, `grid-crop`, `grid-editor`, `idea`, `bp`, `relay`, `remove-ai-watermark`, `cinematic`, `video-motion`, `multi-angle-visual`, `portrait-master`, `pose-master`, `aggregate-parser`, `batch-processor`, `batch-tagger`, `topaz-image-upscale`, `topaz-video-upscale`, `face-expression-3d`, `previs-studio`, `panorama-3d`
- Operations without risk contracts: none
- Capabilities without handlers: none
- Capabilities without verification contracts: none
- Runtime entries without compatibility edges: none

Accounting is separate from operation coverage. `semantic-superseded` records the modern high-level
capability that replaces a legacy renderer without inheriting its plan/run/verify flags.
`public-capability-gap` is deliberately visible debt: the Canvas has a real execution boundary, but
the Agent still needs a dedicated truthful handler before it may claim direct run/verify coverage.
A new or changed node fails the compiler until it has either a real capability or an explicit audited
disposition. Stale dispositions also fail once a direct capability is added.
