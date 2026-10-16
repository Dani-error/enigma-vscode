import * as path from 'node:path';

/**
 * Where the build puts what it makes, under <root>/build:
 *
 *   build/extension/                the extension exactly as it ships, and what the editor loads while developing
 *     package.json, LICENSE, ...    copied from the repository (see SHIPPED)
 *     package.nls*.json             the texts of the manifest, from l10n/ (see texts.ts)
 *     dist/                         the bundled extension and the pages of its panes (scripts/build.ts)
 *     server/enigma-backend.jar     the engine (npm run build:backend)
 *   build/<name>-<version>.vsix     the packaged extension (npm run package)
 */
export const layout = (root: string) => {
    const build = path.join(root, 'build');
    const extension = path.join(build, 'extension');
    return {
        root,
        build,
        extension,
        dist: path.join(extension, 'dist'),
        serverJar: path.join(extension, 'server', 'enigma-backend.jar'),
    };
};

/** What of the repository ships as it is, next to what is built. Files that do not exist are left out. */
export const SHIPPED = ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'language-configuration.json', 'syntaxes', 'resources'];

/**
 * Parts of package.json that are about developing the extension, not running it. "type" makes the scripts and tests
 * ES modules; the bundled extension is CommonJS.
 */
export const DEVELOPMENT_ONLY = ['scripts', 'devDependencies', 'type'];
