export const doubaoVoiceZh = {
  model: '具体模型', speaker: '训练返回的音色 ID（或连接左侧音色口）', advanced: '高级参数',
  api_default: 'API 默认（不提交）', enabled: '开启', disabled: '关闭',
  cloneHint: '训练需要且仅接受一段清晰语音，编码后 WAV 不超过 10 MiB；试听文本 4–300 字符。样本语言须匹配：0 中文，1 英语。返回的音色 ID 可从右侧文字口连接到 ICL 左侧音色口。',
  iclHint: '使用同账号训练返回的音色 ID；合成文本 1–10000 字符。指定语音模型时不提交表达指令。首次合成可能另收音色槽费用，以最终账单为准。全部音频会保存，不保证返回字幕时间戳。',
  fields: {
    custom_speaker_id: '自定义音色 ID（可选）', language: '训练样本语言', reference_text: '样本对应文本',
    enable_audio_denoise: '音频降噪', disable_volume_normalization: '禁用音量归一化', speaker_id: '上游训练 ID（不是自定义音色 ID）',
    voice_model: '语音模型', format: '输出格式', sample_rate: '采样率', speech_rate: '语速', loudness_rate: '音量', pitch: '音高',
    explicit_language: '合成语言', context_texts: '表达指令', bit_rate: '比特率', max_length_to_filter_parenthesis: '括号过滤长度', silence_duration: '尾部静音（毫秒）',
    enable_subtitle: '请求字幕', disable_markdown_filter: '禁用 Markdown 过滤', disable_emoji_filter: '禁用 Emoji 过滤', enable_latex_tn: '朗读 LaTeX',
    aigc_watermark: '音频 AIGC 水印', disable_default_bit_rate: '允许低 MP3 比特率', tone_fidelity: '音色保真（语言须匹配）', aigc_metadata_enable: 'AIGC 元数据水印',
    latex_parser: 'LaTeX 解析器', section_id: '对话 ID', aigc_metadata_content_producer: '内容生产者', aigc_metadata_produce_id: '生产编号',
    aigc_metadata_content_propagator: '内容传播者', aigc_metadata_propagate_id: '传播编号',
  },
};
export const doubaoVoiceEn = {
  model: 'Model', speaker: 'Trained speaker ID (or connect the left speaker port)', advanced: 'Advanced settings',
  api_default: 'API default (omit)', enabled: 'Enabled', disabled: 'Disabled',
  cloneHint: 'Train with exactly one clear voice sample, encoded WAV up to 10 MiB; preview text is 4–300 characters. Match the sample language: 0 Chinese, 1 English. Connect the right text output to the ICL speaker input.',
  iclHint: 'Use a speaker trained under the same account; synthesis text is 1–10000 characters. A specified voice model omits delivery instructions. First synthesis may include a voice-slot fee; final billing applies. All audio is saved; subtitle timing is not guaranteed.',
  fields: {
    custom_speaker_id: 'Custom speaker ID (optional)', language: 'Sample language', reference_text: 'Matching sample transcript',
    enable_audio_denoise: 'Audio denoising', disable_volume_normalization: 'Disable volume normalization', speaker_id: 'Provider training ID (not the custom ID)',
    voice_model: 'Voice model', format: 'Output format', sample_rate: 'Sample rate', speech_rate: 'Speech rate', loudness_rate: 'Loudness', pitch: 'Pitch',
    explicit_language: 'Synthesis language', context_texts: 'Delivery instructions', bit_rate: 'Bit rate', max_length_to_filter_parenthesis: 'Parenthesis filter length', silence_duration: 'Trailing silence (ms)',
    enable_subtitle: 'Request subtitles', disable_markdown_filter: 'Disable Markdown filtering', disable_emoji_filter: 'Disable emoji filtering', enable_latex_tn: 'Read LaTeX',
    aigc_watermark: 'Audible AIGC watermark', disable_default_bit_rate: 'Allow low MP3 bit rates', tone_fidelity: 'Tone fidelity (match languages)', aigc_metadata_enable: 'AIGC metadata watermark',
    latex_parser: 'LaTeX parser', section_id: 'Conversation ID', aigc_metadata_content_producer: 'Content producer', aigc_metadata_produce_id: 'Production ID',
    aigc_metadata_content_propagator: 'Content distributor', aigc_metadata_propagate_id: 'Distribution ID',
  },
};
