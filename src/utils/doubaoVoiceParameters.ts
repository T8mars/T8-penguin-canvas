export type DoubaoVoiceParameters = Record<string, string | number | boolean>;

// Accumulate edits synchronously before ReactFlow flushes its node patch queue.
// A new canonical props object (reload/import/undo) replaces the accumulator.
export function createDoubaoParameterEditor(initial: DoubaoVoiceParameters) {
  let source = initial, current = initial;
  return {
    sync(next: DoubaoVoiceParameters) {
      if (next !== source) { source = next; current = next; }
    },
    change(key: string, value: string | number | boolean) {
      if (Object.is(current[key], value)) return { changed: false, value: current };
      current = { ...current, [key]: value };
      return { changed: true, value: current };
    },
  };
}
