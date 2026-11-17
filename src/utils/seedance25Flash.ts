import contract from '../../backend/src/shared/seedance25FlashContract.json';
import { createSeedance25FlashContract } from '../../backend/src/shared/seedance25FlashContract.mjs';
export const SD25_FLASH = createSeedance25FlashContract(contract);
export const seedance25Limits = (model: string) => SD25_FLASH.isFlash(model) ? contract.limits : {images:30,videos:10,audios:10,total:50};
