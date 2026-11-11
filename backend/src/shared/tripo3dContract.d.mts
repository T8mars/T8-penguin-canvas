export interface TripoField { type: 'enum' | 'text' | 'integer' | 'number'; default: string | number; options?: string[]; min?: number; max?: number; multiline?: boolean }
export interface TripoRequest { model: string; prompt?: string; images?: string[]; metadata?: Record<string, unknown> }
export function createTripoContract(contract: unknown): {
  models: string[]; fields: Record<string, TripoField>;
  profile(model: string): { id: string; group: string; mode: string };
  isModel(model: string): boolean;
  activeFields(model: string, data?: Record<string, unknown>, imageCount?: number): string[];
  imageRoles(model: string, data?: Record<string, unknown>): (string | null)[];
  partNames(value: unknown): string[];
  faceRange(model: string, data?: Record<string, unknown>): number[];
  isLocalSource(value: unknown): boolean;
  build(request: TripoRequest): { payload: TripoRequest; bindings: { source: string; field: string | null; index?: number; kind: string }[]; model: string; taskType: string };
};
