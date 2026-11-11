export const h3TurboZh = {
  imageHint: '0 张参考图为文生图，最多 {{count}} 张有序参考图为编辑；返回一张原文件。',
  qwenHint: '提示词最多 8192 UTF-8 字节；720p 仅适用于有参考图的编辑。',
  videoHint: '3–15 秒；最多 9 张 PNG/JPEG/WebP（每张 10 MiB、合计 50 MiB）和 3 段 MP3/WAV（合计 10 MiB）。不支持视频参考或 Seed。',
  ratio: '画面比例', resolution: '分辨率', seed: 'Seed（-1 不传，0 有效）', format: '原文件格式',
  invalid: '参数或素材不符合模型要求，请检查提示词、参考数量、比例、分辨率及 Seed。',
};
export const h3TurboEn = {
  imageHint: 'No references: text-to-image. Up to {{count}} ordered references: editing. Returns one original file.',
  qwenHint: 'Prompt: at most 8192 UTF-8 bytes. 720p requires reference images.',
  videoHint: '3–15 seconds; up to 9 PNG/JPEG/WebP images (10 MiB each, 50 MiB total) and 3 MP3/WAV clips (10 MiB total). No video references or Seed.',
  ratio: 'Aspect ratio', resolution: 'Resolution', seed: 'Seed (-1 omitted, 0 valid)', format: 'Original file format',
  invalid: 'Check the prompt, references, aspect ratio, resolution and Seed against the model requirements.',
};
