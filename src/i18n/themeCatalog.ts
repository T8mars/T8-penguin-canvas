import type { ThemeTemplate } from '../theme/types';

const BUILT_IN_THEME_NAMES: Readonly<Record<string, string>> = {
  '科技风': 'Tech',
  '像素糖果风': 'Pixel Candy',
  'OP风格': 'One Piece',
  'RH风格': 'RunningHub',
  '火影忍者风格': 'Naruto',
  'EVA风格': 'Evangelion',
  '幽游白书风格': 'Yu Yu Hakusho',
  '灌篮高手风格': 'Slam Dunk',
  '足球小将风格': 'Captain Tsubasa',
  '七龙珠风格': 'Dragon Ball',
  '圣斗士风格': 'Saint Seiya',
  '植物大战僵尸主题 · 庭院守卫': 'Plants vs. Zombies · Garden Defense',
  '牧场物语主题': 'Farm Story',
  '俄罗斯方块主题': 'Tetris',
};

const BUILT_IN_MUSIC_TITLES: Readonly<Record<string, string>> = {
  '不平衡的 KISS 钢琴曲': 'Unbalanced Kiss · piano',
  '潮鸣': 'Shionari',
  '摩诃不思议 Adventure': 'Makafushigi Adventure',
  '天马幻想': 'Pegasus Fantasy',
  '想大声说喜欢你': 'Kimi ga Suki da to Sakebitai',
  '形势逆转': 'Turn the Tables',
  '植物大战僵尸白天（Grasswalk）': 'Plants vs. Zombies Day (Grasswalk)',
  '足球小将主题歌（燃烧英雄）': 'Captain Tsubasa theme (Burning Hero)',
};

function isEnglish(locale: unknown) {
  return String(locale || '').toLowerCase().startsWith('en');
}

export function localizeThemeName(template: Pick<ThemeTemplate, 'name' | 'builtIn'>, locale: unknown) {
  if (!template.builtIn || !isEnglish(locale)) return template.name;
  return BUILT_IN_THEME_NAMES[template.name] || template.name;
}

export function localizeThemeMusicTitle(
  template: Pick<ThemeTemplate, 'builtIn'>,
  title: string,
  locale: unknown,
) {
  if (!template.builtIn || !isEnglish(locale)) return title;
  return BUILT_IN_MUSIC_TITLES[title] || title;
}
