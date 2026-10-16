// Builds what the editor loads: the extension, the pages of its panes, and what those pages are styled with.
//
// Usage: bun scripts/build.ts [--watch]
//        bun scripts/build.ts --tests    the end-to-end tests instead, which the editor loads as JavaScript too
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

/** The extension itself, which runs in the editor's extension host. */
const extension: esbuild.BuildOptions = {
    entryPoints: [path.join(root, 'src', 'extension.ts')],
    outfile: path.join(dist, 'extension.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    sourcemap: true,
    logLevel: 'info',
};

/** The pages of the panes, which run in web views: one script each, with what they share bundled into it. */
const pages: esbuild.BuildOptions = {
    entryPoints: ['entry', 'collab', 'stats'].map(page => path.join(root, 'src', 'pages', `${page}.ts`)),
    outdir: path.join(dist, 'pages'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: !watch,
    logLevel: 'info',
};

/** What is shipped as it is: the style sheet of the pages, and the icon font of the editor from its own package. */
function copyAssets(): void {
    const codicons = path.join(root, 'node_modules', '@vscode', 'codicons', 'dist');
    fs.mkdirSync(path.join(dist, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(dist, 'codicons'), { recursive: true });
    fs.copyFileSync(path.join(root, 'src', 'pages', 'panes.css'), path.join(dist, 'pages', 'panes.css'));
    for (const file of ['codicon.css', 'codicon.ttf']) {
        fs.copyFileSync(path.join(codicons, file), path.join(dist, 'codicons', file));
    }
}

/** The end-to-end tests: file by file, as their runner picks them up by name. */
function tests(): esbuild.BuildOptions {
    const source = path.join(root, 'test', 'e2e', 'src');
    const out = path.join(root, 'test', 'e2e', 'out');
    fs.rmSync(out, { recursive: true, force: true });
    return {
        entryPoints: fs.readdirSync(source, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.ts')).map(file => path.join(source, file)),
        outdir: out,
        outbase: source,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        sourcemap: true,
        logLevel: 'warning',
    };
}

if (process.argv.includes('--tests')) {
    await esbuild.build(tests());
    process.exit(0);
}

copyAssets();
if (watch) {
    const contexts = await Promise.all([extension, pages].map(options => esbuild.context(options)));
    await Promise.all(contexts.map(context => context.watch()));
    fs.watch(path.join(root, 'src', 'pages', 'panes.css'), copyAssets);
} else {
    await Promise.all([esbuild.build(extension), esbuild.build(pages)]);
}
