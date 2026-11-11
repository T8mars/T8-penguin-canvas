/** Forward native identity only with the exact visible model. Multiple native
 * tasks remain ambiguous rather than silently selecting one for a paid call. */
export function tripoForwardData(sources: Record<string, any>[], visibleModels?: string[]) {
  const candidates = sources.filter(source => source.tripoTaskId || Array.isArray(source.tripoFiles));
  const models = [...new Set(candidates.flatMap(source => source.modelUrl ? [source.modelUrl] : source.modelUrls || []))]
    .filter(url => !visibleModels || visibleModels.includes(url));
  const matched = candidates.filter(source => models.includes(source.modelUrl || source.modelUrls?.[0]));
  const ids = [...new Set(matched.map(source => source.tripoTaskId).filter(Boolean))];
  const source = models.length === 1 && ids.length === 1 ? matched.find(source => source.tripoTaskId === ids[0]) : undefined;
  return { modelUrl: models[0], modelUrls: models.length ? models : undefined,
    tripoTaskId: source?.tripoTaskId || '', tripoPartNames: source?.tripoPartNames || [], tripoFiles: source?.tripoFiles || [] };
}
