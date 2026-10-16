import * as vscode from 'vscode';
import type { TextKey } from './keys';
import de from './de.json';
import en from './en.json';
import fr from './fr.json';
import ja from './ja.json';
import zhCn from './zh-cn.json';

export type { TextKey };

/** The languages Enigma itself has, by the language code of the editor. */
const TRANSLATIONS: Record<string, Partial<Record<TextKey, string>>> = { de, fr, ja, 'zh-cn': zhCn };

/** The texts of the language of the editor, if it is one of those there are translations for. */
function translations(): Partial<Record<TextKey, string>> {
    const language = vscode.env.language.toLowerCase();
    return TRANSLATIONS[language] ?? TRANSLATIONS[language.split('-')[0]] ?? {};
}

/** A text by its key, without its values put in: for the pages, which do that themselves. */
export function text(key: TextKey): string {
    return translations()[key] ?? en[key];
}

/** Says something to the user in the language of the editor, in English if there is no translation. */
export function t(key: TextKey, ...values: unknown[]): string {
    return text(key).replace(/\{(\d+)}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match);
}
