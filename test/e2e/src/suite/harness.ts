import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { EnigmaApi } from '../../../../src/extension';
import type { EntryRef } from '../../../../src/engine/protocol';
import type { ClassTreeNode } from '../../../../src/views/classTree';

// End-to-end tests of the extension inside VS Code, on a jar obfuscated by Enigma's own build.
// In inheritance_tree.jar: a = BaseClass (a()V = doBaseThings, a()Ljava/lang/String; = getName, field a = name),
// c = SubclassA, d = SubclassB (overrides doBaseThings), e = SubsubclassAA (overrides both, calls super.getName() and
// this.getName()).

export interface PaneEntry {
    key: string;
    displayName: string;
    name: string;
    renamable: boolean;
    javadoc: string;
    state: string;
    kindLabel: string;
}

/** What the extension exposes to these tests. */
export type Api = EnigmaApi;

export const workspace = process.env.ENIGMA_E2E_WORKSPACE!;
/** The jars Enigma's own build obfuscates for its tests. */
export const fixtures = process.env.ENIGMA_E2E_FIXTURES!;
export const jar = path.join(workspace, 'inheritance_tree.jar');
export const mappings = path.join(workspace, 'test.mapping');

export const METHOD_DO_BASE_THINGS: EntryRef = { kind: 'method', owner: 'a', name: 'a', desc: '()V' };
export const METHOD_GET_NAME: EntryRef = { kind: 'method', owner: 'a', name: 'a', desc: '()Ljava/lang/String;' };

/** Error and warning notifications the extension showed. They are invisible to a test otherwise. */
declare global {
    /** What the extension logged at debug level, for the runner to print when a test fails (see index.ts). */
    var enigmaTestTrace: string[] | undefined;
}

/** An item of a quick pick the extension offers, with what the extension puts next to the editor's own fields. */
export interface Offered extends vscode.QuickPickItem {
    id?: string;
    home?: string;
    format?: { id: string; directory?: boolean };
}

export const reported: string[] = [];
/** What the extension logged at debug level; printed when a test times out. */
export const trace: string[] = [];
globalThis.enigmaTestTrace = trace;

/** The class a node of a class tree stands for, if it is one. */
export const classOf = (node: ClassTreeNode | undefined) => (node?.type === 'class' ? node.item.obf : undefined);

export const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function waitFor<T>(
    what: string,
    condition: () => T | undefined | false | Promise<T | undefined | false>,
    timeout = 30000,
): Promise<T> {
    const deadline = Date.now() + timeout;
    for (;;) {
        const value = await condition();
        if (value) {
            return value;
        }

        if (Date.now() > deadline) {
            const active = vscode.window.activeTextEditor;
            throw new Error(
                `Timed out waiting for ${what}` +
                    (reported.length > 0 ? `. Errors shown to the user: ${reported.join(' | ')}` : '') +
                    (active
                        ? `\n--- ${active.document.uri.path} (dirty: ${active.document.isDirty}) ---\n${active.document.getText()}`
                        : '') +
                    `\n--- log (window focused: ${vscode.window.state.focused}) ---\n${trace.slice(-40).join('\n')}`,
            );
        }

        await pause(40);
    }
}

/** Runs a command of the editor. Its commands return thenables, which node's assertions do not accept. */
export function execute<T = unknown>(command: string, ...args: unknown[]): Promise<T> {
    if (command !== 'type') {
        trace.push(`${new Date().toISOString().substring(17, 23)} [test] ${command}`);
    }

    return Promise.resolve(vscode.commands.executeCommand<T>(command, ...args));
}

/** Replaces a function of the vscode API for the duration of an action: dialogs cannot be answered in tests. */
export async function withStub<T>(
    target: object,
    name: string,
    replacement: (...args: never[]) => unknown,
    action: () => Promise<T>,
): Promise<T> {
    // the API is a plain object of functions, and the stand-in takes the place of one of them
    const holder = target as Record<string, unknown>;
    const original = holder[name];
    holder[name] = replacement;
    try {
        return await action();
    } finally {
        holder[name] = original;
    }
}

export function positionOf(document: vscode.TextDocument, text: string, offsetInText = 0): vscode.Position {
    const index = document.getText().indexOf(text);
    assert.notEqual(index, -1, `"${text}" not found in ${document.uri.path}:\n${document.getText()}`);
    return document.positionAt(index + offsetInText);
}

export async function openClass(api: Api, obf: string): Promise<vscode.TextEditor> {
    await execute('enigma.openClass', obf);
    const editor = await waitFor(`editor of ${obf}`, () => {
        const active = vscode.window.activeTextEditor;
        return active && active.document.uri.scheme === 'enigma' && active.document.uri.query === `class=${obf}&view=source`
            ? active
            : undefined;
    });
    await waitFor(`source of ${obf}`, () => api.documents.source(editor.document.uri) && editor.document.getText().includes('class '));
    // Classes open as preview tabs, which the next class opened would replace. The tests look at several at once.
    await execute('workbench.action.keepEditor');
    return editor;
}

/**
 * The document of a class that is open in a tab. After a class was renamed, the editor keeps the document of its old
 * address in memory for a while; that one is no longer shown and must not be picked.
 */
