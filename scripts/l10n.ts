// Checks the texts of the extension (see texts.ts): every key that is asked for exists, every text is used, and every
// translation has all texts, with the same values in them.
//
// Usage: bun scripts/l10n.ts [--check]   (--check fails if anything is wrong, as the tests do)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SOURCE_LANGUAGE, codeKeys, languages, manifestKeys, readTexts } from './texts';

const root = path.resolve(import.meta.dirname, '..');
/** The values a text mentions: a translation has to mention the same ones. */
const values = (text: string): string => (text.match(/\{\d+\}/g) ?? []).sort().join();

const english = readTexts(root, SOURCE_LANGUAGE);
const inCode = codeKeys(path.join(root, 'src'));
const inManifest = manifestKeys(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const used = new Set([...inCode, ...inManifest]);
const registry = fs.readFileSync(path.join(root, 'src', 'l10n', 'index.ts'), 'utf8');
const problems: string[] = [];

for (const key of inCode) {
    if (!(key in english)) {
        problems.push(`the code asks for "${key}", which is no text`);
    }
}

for (const key of inManifest) {
    if (!(key in english)) {
        problems.push(`package.json names "%${key}%", which is no text`);
    }
}

for (const key of Object.keys(english)) {
    if (!used.has(key)) {
        problems.push(`nothing uses the text "${key}"`);
    }
}

for (const language of languages(root).filter(language => language !== SOURCE_LANGUAGE)) {
    const file = `l10n/${language}.json`;
    const translation = readTexts(root, language);
    if (!registry.includes(`/l10n/${language}.json'`)) {
        problems.push(`${file} is not imported in src/l10n/index.ts, so the running extension does not know it`);
    }

    for (const [key, text] of Object.entries(english)) {
        const translated = translation[key];
        if (translated === undefined) {
            problems.push(`${file} lacks "${key}"`);
        } else if (values(translated) !== values(text)) {
            problems.push(`${file}: "${key}" has other values than the original`);
        }
    }

    for (const key of Object.keys(translation)) {
        if (!(key in english)) {
            problems.push(`${file} has "${key}", which is no text anymore`);
        }
    }
}

console.log(`${Object.keys(english).length} texts (${inManifest.length} of the manifest) in ${languages(root).length} languages; ${problems.length} problem(s).`);
problems.forEach(problem => console.log(`  ${problem}`));
if (problems.length > 0 && process.argv.includes('--check')) {
    process.exit(1);
}
