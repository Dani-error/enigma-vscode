import type { TextKey } from './keys';

/** Put in by the build (scripts/build.ts): the keys of the texts the code of the pages asks for, as JSON. */
declare const ENIGMA_PAGE_KEYS: string;

/**
 * The texts each page is handed when it is made, in the language of the editor. The pages run in a browser and
 * cannot ask the editor for them.
 */
export const pageKeys = JSON.parse(ENIGMA_PAGE_KEYS) as readonly TextKey[];