export function classDocument(obf: string, view = 'source'): vscode.TextDocument {
    const open = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .map(tab => (tab.input instanceof vscode.TabInputText ? tab.input.uri : undefined))
        .filter((uri): uri is vscode.Uri => uri?.scheme === 'enigma' && uri.query === `class=${obf}&view=${view}`)
        .map(uri => uri.toString());
    const found = vscode.workspace.textDocuments.find(document => open.includes(document.uri.toString()));
    if (!found) {
        const tabs = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .map(tab => `${tab.label}[${tab.input instanceof vscode.TabInputText ? tab.input.uri.toString(true) : '?'}]`);
        throw new Error(`No open document for class ${obf} (${view}). Tabs: ${tabs.join(', ') || 'none'}`);
    }

    return found;
}

/**
 * Whether keys reach the editor. They only do while the window of the editor has the keyboard focus of the operating
 * system, which a test cannot ask for: someone using the machine in the meantime has it.
 */
let keyboard = true;

async function changed(document: vscode.TextDocument, version: number, timeout: number): Promise<boolean> {
    for (const deadline = Date.now() + timeout; document.version === version;) {
        if (Date.now() > deadline) {
            return false;
        }

        await pause(10);
    }

    return true;
}

/** Presses a key in an editor. Without the keyboard, the same change is made through the API. */
async function press(editor: vscode.TextEditor, character: string): Promise<void> {
    const version = editor.document.version;
    if (keyboard) {
        await vscode.commands.executeCommand('type', { text: character });
        if (await changed(editor.document, version, 600)) {
            return;
        }

        keyboard = false;
        trace.push(
            '[test] keys do not reach the editor: its window does not have the keyboard focus. Typing through the API from here on.',
        );
    }

    for (let attempt = 0; ; attempt++) {
        const selection = editor.selection;
        // refused when something else changed the document in the same moment, as when the editor mirrors a key
        if (await editor.edit(builder => builder.replace(selection, character), { undoStopBefore: false, undoStopAfter: false })) {
            const after = selection.start.translate(0, character.length);
            editor.selection = new vscode.Selection(after, after);
            return;
        }

        assert.ok(attempt < 20, `could not type "${character}" into ${editor.document.uri.path}`);
        await pause(20);
    }
}

/** Types like a person would: one key after another, a moment after placing the cursor. */
async function type(editor: vscode.TextEditor, selection: vscode.Selection, text: string): Promise<void> {
    // like clicking into the code: earlier tests may have left the keyboard focus in one of the views
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    editor.selection = selection;
    // the editor looks up the other occurrences of a name shortly after the cursor arrives on it
    await pause(300);
    for (const character of text) {
        await press(editor, character);
    }
}

/** Puts the cursor into the first occurrence of some text and types there. */
export function typeAt(editor: vscode.TextEditor, anchor: string, offsetInAnchor: number, text: string): Promise<void> {
    const position = positionOf(editor.document, anchor, offsetInAnchor);
    return type(editor, new vscode.Selection(position, position), text);
}

/** Selects a name, like a double click, and types over it. */
export function typeOver(editor: vscode.TextEditor, anchor: string, offsetInAnchor: number, name: string, text: string): Promise<void> {
    const start = positionOf(editor.document, anchor, offsetInAnchor);
    return type(editor, new vscode.Selection(start, start.translate(0, name.length)), text);
}

/** Whether the method that class e declares, calls on super and calls on this shows the given name everywhere. */
export const everywhere = (document: vscode.TextDocument, name: string) =>
    [`String ${name}()`, `super.${name}()`, `this.${name}()`].every(use => document.getText().includes(use));

/** Leaves a picture of the window in the folder ENIGMA_E2E_SCREENSHOTS, if the tests were started with it. */
export async function screenshot(name: string): Promise<void> {
    const directory = process.env.ENIGMA_E2E_SCREENSHOTS;
    if (!directory) {
        return;
    }

    // what earlier tests provoked on purpose is not part of the picture
    await vscode.commands.executeCommand('notifications.clearAll');
    // let the window finish drawing
    await pause(700);
    const request = path.join(directory, `${name}.request`);
    fs.writeFileSync(request, '');
    await waitFor(`the screenshot "${name}"`, () => !fs.existsSync(request), 20000);
}

export const entryInfo = (api: Api, entry: EntryRef) => api.backend.request('entry/info', { entry });

export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            server.close(() => resolve(port));
        });
    });
}

let activated: Promise<Api> | undefined;

/**
 * The extension, with what it logs and the errors it shows collected for the reports of failing tests. Every file of
 * the suite asks for it; they run in the order of their names, in one window, and build on each other.
 */
export function activate(): Promise<Api> {
    activated ??= (async () => {
        const extension = vscode.extensions.getExtension<Api>('danibcastro.enigma-vscode');
        assert.ok(extension, 'the extension is installed');
        const api = await extension.activate();

        const output = api.backend.output;
        const debug = output.debug.bind(output);
        output.debug = (message: string, ...rest: unknown[]) => {
            trace.push(`${new Date().toISOString().substring(17, 23)} ${message}`);
            debug(message, ...rest);
        };

        const showError = vscode.window.showErrorMessage;
        (vscode.window as unknown as Record<string, unknown>).showErrorMessage = (message: string, ...rest: unknown[]) => {
            reported.push(message);
            // the original, with whatever the extension passed: messages, options and buttons
            return Reflect.apply(showError, vscode.window, [message, ...rest]) as Thenable<unknown>;
        };

        return api;
    })();
    return activated;
}
