export function forwardSeedance25Draft(sources: Record<string, any>[], visibleVideos?: string[]) {
  const candidates = sources.filter(data => data.seedance25DraftTaskIdResult && /^seedance-2\.5-(global-)?standard-(t2v|i2v|multi)$/.test(data.seedance25DraftSourceModel || '')
    && (!visibleVideos || visibleVideos.includes(data.videoUrl)));
  const ids = [...new Set(candidates.map(data => data.seedance25DraftTaskIdResult))];
  const source = ids.length === 1 ? candidates[0] : undefined;
  return { seedance25DraftTaskIdResult: source?.seedance25DraftTaskIdResult || '', seedance25DraftSourceModel: source?.seedance25DraftSourceModel || '' };
}
