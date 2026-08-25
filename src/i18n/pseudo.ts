const ACCENTS: Record<string, string> = {
  a: 'à', b: 'ƀ', c: 'ç', d: 'đ', e: 'ë', f: 'ƒ', g: 'ğ', h: 'ħ', i: 'ï', j: 'ĵ',
  k: 'ķ', l: 'ľ', m: 'ɱ', n: 'ñ', o: 'ô', p: 'þ', q: 'ʠ', r: 'ř', s: 'š', t: 'ŧ',
  u: 'ü', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ÿ', z: 'ž',
};

/** Development-only pseudo locale used to expose clipping and fixed-width UI. */
export function pseudoLocalize(value: string) {
  const transformed = value.replace(/[a-z]/gi, (character) => {
    const next = ACCENTS[character.toLowerCase()] || character;
    return character === character.toUpperCase() ? next.toUpperCase() : next;
  });
  const padding = ' ～～'.repeat(Math.max(1, Math.ceil(value.length * 0.12)));
  return `［${transformed}${padding}］`;
}
