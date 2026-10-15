// Checks what the extension says against its texts, and tells the pages which ones they use.
//
// Texts have names: src/l10n/en.json has every one, the other files there translate them, and the code asks for them
// by key, t('project.reopen'). This lists keys that are asked for but do not exist, texts nothing asks for, and what
// each translation lacks; and it writes src/l10n/pageKeys.json, the keys the pages use (see src/panes/webview.ts).
//
// Usage: bun scripts/l10n.ts [--check]   (--check fails if anything is wrong, and writes nothing)
import * as fs from 'node:fs';
import * as path from 'node:path';

type Texts = Record<string, string>;

const root = path.resolve(import.meta.dirname, '..');
const texts = path.join(root, 'src', 'l10n');
const pages = path.join(root, 'src', 'pages');
/** The file that lists the keys of the pages; a list, unlike the files next to it. */
const PAGE_KEYS = 'pageKeys.json';
const check = process.argv.includes('--check');

const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
const sources = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts')).map(entry => path.join(entry.parentPath, entry.name));
const keysIn = (file: string): string[] => [...fs.readFileSync(file, 'utf8').matchAll(/(?<![\w.])t\('([\w.-]+)'/g)].flatMap(match => match[1] ?? []);
/** The values a text mentions: a translation has to mention the same ones. */
const values = (text: string): string => (text.match(/\{\d+\}/g) ?? []).sort().join();

const english = read<Texts>(path.join(texts, 'en.json'));
const used = new Set(sources(path.join(root, 'src')).flatMap(keysIn));
const pageKeys = [...new Set(sources(pages).flatMap(keysIn))].sort();
const problems: string[] = [];

const written = `${JSON.stringify(pageKeys, undefined, '\t')}\n`;
if (!check) {
    fs.writeFileSync(path.join(texts, PAGE_KEYS), written);
} else if (fs.readFileSync(path.join(texts, PAGE_KEYS), 'utf8') !== written) {
    problems.push(`${PAGE_KEYS} does not list the texts the pages use: run "bun run l10n"`);
}

for (const key of used) {
    if (!(key in english)) {
        problems.push(`there is no text "${key}"`);
    }
}

for (const key of Object.keys(english)) {
    if (!used.has(key)) {
        problems.push(`nothing uses the text "${key}"`);
    }
}

for (const file of fs.readdirSync(texts).filter(name => name.endsWith('.json') && name !== 'en.json' && name !== PAGE_KEYS)) {
    const translation = read<Texts>(path.join(texts, file));
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

console.log(`${Object.keys(english).length} texts, ${pageKeys.length} of them in the pages; ${problems.length} problem(s).`);
problems.forEach(problem => console.log(`  ${problem}`));
if (problems.length > 0 && check) {
    process.exit(1);
}
