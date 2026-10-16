// Packages build/extension into build/<name>-<version>.vsix.
//
// Usage: bun scripts/package.ts   (after bun run build:backend and bun run build; "bun run package" does all three)
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { layout } from './layout';

const paths = layout(path.resolve(import.meta.dirname, '..'));
const manifest = JSON.parse(fs.readFileSync(path.join(paths.extension, 'package.json'), 'utf8')) as { name: string; version: string };

for (const [file, hint] of [[path.join(paths.dist, 'extension.js'), 'bun run build'], [paths.serverJar, 'bun run build:backend']] as const) {
    if (!fs.existsSync(file)) {
        console.error(`${path.relative(paths.root, file)} is missing. Run "${hint}" first.`);
        process.exit(1);
    }
}

const vsix = path.join(paths.build, `${manifest.name}-${manifest.version}.vsix`);
const vsce = path.join(paths.root, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');
const result = spawnSync(vsce, ['package', '--no-dependencies', '--allow-missing-repository', '--no-rewrite-relative-links', '--out', vsix], {
    cwd: paths.extension,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
