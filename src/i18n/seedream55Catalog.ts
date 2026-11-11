export const seedream55Zh = {
  layerFile: '保存第{{index}}张原始分层图片',
  maxImages: '最大返回图片数（含底图，2–100）', textRecognition: '识别文字图层', layerHint: '完整保留底图和全部有序图层，可返回多张不同尺寸、透明度的图片。',
  background: '背景', auto: '自动', transparent: '透明（仅 PNG）', opaque: '不透明', watermark: '添加水印', identifier: '安全标识（可选，最多64字符）',
  draftHint: '用同账号、同区域、7天内已完成的草稿任务生成原生1080P成片。沿用原提示词、素材、时长与比例；普通480P视频链接不能替代草稿ID。',
  draftId: '草稿任务 ID', draftPlaceholder: '留空读取已连接的草稿节点', videoFormat: '成片格式', lastFrame: '返回尾帧', createDraft: '生成480P草稿', sourceHint: '草稿固定480P。完成后连接同区域的“draft-to-video”模型转高清。', draftResult: '已完成的草稿 ID',
  errors: { model: '模型无效。', boolean: '开关值无效。', images: '参考图数量不符：文生0张、图生1–10张、分层恰好1张。', prompt: '生成/编辑提示词需5–5000字符；分层最多2000字符。', format: '输出格式无效。', resolution: '分辨率无效。', maxImages: '分层返回数量必须为2–100。', unsupported: '当前模型不支持这些参数。', background: '背景选项无效。', transparentPng: '透明背景必须选择PNG。', dimensions: '自定义宽高需240–11520，面积921600–8294400像素，比例1:16–16:1。', identifier: '安全标识最多64字符。', draftId: '请填写已完成的草稿任务ID，不能使用视频URL。', draftReferences: '草稿转高清只读取草稿ID，请移除额外图片/音频和本地视频素材。', ambiguousDraft: '连接了多个不同草稿，或手填ID与上游不一致。', draftRegion: '草稿与高清模型必须使用同一区域。' }
};
export const seedream55En = {
  layerFile: 'Save original layer {{index}}',
  maxImages: 'Maximum images including base (2–100)', textRecognition: 'Recognize text layers', layerHint: 'Keep the base and every ordered layer, including different sizes and transparency.',
  background: 'Background', auto: 'Auto', transparent: 'Transparent (PNG only)', opaque: 'Opaque', watermark: 'Add watermark', identifier: 'Safety identifier (optional, up to 64 characters)',
  draftHint: 'Enhance a completed draft from the same account and region within 7 days to native 1080P. Prompt, references, duration and ratio are inherited. A normal 480P video URL is not a draft ID.',
  draftId: 'Draft task ID', draftPlaceholder: 'Leave blank to use the connected draft node', videoFormat: 'Video format', lastFrame: 'Return last frame', createDraft: 'Generate 480P draft', sourceHint: 'Drafts use 480P. Connect the completed result to the matching regional draft-to-video model.', draftResult: 'Completed draft ID',
  errors: { model: 'Invalid model.', boolean: 'Invalid boolean.', images: 'Use no references for T2I, 1–10 for I2I, exactly one for layers.', prompt: 'Generation/edit prompt: 5–5000 characters; layers: at most 2000.', format: 'Invalid output format.', resolution: 'Invalid resolution.', maxImages: 'Layer count must be 2–100.', unsupported: 'These controls do not apply to this model.', background: 'Invalid background.', transparentPng: 'Transparent backgrounds require PNG.', dimensions: 'Dimensions: 240–11520, area 921600–8294400 pixels, ratio 1:16–16:1.', identifier: 'Safety identifier is limited to 64 characters.', draftId: 'Enter a completed draft task ID, not a video URL.', draftReferences: 'Enhancement uses only the draft ID. Remove extra images/audio and local videos.', ambiguousDraft: 'Multiple draft IDs or a conflicting manual ID.', draftRegion: 'Draft and enhancement models must use the same region.' }
};
