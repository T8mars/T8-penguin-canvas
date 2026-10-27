import klingV4 from '../../backend/src/shared/klingV4Contract.json';
const IMAGE_OUTPUT_NODE_TYPES = new Set(['image', 'edit']);

/**
 * ImageNode keeps its prompt in node data for reruns and prompt metadata, but its
 * public output contract is image-only unless the user explicitly opts back in.
 * Missing data is treated as the new default so existing saved canvases migrate
 * without rewriting their documents.
 */
export function shouldCollectNodeTextOutput(nodeType: unknown, data: unknown, routedData?: unknown): boolean {
  if (nodeType === 'video' && data && typeof data === 'object' && klingV4.auxiliaryModels.includes(String((data as Record<string, unknown>).model))) {
    const output = (routedData ?? data) as Record<string, unknown>;
    return typeof output.outputText === 'string' && output.outputText.length > 0;
  }
  if (nodeType === 'code-animation') {
    // Only the explicitly routed storyboard is text output, never the draft.
    data = routedData ?? data;
    return Boolean(data && typeof data === 'object' && typeof (data as Record<string, unknown>).outputText === 'string');
  }
  if (!IMAGE_OUTPUT_NODE_TYPES.has(String(nodeType || ''))) return true;
  if (!data || typeof data !== 'object') return false;
  return (data as Record<string, unknown>).imageOnlyOutput === false;
}
