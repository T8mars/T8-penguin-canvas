const { audio: contract } = require('../shared/nbLowpriceDoubaoContract.json');
const models = new Set([contract.cloneModel, contract.iclModel]);
const count = value => [...value].length;

// Pure preflight. Validate the complete applicable contract before upload/POST.
function buildDoubaoVoicePayload(request) {
  const model = String(request.model || '').trim();
  if (!models.has(model)) throw new Error('未知 Doubao Voice 模型');
  const clone = model === contract.cloneModel;
  const prompt = String(request.prompt || '').trim();
  const [min, max] = clone ? contract.clonePrompt : contract.iclPrompt;
  if (count(prompt) < min || count(prompt) > max) throw new Error(`${model} 文本长度须为 ${min}-${max} 字符`);
  const input = request.doubaoVoice;
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new Error('Doubao Voice 参数必须为对象');
  const values = input || {};
  const fields = clone ? contract.cloneFields : contract.iclFields;
  const metadata = {};
  const voiceModel = values.voice_model ?? contract.iclFields.voice_model.default;
  for (const [key, rule] of Object.entries(fields)) {
    if (!clone && key === 'context_texts' && voiceModel !== 'api_default' && voiceModel !== '') continue;
    const raw = values[key] ?? rule.default;
    if (raw === undefined || raw === '' || raw === 'api_default') continue;
    if (rule.kind === 'boolean') {
      if (![true, false, 'enabled', 'disabled'].includes(raw)) throw new Error(`${key} 必须为布尔值或 API 默认`);
      metadata[key] = raw === true || raw === 'enabled';
    } else if (rule.kind === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < rule.min || raw > rule.max || (rule.integer && !Number.isInteger(raw))) throw new Error(`${key} 范围须为 ${rule.min}-${rule.max}`);
      metadata[key] = raw;
    } else if (rule.kind === 'select') {
      if (typeof raw !== 'string' || !rule.options.includes(raw)) throw new Error(`${key} 选项无效`);
      metadata[key] = rule.numeric ? Number(raw) : raw;
    } else {
      if (typeof raw !== 'string') throw new Error(`${key} 必须为文本`);
      const value = raw.trim();
      if (rule.max && count(value) > rule.max) throw new Error(`${key} 最多 ${rule.max} 字符`);
      if (value) metadata[key] = value;
    }
  }
  if (clone) {
    const custom = metadata.custom_speaker_id;
    if (custom && (count(custom) < 8 || !/^[A-Za-z]/.test(custom))) throw new Error('custom_speaker_id 须为 8-256 字符且英文字母开头');
    const sources = [request.audioUrl, ...(Array.isArray(request.audioUrls) ? request.audioUrls : [])].filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
    if (sources.length !== 1) throw new Error('Doubao 克隆需要且仅接受一段参考音频');
    return { payload: { model, prompt, metadata }, source: sources[0], clone: true };
  }
  const speaker = String(request.speaker || '').trim();
  if (!speaker) throw new Error('ICL 必须填写或连接训练返回的音色 ID');
  metadata.speaker = speaker;
  if (metadata.latex_parser === 'v2') {
    if (metadata.disable_markdown_filter === true) throw new Error('LaTeX v2 不能禁用 Markdown 过滤');
    metadata.disable_markdown_filter = false;
  }
  if (metadata.format === 'mp3' && metadata.bit_rate !== undefined) {
    const minRate = metadata.disable_default_bit_rate === true ? 16000 : 64000;
    if (metadata.bit_rate < minRate || (metadata.bit_rate < 64000 && ![16000, 32000].includes(metadata.bit_rate))) throw new Error('MP3 bit_rate 无效；低码率须显式开启且为 16000 或 32000');
  }
  return { payload: { model, prompt, metadata }, clone: false };
}

module.exports = { isDoubaoVoiceModel: model => models.has(model), buildDoubaoVoicePayload };
