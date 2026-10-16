// Builds what the editor loads into build/extension: the extension, the pages of its panes, what those pages are
// styled with, and the files of the repository that ship as they are (see layout.ts).
//
// Usage: bun scripts/build.ts [--watch]
//        bun scripts/build.ts --tests    the end-to-end tests instead, into build/extension/test (see tests())
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEVELOPMENT_ONLY, SHIPPED, layout } from './layout';

const root = path.resolve(import.meta.dirname, '..');
const paths = layout(root);
const dist = paths.dist;
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

/**
 * Puts what ships as it is into build/extension, after clearing what an earlier build left there. The engine is kept:
 * Gradle builds it, and it takes a while.
 */
function stage(): void {
    fs.mkdirSync(paths.extension, { recursive: true });
    for (const entry of fs.readdirSync(paths.extension)) {
        if (entry !== 'server') {
            fs.rmSync(path.join(paths.extension, entry), { recursive: true, force: true });
        }
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    DEVELOPMENT_ONLY.forEach(key => delete manifest[key]);
    fs.writeFileSync(path.join(paths.extension, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`);

    const texts = fs.readdirSync(root).filter(file => /^package\.nls(\.[\w-]+)?\.json$/.test(file));
    for (const file of [...SHIPPED, ...texts].filter(file => fs.existsSync(path.join(root, file)))) {
        fs.cpSync(path.join(root, file), path.join(paths.extension, file), { recursive: true });
    }

    // everything in build/extension ships, except the source maps and the tests that help while developing
    fs.writeFileSync(path.join(paths.extension, '.vscodeignore'), '**/*.map\ntest/**\n');
}

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

/**
 * The end-to-end tests: file by file, as their runner picks them up by name. They go inside the extension, because
 * the editor tells extensions apart by where their files are: only there is the "vscode" they get the extension's own,
 * whose messages they answer in its place. They are left out of the package.
 */
function tests(): esbuild.BuildOptions {
    const source = path.join(root, 'test', 'e2e', 'src');
    const out = path.join(paths.extension, 'test', 'e2e');
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

stage();
copyAssets();
if (watch) {
    const contexts = await Promise.all([extension, pages].map(options => esbuild.context(options)));
    await Promise.all(contexts.map(context => context.watch()));
    fs.watch(path.join(root, 'src', 'pages', 'panes.css'), copyAssets);
} else {
    await Promise.all([esbuild.build(extension), esbuild.build(pages)]);
}
