import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { TextKey, text } from '../l10n';
import pageKeys from '../l10n/pageKeys.json';
import { Problem } from './messages';

/** The pages there are, by the name of their script. */
export type PageName = 'entry' | 'collab' | 'stats';

/**
 * The texts of the pages in the language of the editor, by their keys. The pages run in a browser and cannot ask
 * the editor: pageKeys.json lists the keys they use ("bun run l10n" writes it), and each page is handed the texts
 * for them when it is made.
 */
function pageTexts(): Record<string, string> {
    return Object.fromEntries((pageKeys as TextKey[]).map(key => [key, text(key)]));
}

export function page(webview: vscode.Webview, extensionUri: vscode.Uri, name: PageName, title: string): string {
    const built = (...file: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', ...file));
    const nonce = crypto.randomBytes(16).toString('base64');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="stylesheet" href="${built('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${built('pages', 'panes.css')}">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.L10N = ${JSON.stringify(pageTexts()).replace(/</g, '\\u003c')};</script>
<script nonce="${nonce}" src="${built('pages', `${name}.js`)}"></script>
</body>
</html>`;
}

export const webviewOptions = (extensionUri: vscode.Uri): vscode.WebviewOptions => {
    return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')] };
}

export const problemOf = (error: unknown): Problem => {
    return { severity: 'error', message: error instanceof Error ? error.message : String(error) };
}
