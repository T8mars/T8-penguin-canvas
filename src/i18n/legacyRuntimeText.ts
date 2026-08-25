export type LegacyRuntimeArea = 'story' | 'scriptMaster' | 'mvMusicMaster';

const EXACT: Readonly<Record<LegacyRuntimeArea, Readonly<Record<string, string>>>> = {
  story: {
    '用户已停止': 'Stopped by the user',
    '已进入准备资产；可先电脑上传、绑定上游或资产库，再手动生成仍缺失的资产。': 'Asset preparation is ready. Upload from this computer, bind upstream or library assets, then generate only what is still missing.',
    '正在理解剧本并规划镜头…': 'Understanding the script and planning shots…',
    '分镜和资产已规划，可继续微调': 'Shots and assets are planned and ready for refinement.',
    '已使用本地分段完成基础规划，请检查资产识别': 'Basic planning was completed with local segmentation. Review the detected assets.',
    '资产已齐，已进入提示词编译': 'All assets are ready; prompt compilation is now active.',
    '资产已齐，已自动进入提示词编译': 'All assets are ready; prompt compilation started automatically.',
    '提示词已编译并通过覆盖检查': 'Prompts were compiled and passed coverage checks.',
    '正在按镜头顺序合成成片…': 'Composing the final video in shot order…',
    '成片已完成': 'Final video completed.',
    'Story 正在执行其他生产步骤；完成或停止后即可生成该资产': 'Story is running another production step. Generate this asset after it finishes or is stopped.',
    '当前无法启动资产生成，请稍后重试': 'Asset generation cannot start right now. Try again shortly.',
    '上传失败': 'Upload failed.',
    '镜头已按语义断点拆成两段，约束与资产引用已保留': 'The shot was split at a semantic boundary; constraints and asset references were preserved.',
    '拆分镜头失败': 'Could not split the shot.',
    '已与下一镜头合并': 'Merged with the next shot.',
    '合并镜头失败': 'Could not merge the shots.',
    '资产已删除，相关镜头已标记为需更新': 'The asset was deleted; related shots were marked for update.',
    '生产修订已变化，迟到成片未覆盖当前项目': 'The production revision changed; a late final video did not overwrite the current project.',
  },
  scriptMaster: {
    '导入剧本': 'Import script',
    '已撤销上一项编辑': 'Undid the previous edit.',
    '已重做编辑': 'Redid the edit.',
    '已合并同场景内相邻且未锁定的镜头，总时长保持不变': 'Merged adjacent unlocked shots in the same scene without changing total duration.',
    '请选择同场景内至少两个相邻且未锁定的画面片段': 'Select at least two adjacent unlocked visual clips in the same scene.',
    '已按整数帧平均分配全部镜头时长': 'Distributed all shot durations evenly on whole frames.',
    '请先粘贴或选择剧本文本': 'Paste or select script text first.',
    '没有识别到图片、视频或音频文件': 'No image, video, or audio file was recognized.',
    '素材上传失败': 'Asset upload failed.',
    '上游素材均已同步，或当前没有可用素材': 'All upstream assets are already synchronized, or none are currently available.',
    '全部逐镜提示词已编译并复制': 'All shot-by-shot prompts were compiled and copied.',
    '全部逐镜提示词已编译；未提交任何 Provider': 'All shot-by-shot prompts were compiled; no Provider request was submitted.',
    '请先在统一模型选择器中选择 LLM 平台与模型': 'Select an LLM platform and model in the unified model selector first.',
    '没有可分析镜头；请先导入剧本或新增镜头': 'There are no shots to analyze. Import a script or add a shot first.',
    '已采纳当前 LLM 候选；锁定镜头保持不变，生成仍未触发': 'Adopted the current LLM candidate. Locked shots were preserved and generation was not started.',
    '候选采纳失败': 'Could not adopt the candidate.',
    '已放弃当前 LLM 候选，项目内容未变化': 'Discarded the current LLM candidate; project content is unchanged.',
    '已导出项目、PromptPack、AudioPlan、EDL、引用清单与 Director 适配数据': 'Exported the project, PromptPack, AudioPlan, EDL, reference manifest, and Director adapter data.',
    '当前编译结果没有可发送的下游节点': 'The current compilation has no downstream nodes to send.',
    '项目已变化，请重新生成并确认下游预览': 'The project changed. Regenerate and confirm the downstream preview.',
    '已按整数帧修剪片段': 'Trimmed the clip on whole frames.',
    '已移动所选片段；图片与音频别名保持不变': 'Moved the selected clips; image and audio aliases were preserved.',
    '更改已写入画布项目': 'Changes were written to the canvas project.',
    '媒体探测失败': 'Media probing failed.',
    'LLM 分析失败': 'LLM analysis failed.',
  },
  mvMusicMaster: {
    '文本候选缺少持久资产或内容哈希，不能签发 ReviewReceipt。': 'The text candidate lacks a persisted asset or content hash, so a ReviewReceipt cannot be issued.',
    '人工确认 BPM 必须在 30–300 之间。': 'The manually confirmed BPM must be between 30 and 300.',
    '请先展开并完整审阅这版视觉圣经，再点击“标记已审阅”。': 'Expand and fully review this Visual Bible before selecting “Mark reviewed”.',
    '请先完整审阅这版 PromptPack，再点击“标记已审阅”。': 'Fully review this PromptPack before selecting “Mark reviewed”.',
    '每个分段都必须采用一版 Prompt 后才能进入分镜图片阶段。': 'Every segment must adopt one Prompt version before entering the storyboard-image stage.',
    '必须先实际加载并查看这张图片，且通过文件解码与哈希校验后才能采用。': 'Load and view this image, then pass file decoding and hash verification before adoption.',
    '当前图片缺少与本候选资产严格绑定的 ReviewReceipt，请重新打开大图查看后再采用。': 'This image lacks a ReviewReceipt strictly bound to the candidate asset. Reopen the full-size image before adoption.',
    '每个镜头都必须检查并采用一张真实分镜图。': 'Every shot must review and adopt one real storyboard image.',
    '审阅期间窗口进入后台；本次播放证据已失效，请回到开头重新完整播放。': 'The window went to the background during review. This playback evidence is invalid; replay fully from the beginning.',
    '必须以 1× 速度从头到尾覆盖播放该候选；拖到结尾不会签发 ReviewReceipt。': 'Play the candidate from beginning to end at 1× speed. Seeking to the end does not issue a ReviewReceipt.',
    '该视频任务的 Provider 回执模型与批准模型不一致或提交状态未决，禁止采用；请人工核对后显式新建修订。': 'The Provider receipt model does not match the approved model, or submission is unresolved. Adoption is blocked; review it manually and create an explicit revision.',
    '必须先实际加载并查看这段视频，且通过下载、FFprobe 与哈希校验后才能采用。': 'Load and watch this video, then pass download, FFprobe, and hash verification before adoption.',
    '当前视频缺少与本候选资产严格绑定的 ReviewReceipt，请重新播放后再采用。': 'This video lacks a ReviewReceipt strictly bound to the candidate asset. Replay it before adoption.',
    '每个音频段都必须检查并采用一段真实视频。': 'Every audio segment must review and adopt one real video.',
    '最终 MV 必须以 1× 速度从头到尾覆盖播放；拖到末尾不会签发 QCReport。': 'Play the final MV from beginning to end at 1× speed. Seeking to the end does not issue a QCReport.',
    '最终 MV 的物理校验回执与当前 EDL/合成产物不一致，不能签发 QC。': 'The final MV verification receipt does not match the current EDL/composition output, so QC cannot be issued.',
    '无法建立持久 Run/Attempt，已停止调用 Provider。': 'A persisted Run/Attempt could not be created; the Provider call was stopped.',
  },
};

