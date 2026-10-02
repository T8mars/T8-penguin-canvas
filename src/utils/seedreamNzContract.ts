import contract from '../../backend/src/shared/seedreamNzContract.json';

export const SEEDREAM_NZ_FAMILIES = contract.families;
export type SeedreamNzFamily = keyof typeof SEEDREAM_NZ_FAMILIES;
export type SeedreamNzResolution = '1k' | '1.5k' | '2k' | 'custom';
export function seedreamNzFamily(value: unknown): SeedreamNzFamily {
  return typeof value === 'string' && Object.hasOwn(SEEDREAM_NZ_FAMILIES, value)
    ? value as SeedreamNzFamily : 'domestic';
}
export function seedreamNzRuntimeModel(family: SeedreamNzFamily, referenceCount: number): string {
  const models = SEEDREAM_NZ_FAMILIES[family].models;
  return (referenceCount > 0 ? models[1] : models[0]) || models[0];
}
// Capture the event value before the patch enters any asynchronous/replayed updater.
export function seedreamNzFamilyChange(event: { currentTarget: { value: string } }, update: (patch: Record<string, unknown>) => void) {
  const value = seedreamNzFamily(event.currentTarget.value);
  update({ seedreamNzModelFamily: value });
}
export function seedreamNzValidation(family: SeedreamNzFamily, resolution: SeedreamNzResolution, prompt: string, referenceCount: number) {
  const selected = SEEDREAM_NZ_FAMILIES[family];
  if (referenceCount > 10) return { code: 'references', count: 10 };
  if (referenceCount > 0 && !selected.models[1]) return { code: 'textOnly', count: 0 };
  const length = Array.from(prompt.trim()).length;
  if (length < 5 || length > selected.promptMaxLength) return { code: 'prompt', count: selected.promptMaxLength };
  if (resolution !== 'custom' && !selected.resolutions.includes(resolution)) return { code: 'resolution', count: 0 };
  return null;
}
