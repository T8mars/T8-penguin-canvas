export const magi2Zh = {
  mode: '生成模式', auto: '自动', text: '文生视频', frame: '首尾帧', reference: '参考生视频',
  apiDefault: '随模型 / 首帧', generateAudio: '生成音轨', seed: '种子（-1 不指定）',
  modeHint: '自动模式把 1–2 张图当作首尾帧。用角色或风格参考图时请选择参考生视频。',
  error_text: '文生视频不接参考素材。',
  error_frame: '首尾帧需要 1–2 张有序图片，不接视频或音频。',
  error_reference: '参考生视频至少需要一项参考素材。',
  error_prompt: '请填写提示词，最多 15000 字符。',
  error_references: '最多输入 10 张图、5 段视频和 5 段音频。',
  error_duration: '生成时长必须为 4–30 秒的整数。',
  error_seed: '种子必须为 -1 或 0–2147483647 的整数。',
  invalidRequest: '请检查 Magi 2 的提示词、模式和素材。文生不接素材，首尾帧接 1–2 张图，参考生至少接一项素材。',
};

export const magi2En = {
  mode: 'Generation mode', auto: 'Auto', text: 'Text to video', frame: 'Start and end frames', reference: 'Reference to video',
  apiDefault: 'Model / first frame', generateAudio: 'Generate audio', seed: 'Seed (-1 unset)',
  modeHint: 'Auto treats one or two images as frames. Choose Reference to video for character or style references.',
  error_text: 'Text to video does not use references.',
  error_frame: 'Frame mode needs one or two ordered images and no video or audio.',
  error_reference: 'Reference to video needs at least one reference.',
  error_prompt: 'Enter a prompt of at most 15000 characters.',
  error_references: 'Use up to 10 images, 5 videos and 5 audio clips.',
  error_duration: 'Choose a whole duration between 4 and 30 seconds.',
  error_seed: 'Seed must be -1 or a whole number from 0 to 2147483647.',
  invalidRequest: 'Check the Magi 2 prompt, mode and assets. Text mode uses no assets, frame mode needs one or two images, and reference mode needs at least one asset.',
};
