export type RhFieldOption = string | number;

function parseMetadata(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

function optionValue(value: unknown): RhFieldOption | undefined {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const actual = 'value' in item ? item.value : item.label ?? item.name ?? item.title;
  return typeof actual === 'string' || (typeof actual === 'number' && Number.isFinite(actual)) ? actual : undefined;
}

function optionList(value: unknown): RhFieldOption[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const values = value.map(optionValue);
  // Never interpret an INT/FLOAT/STRING widget + metadata as enum values.
  if (values.some((item) => item === undefined)) return null;
  return [...new Set(values as RhFieldOption[])];
}

const OPTION_KEYS = ['options', 'list', 'values', 'enum', 'choices', 'items', 'selectOptions', 'dropdown'] as const;

/** Exact Provider values only. Field names cannot tell us a workflow's enum. */
export function extractRhFieldOptions(field: any): RhFieldOption[] | null {
  // RH media widgets can expose the workflow server's existing filenames in
  // fieldData/options. Those are defaults, not an exhaustive enum: new media
  // must retain its upload valueType and be replaced by RH's returned fileName.
  // Use the authoritative type, never a field name or a URL-shaped input.
  if (/^(IMAGE|VIDEO|AUDIO)$/i.test(String(field?.fieldType || ''))) return null;
  for (const candidate of [field?.fieldData, ...OPTION_KEYS.map((key) => field?.[key])]) {
    const parsed = parseMetadata(candidate);
    const direct = optionList(parsed);
    if (direct) return direct;
    // ComfyUI INPUT_TYPES combo: [[exact values], {default, ...}].
    if (Array.isArray(parsed)) {
      const nested = optionList(parsed[0]);
      if (nested) return nested;
    } else if (parsed && typeof parsed === 'object') {
      for (const key of OPTION_KEYS) {
        const nested = optionList((parsed as Record<string, unknown>)[key]);
        if (nested) return nested;
      }
    }
  }
  if (/^(LIST|SELECT|DROPDOWN|COMBO|ENUM)$/i.test(String(field?.fieldType || ''))) {
    return optionList(field?.fieldValue);
  }
  return null;
}

/** Keep saved input unchanged; reject an invalid real enum before paid submit. */
export function resolveRhFieldValue(field: any, value: string | number, invalidMessage?: string): string | number {
  const choices = extractRhFieldOptions(field);
  if (!choices) return value;
  const exact = choices.find((choice) => String(choice) === String(value));
  if (exact !== undefined) return exact;
  throw Object.assign(new Error(invalidMessage || `RunningHub #${field?.nodeId || ''} ${field?.fieldName || ''}: select an exact application option.`), {
    code: 'RH_FIELD_OPTION_INVALID',
  });
}
