// Writes the tools of src/ai/catalog.ts into package.json, where the editor wants them declared for its chat.
//
// Usage: bun scripts/sync-ai-tools.ts [--check]   (--check only says whether they are the same, as the tests do)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { manifestTools } from '../src/ai/catalog';

interface Manifest {
    contributes: { languageModelTools?: unknown };
}

const file = path.resolve(import.meta.dirname, '..', 'package.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
const wanted = manifestTools();

if (JSON.stringify(manifest.contributes.languageModelTools) === JSON.stringify(wanted)) {
    console.log('package.json declares the tools of src/ai/catalog.ts.');
} else if (process.argv.includes('--check')) {
    console.error('package.json does not declare the tools as src/ai/catalog.ts describes them. Run "bun run sync:ai".');
    process.exit(1);
} else {
    manifest.contributes.languageModelTools = wanted;
    fs.writeFileSync(file, `${JSON.stringify(manifest, undefined, 2)}\n`);
    console.log(`Wrote ${wanted.length} tools to package.json.`);
}
