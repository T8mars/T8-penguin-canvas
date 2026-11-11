export function createSeedream55DraftContract(contract: any): {
  buildImage(request: any): { model: string; prompt?: string; images?: string[]; metadata: Record<string, any> };
  buildDraft(request: any): { model: string; metadata: Record<string, any> };
  draftId(value: any): string; isImage(model: string): boolean; isDraft(model: string): boolean;
};
