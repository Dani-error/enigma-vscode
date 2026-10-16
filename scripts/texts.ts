import * as fs from 'node:fs';
import * as path from 'node:path';

// The texts of the extension, as the build and the checks see them. Every language has one file in <root>/l10n,
// named by the language code of the editor: en.json has every text, the others translate them. Two kinds of text
// share those files: what the code says while running, asked for with t('key'), and what the editor reads from the
// manifest before the extension runs (commands, views, settings), named in package.json as "%key%". The build
// writes the second kind into the package.nls*.json files the editor expects next to package.json.

export type Texts = Record<string, string>;

/** The language every text exists in, and the one the editor falls back on. */
export const SOURCE_LANGUAGE = 'en';

export const textsDirectory = (root: string) => path.join(root, 'l10n');

/** The languages there are texts for, the source language first. */
export function languages(root: string): string[] {
    const found = fs.readdirSync(textsDirectory(root)).filter(file => file.endsWith('.json')).map(file => file.slice(0, -'.json'.length));
    return [SOURCE_LANGUAGE, ...found.filter(language => language !== SOURCE_LANGUAGE).sort()];
}

export function readTexts(root: string, language: string): Texts {
    return JSON.parse(fs.readFileSync(path.join(textsDirectory(root), `${language}.json`), 'utf8')) as Texts;
}

/** The keys of the texts a manifest names, as "%key%". */
export function manifestKeys(manifest: string): string[] {
    return [...new Set([...manifest.matchAll(/"%([\w.-]+)%"/g)].flatMap(match => match[1] ?? []))];
}

/** The keys of the texts the TypeScript files in a directory ask for with t('key'). */
export function codeKeys(directory: string): string[] {
    const files = fs.readdirSync(directory, { withFileTypes: true, recursive: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.ts')).map(entry => path.join(entry.parentPath, entry.name));
    return [...new Set(files.flatMap(file => [...fs.readFileSync(file, 'utf8').matchAll(/(?<![\w.])t\('([\w.-]+)'/g)].flatMap(match => match[1] ?? [])))];
}

/** The texts of the manifest in one language, as the editor wants them in package.nls[.language].json. */
export function manifestTexts(texts: Texts, keys: string[]): Texts {
    return Object.fromEntries(keys.filter(key => key in texts).map(key => [key, texts[key]!]));
}
