import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enUS, zhCN } from '../src/i18n/resources';
import { ENGLISH_NODE_CATALOG, DEV_ENGLISH_NODE_CATALOG } from '../src/i18n/nodeCatalog';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baselinePath = resolve(root, 'scripts/i18n-visible-string-baseline.json');
const sourceRoot = resolve(root, 'src');
const nodeSchema = JSON.parse(readFileSync(resolve(root, 'backend/src/shared/canvasNodeSchema.json'), 'utf8')) as {
  types?: Array<{ type?: unknown; label?: unknown; description?: unknown }>;
};
const writeBaseline = process.argv.includes('--write-baseline');

function flatten(value: unknown, prefix = '', out = new Map<string, string>()) {
  if (typeof value === 'string') {
    out.set(prefix, value);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  Object.entries(value).forEach(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key, out));
  return out;
}

function placeholders(value: string) {
  return Array.from(value.matchAll(/{{\s*([\w.-]+)\s*}}/g), (match) => match[1]).sort();
}

function walk(dir: string, out: string[] = []) {
  readdirSync(dir).forEach((name) => {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (['.ts', '.tsx'].includes(extname(name)) && !name.endsWith('.d.ts')) out.push(path);
  });
  return out;
}

function detectVisibleChinese(file: string, source: string) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const entries = new Set<string>();
  const patterns = [
    />\s*([^<>{}\n]*[\u3400-\u9fff][^<>{}\n]*)\s*</g,
    /\b(?:title|placeholder|aria-label|aria-description)\s*=\s*["']([^"']*[\u3400-\u9fff][^"']*)["']/g,
  ];
  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      const text = String(match[1] || '').trim().replace(/\s+/g, ' ');
      if (text) entries.add(`${rel}::${text}`);
    }
  });
  return entries;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function translationFunctionNames(source: string) {
  const names = new Set<string>();
  for (const match of source.matchAll(/\b(?:const|let)\s*\{([^}]*)\}\s*=\s*useTranslation\(/g)) {
    const bindings = String(match[1] || '');
    const tBinding = bindings.match(/(?:^|,)\s*t\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?=,|$)/);
    if (tBinding) names.add(tBinding[1] || 't');
  }
  return names;
}

const zh = flatten(zhCN);
const en = flatten(enUS);
const failures: string[] = [];
const schemaNodeTypes = new Set((nodeSchema.types || []).map((item) => String(item.type || '')).filter(Boolean));
const developmentNodeTypes = new Set(['rh-toolbox-maker', 'fal-toolbox-maker']);
const ENGLISH_NODE_COVERAGE_CATALOG = {
  ...ENGLISH_NODE_CATALOG,
  ...DEV_ENGLISH_NODE_CATALOG,
};
for (const type of [...schemaNodeTypes, ...developmentNodeTypes]) {
  const copy = ENGLISH_NODE_COVERAGE_CATALOG[type];
  if (!copy?.label.trim()) failures.push(`node catalog missing en-US label: ${type}`);
  if (!copy?.description.trim()) failures.push(`node catalog missing en-US description: ${type}`);
  if (copy && /[\u3400-\u9fff]/.test(`${copy.label}\n${copy.description}`)) {
    failures.push(`node catalog en-US copy still contains CJK text: ${type}`);
  }
}
for (const type of Object.keys(ENGLISH_NODE_COVERAGE_CATALOG)) {
  if (!schemaNodeTypes.has(type) && !developmentNodeTypes.has(type)) failures.push(`orphan node catalog entry: ${type}`);
}
const registrySource = readFileSync(resolve(root, 'src/config/nodeRegistry.ts'), 'utf8');
if (!registrySource.includes('labelKey: nodeLabelKey(') || !registrySource.includes('descriptionKey: nodeDescriptionKey(')) {
  failures.push('node registry does not attach stable labelKey/descriptionKey values');
}

for (const key of new Set([...zh.keys(), ...en.keys()])) {
  if (!zh.has(key)) failures.push(`zh-CN missing key: ${key}`);
  if (!en.has(key)) failures.push(`en-US missing key: ${key}`);
  if (zh.has(key) && en.has(key)) {
    const zhParams = placeholders(zh.get(key)!);
    const enParams = placeholders(en.get(key)!);
    if (JSON.stringify(zhParams) !== JSON.stringify(enParams)) {
      failures.push(`placeholder mismatch: ${key} zh=${zhParams.join(',')} en=${enParams.join(',')}`);
    }
  }
}

const visibleChinese = new Set<string>();
for (const file of walk(sourceRoot)) {
  const source = readFileSync(file, 'utf8');
  detectVisibleChinese(file, source).forEach((entry) => visibleChinese.add(entry));

  if (source.includes('useTranslation(')) {
    const stringNs = source.match(/useTranslation\(\s*['"]([^'"]+)['"]/)?.[1];
    const arrayNs = source.match(/useTranslation\(\s*\[\s*['"]([^'"]+)['"]/)?.[1];
    const defaultNamespace = stringNs || arrayNs || 'common';
    for (const functionName of translationFunctionNames(source)) {
      const callPattern = new RegExp(`\\b${escapeRegExp(functionName)}\\(\\s*['"]([^'"]+)['"]`, 'g');
      for (const match of source.matchAll(callPattern)) {
        const raw = match[1];
        const separator = raw.indexOf(':');
        const key = separator >= 0 ? `${raw.slice(0, separator)}.${raw.slice(separator + 1)}` : `${defaultNamespace}.${raw}`;
        if (!zh.has(key)) failures.push(`${relative(root, file)} references missing i18n key: ${key}`);
      }
    }
  }
}

if (writeBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify({ version: 1, entries: Array.from(visibleChinese).sort() }, null, 2)}\n`, 'utf8');
  console.log(`[i18n] wrote visible-string baseline: ${visibleChinese.size}`);
} else {
  if (!existsSync(baselinePath)) failures.push('missing scripts/i18n-visible-string-baseline.json');
  else {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as { entries?: unknown };
    const allowed = new Set(Array.isArray(baseline.entries) ? baseline.entries.map(String) : []);
    const additions = Array.from(visibleChinese).filter((entry) => !allowed.has(entry));
    additions.slice(0, 80).forEach((entry) => failures.push(`new hard-coded visible Chinese string: ${entry}`));
    if (additions.length > 80) failures.push(`... ${additions.length - 80} additional hard-coded strings`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`[i18n] zh-CN/en-US keys=${zh.size}; nodes=${schemaNodeTypes.size}; visible baseline=${visibleChinese.size}; check=ok`);