type Rule = readonly [RegExp, (...groups: string[]) => string];

const STORY_RUN_ENGLISH: Readonly<Record<string, string>> = {
  一键生产: 'Produce all',
  分析剧本: 'Analyze script',
  生成资产: 'Generate asset',
  生成缺失资产: 'Generate missing assets',
  编译提示词: 'Compile prompts',
  生成缺失视频: 'Generate missing videos',
  合成为片: 'Compose final video',
  重试失败任务: 'Retry failed tasks',
};

const RULES: Readonly<Record<LegacyRuntimeArea, readonly Rule[]>> = {
  story: [
    [/^(.+)请求正在提交…$/, (label) => `Submitting ${STORY_RUN_ENGLISH[label] || label} request…`],
    [/^已达到本次新任务上限，剩余 (\d+) 个资产待下次继续$/, (count) => `This run reached its new-task limit; ${count} assets remain for the next run.`],
    [/^(\d+) 个资产完成，(\d+) 个失败，可仅重试失败$/, (done, failed) => `${done} assets completed and ${failed} failed. You can retry failed items only.`],
    [/^(\d+) 个资产完成；已达到本次新任务上限，剩余 (\d+) 个待下次继续$/, (done, remaining) => `${done} assets completed; the new-task limit was reached and ${remaining} remain for the next run.`],
    [/^(.+) 已重新生成；原素材仅在新结果成功后才被替换$/, (name) => `${name} was regenerated; the original asset was replaced only after the new result succeeded.`],
    [/^本轮最多启动 (\d+) 个新任务；请等待当前任务完成后再继续$/, (count) => `This run can start at most ${count} new tasks. Wait for current tasks to finish before continuing.`],
    [/^(.+) 正在(重新)?生成；当前最多并发 (\d+) 个资产任务…$/, (name, again, concurrency) => `${name} is ${again ? 'being regenerated' : 'generating'}; up to ${concurrency} asset tasks can run concurrently…`],
    [/^(\d+) 个资产完成，(\d+) 个失败；其他资产可继续并发生成$/, (done, failed) => `${done} assets completed and ${failed} failed; other assets can continue generating concurrently.`],
    [/^(\d+) 个资产已生成；每张旧图都只在新图成功后替换$/, (count) => `${count} assets were generated; each old image was replaced only after the new one succeeded.`],
    [/^已达到本次新任务上限，剩余 (\d+) 个镜头待下次继续$/, (count) => `This run reached its new-task limit; ${count} shots remain for the next run.`],
    [/^正在并行生成 (\d+) 个镜头视频…$/, (count) => `Generating ${count} shot videos in parallel…`],
    [/^(\d+) 个镜头完成，(\d+) 个失败，可仅重试失败$/, (done, failed) => `${done} shots completed and ${failed} failed. You can retry failed items only.`],
    [/^(\d+) 个镜头完成；已达到本次新任务上限，剩余 (\d+) 个待下次继续$/, (done, remaining) => `${done} shots completed; the new-task limit was reached and ${remaining} remain for the next run.`],
    [/^(.+) 当前无法加入生成队列$/, (name) => `${name} cannot join the generation queue right now.`],
    [/^(.+) 已加入并发生成队列$/, (name) => `${name} joined the concurrent generation queue.`],
    [/^(.+) 正在准备生成…$/, (name) => `Preparing to generate ${name}…`],
    [/^正在上传 (.+)…$/, (name) => `Uploading ${name}…`],
    [/^(.+) 已上传并进入资产中心$/, (name) => `${name} was uploaded and added to Asset Center.`],
    [/^(.+) 已上传$/, (name) => `${name} was uploaded.`],
    [/^上游没有可用的未绑定(音频|图片)，请先连接对应素材节点$/, (kind) => `No unbound upstream ${kind === '音频' ? 'audio' : 'image'} is available. Connect the corresponding asset node first.`],
    [/^(.+) 已绑定上游素材$/, (name) => `${name} was bound to an upstream asset.`],
    [/^(.+) 已从资产库绑定「(.+)」$/, (name, title) => `${name} was bound to “${title}” from the asset library.`],
    [/^(.+) 正在生成，请等待完成或先停止当前流程$/, (name) => `${name} is generating. Wait for completion or stop the current process first.`],
    [/^(.+) 已清空，可重新上传或 AI 生成$/, (name) => `${name} was cleared and can be uploaded or AI-generated again.`],
  ],
  scriptMaster: [
    [/^(.+)工具已启用$/, (tool) => `${tool} tool enabled.`],
    [/^已在 (.+) 切分所选片段$/, (timecode) => `Split the selected clip at ${timecode}.`],
    [/^已复制 (\d+) 个时间线片段$/, (count) => `Duplicated ${count} timeline clips.`],
    [/^已删除 (\d+) 个可编辑片段；锁定内容保持不变$/, (count) => `Deleted ${count} editable clips; locked content was preserved.`],
    [/^确定性解析完成：(\d+) 场 · (\d+) 镜 · 未调用模型$/, (scenes, shots) => `Deterministic parsing completed: ${scenes} scenes · ${shots} shots · no model called.`],
    [/^已加入 (\d+) 个素材；每个参考图\/音频都有独立稳定别名与轨道$/, (count) => `Added ${count} assets; every reference image/audio item has an independent stable alias and track.`],
    [/^已同步 (\d+) 个上游素材$/, (count) => `Synchronized ${count} upstream assets.`],
    [/^编译完成，但有 (\d+) 个硬阻断；未提交任何 Provider$/, (count) => `Compilation completed with ${count} hard blockers; no Provider request was submitted.`],
    [/^正在显式分析 (.+) 字符 · (\d+) 镜；不会调用图像\/视频\/音频 Provider$/, (characters, shots) => `Explicitly analyzing ${characters} characters · ${shots} shots; image, video, and audio Providers will not be called.`],
    [/^分析候选已进入审阅：(\d+) 镜 · 未自动采纳$/, (count) => `The analysis candidate entered review: ${count} shots · not adopted automatically.`],
    [/^下游需要 (\d+) 个节点，超过单次预览上限 (\d+)；请缩小范围或先合并合法片段$/, (count, limit) => `The downstream flow needs ${count} nodes, exceeding the ${limit}-node preview limit. Narrow the scope or merge valid clips first.`],
    [/^稳定节点 ID (.+) 已被其他类型 (.+) 占用$/, (id, type) => `Stable node ID ${id} is already used by type ${type}.`],
    [/^无法为下游节点 (.+) 计算安全落点$/, (id) => `Could not calculate a safe placement for downstream node ${id}.`],
    [/^已生成 (\d+) 个(.+)节点的服务端预览；尚未写入画布$/, (count, kind) => `Generated a server preview for ${count} ${kind} nodes; nothing has been written to the canvas.`],
    [/^(已确认|已写入) (\d+) 个下游节点 · 画布 r(\d+)$/, (action, count, revision) => `${action === '已确认' ? 'Confirmed' : 'Wrote'} ${count} downstream nodes · canvas r${revision}.`],
    [/^(.+)；请重新预览$/, (reason) => `${reason}; preview again.`],
    [/^框选 (\d+) 个片段$/, (count) => `Marquee-selected ${count} clips.`],
  ],
  mvMusicMaster: [
    [/^已保存的扩展 LLM 渠道不存在、未启用或不支持 Chat；请重新选择渠道。$/, () => 'The saved extended LLM channel is missing, disabled, or does not support Chat. Select a channel again.'],
    [/^已保存的 LLM 渠道 (.+) 无效；请重新选择。$/, (source) => `The saved LLM channel ${source} is invalid. Select it again.`],
    [/^已保存的 LLM 模型 (.+) 不属于当前渠道；请重新选择。$/, (model) => `The saved LLM model ${model} does not belong to the current channel. Select it again.`],
    [/^已保存的图像选择无效（(.+) \/ (.+)）；请重新选择。$/, (provider, model) => `The saved image selection is invalid (${provider} / ${model}). Select it again.`],
    [/^已保存的视频选择无效（(.+) \/ (.+) \/ (.+) \/ (.+)）；请重新选择。$/, (family, provider, model, resolution) => `The saved video selection is invalid (${family} / ${provider} / ${model} / ${resolution}). Select it again.`],
    [/^已保存的视频选择无效（family=(.+)，provider=(.+)，model=(.+)，resolution=(.+)）；不会静默改用其他计费配置。$/, (family, provider, model, resolution) => `The saved video selection is invalid (family=${family}, provider=${provider}, model=${model}, resolution=${resolution}); no other billing configuration will be selected silently.`],
    [/^H3 Multi full-reference 当前要求恰好 1 张已物化人设原图，当前为 (\d+) 张；不会静默省略或猜测主身份。$/, (count) => `H3 Multi full-reference currently requires exactly one materialized identity image; ${count} are present. The primary identity will not be omitted or guessed silently.`],
    [/^(.+) 最多绑定 (\d+) 张分镜参考，但第 (\d+) 段规划了 (\d+) 个镜头。请回到导演设置减少镜头数或改用支持更多参考图的模型，禁止先付费出图。$/, (model, limit, segment, shots) => `${model} supports at most ${limit} storyboard references, but segment ${segment} plans ${shots} shots. Reduce the shot count in Director settings or choose a model with a larger reference limit before any paid image generation.`],
  ],
};

export function localizeLegacyRuntimeText(
  area: LegacyRuntimeArea,
  locale: string | undefined,
  value: unknown,
): string {
  const source = String(value || '');
  if (!source || !locale?.toLowerCase().startsWith('en')) return source;
  const exact = EXACT[area][source];
  if (exact) return exact;
  for (const [pattern, render] of RULES[area]) {
    const match = source.match(pattern);
    if (match) return render(...match.slice(1));
  }
  return source;
}
