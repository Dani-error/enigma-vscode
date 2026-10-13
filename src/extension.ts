import * as vscode from 'vscode';
import { Backend } from './engine/backend';
import { Enigma } from "./enigma";
import { discoverInstallations, JavaRuntime, MINIMUM_JAVA } from "./engine/java";
import { useIcons } from "./kinds";

/** What the extension exposes to its integration tests. */
export interface EnigmaApi {
    backend: Backend;
    /** Installed Java runtimes that can run the engine. */
    javaInstallations(): JavaRuntime[];
}

let shutdown: (() => Promise<void>) | undefined;

/** Puts the extension together: nothing here decides anything, it only says what works with what. */
export async function activate(context: vscode.ExtensionContext): Promise<EnigmaApi> {
    const output = vscode.window.createOutputChannel('Enigma', { log: true });
    useIcons(vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons'));
    const backend = new Backend(context, output);

    context.subscriptions.push(
        output, backend
    )

    // @ts-ignore
    const enigma: Enigma = {
        context, output, backend
    };

    shutdown = async () => {
        await backend.stop();
    };

    return {
        backend,
        javaInstallations: () => discoverInstallations().filter(installation => installation.version >= MINIMUM_JAVA),
    };
}

export async function deactivate(): Promise<void> {
    await shutdown?.();
}
