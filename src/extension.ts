import * as vscode from 'vscode';

/** What the extension exposes to its integration tests. */
export interface EnigmaApi {

}

let shutdown: (() => Promise<void>) | undefined;

/** Puts the extension together: nothing here decides anything, it only says what works with what. */
export async function activate(context: vscode.ExtensionContext): Promise<EnigmaApi> {
    return { };
}

export async function deactivate(): Promise<void> {
    await shutdown?.();
}
