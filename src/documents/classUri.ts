import * as vscode from 'vscode';
import { TokenRange, View } from "../engine/protocol";

// How the classes of a jar are addressed in the editor: enigma:/test.jar!/com/example/Name.java?class=<obfuscated>

export const SCHEME = 'enigma';

export interface ClassDocument {
    /** Obfuscated name of the top-level class. */
    class: string;
    view: View;
}

export function toRange(range: TokenRange): vscode.Range {
    return new vscode.Range(range[0], range[1], range[0], range[1] + range[2]);
}

export function parseClassUri(uri: vscode.Uri): ClassDocument | undefined {
    if (uri.scheme !== SCHEME) {
        return undefined;
    }

    const params = new URLSearchParams(uri.query);
    const name = params.get('class');
    if (!name) {
        return undefined;
    }

    return { class: name, view: params.get('view') === 'bytecode' ? 'bytecode' : 'source' };
}