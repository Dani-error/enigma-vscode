import type en from '../../l10n/en.json';

/** The name of a text: a key of l10n/en.json, which has every one. Kept apart so that the pages can use it too. */
export type TextKey = keyof typeof en;
