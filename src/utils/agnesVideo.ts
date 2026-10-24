import contract from '../../backend/src/shared/agnesVideoContract.json';
export const AGNES_VIDEO = contract;
export function agnesVideoModel(model: string) {
  return model === contract.retiredModel ? contract.models[0] : model;
}
