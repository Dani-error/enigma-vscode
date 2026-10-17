import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ClassTreeNode } from '../../../../src/views/classTree';
import {
    Api,
    activate,
    expectTrouble,
    contextKeys,
    execute,
    fixtures,
    freePort,
    openClass,
    pause,
    Trouble,
    unexpectedTrouble,
    waitFor,
    withStub,
    workspace,
} from './harness';

// Every command, from every place the manifest offers it, in the states the extension can be in: with no jar, with a
// jar, in a class, in its bytecode, with mappings and unsaved changes. A place offers a command when the condition of
// its menu entry holds, which is evaluated here as the editor would. Every question is cancelled; nothing may go wrong,
// and every command has to finish.

interface MenuItem {
    command?: string;
    when?: string;
}

interface Keybinding {
    command: string;
    when?: string;
    args?: unknown;
}

interface Manifest {
    contributes: {
        commands: { command: string }[];
        menus: Record<string, MenuItem[]>;
        keybindings: Keybinding[];
        views: Record<string, { id: string }[]>;
    };
}

type Context = Record<string, unknown>;

/** What the extension sets while it activates, which the tests do not see (see contextKeys). */
const ACTIVATION_KEYS: Context = {
    'enigma.connection': 'not_connected',
    'enigma.analysis.mode': '',
    'enigma.structure.obfuscation': 'all',
    'enigma.structure.documentation': 'all',
    'enigma.structure.sorting': 'default',
};

/**
 * What commands may report, run where they are offered on whatever is there. Marking a name as deobfuscated keeps the
 * name it has, which Enigma refuses where that name clashes with another, as overloads with the same obfuscated name
 * do; its own interface reports that the same way.
 */
const REFUSALS: Record<string, RegExp> = {
    'enigma.toggleMapping': /^Enigma: Name '[^']+' is not unique( in '[^']+')?\.$/,
};

const TOKEN = /\s*(\(|\)|&&|\|\||!(?!=)|[\w.-]+(?:\s*(?:==|!=|=~)\s*(?:'[^']*'|\/(?:\\.|[^/\\])*\/\w*|[^\s()&|]+))?)/y;

/** Whether a condition of the manifest holds: the part of the editor's language for them that the manifest uses. */
export function holds(when: string | undefined, context: Context): boolean {
    if (!when) {
        return true;
    }

    const tokens: string[] = [];
    TOKEN.lastIndex = 0;
    for (let match; TOKEN.lastIndex < when.length && (match = TOKEN.exec(when));) {
        tokens.push(match[1]);
    }

    assert.equal(tokens.join('').replace(/\s/g, ''), when.replace(/\s/g, ''), `the condition "${when}" can be read`);
    const value = (key: string): unknown =>
        key.startsWith('config.') ? vscode.workspace.getConfiguration().get(key.substring('config.'.length)) : context[key];
    let at = 0;
    const term = (): boolean => {
        const token = tokens[at++];
        if (token === '!') {
            return !term();
        }

        if (token === '(') {
            const inner = or();
            assert.equal(tokens[at++], ')', `parentheses close in "${when}"`);
            return inner;
        }

        const comparison = /^([\w.-]+)\s*(==|!=|=~)\s*(.+)$/.exec(token);
        if (!comparison) {
            return !!value(token);
        }

        const [, key, operator, operand] = comparison;
        const raw = value(key);
        const actual = typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? '');
        if (operator === '=~') {
            const regex = /^\/(.*)\/(\w*)$/.exec(operand)!;
            return new RegExp(regex[1], regex[2]).test(actual);
        }

        const equal = actual === operand.replace(/^'(.*)'$/, '$1');
        return operator === '==' ? equal : !equal;
    };
    const and = (): boolean => {
        let result = term();
        while (tokens[at] === '&&') {
            at++;
            result = term() && result;
        }

        return result;
    };
    const or = (): boolean => {
        let result = and();
        while (tokens[at] === '||') {
            at++;
            result = and() || result;
        }

        return result;
    };
    return or();
}

/** Where a command is run from, and what the editor passes it there. */
interface Place {
    name: string;
    context: Context;
    items: { command: string; when?: string; args: unknown[] }[];
    /** Puts things back where the place is before each of its commands, when the stage's own way is not enough. */
    prepare?: () => Promise<unknown>;
}

describe('Enigma in VS Code: every command, from everywhere it is offered', () => {
    let api: Api;
    const manifest = vscode.extensions.getExtension('danibcastro.enigma-vscode')!.packageJSON as Manifest;
    const menus = manifest.contributes.menus;
    const hidden = new Set(menus.commandPalette.filter(item => item.when === 'false').map(item => item.command));
    const views = Object.values(manifest.contributes.views).flatMap(list => list.map(view => view.id));
    const sweepJar = path.join(workspace, 'sweep.jar');
    const sweepMappings = path.join(workspace, 'sweep.mapping');
    /** What was asked and cancelled, and what was run, for the report of a failure. */
    const log: string[] = [];
    let clipboard = '';
    const originals: Record<string, unknown> = {};
    const window = vscode.window as unknown as Record<string, unknown>;

    const palette = (): Place => ({
        name: 'the palette',
        context: {},
        items: manifest.contributes.commands
            .filter(({ command }) => !hidden.has(command))
            .map(({ command }) => ({ command, when: menus.commandPalette.find(item => item.command === command)?.when, args: [] })),
    });
    const viewTitles = (): Place[] =>
        views.map(view => ({
            name: `the title of ${view}`,
            context: { view },
            items: [...menus['view/title'], ...menus['enigma.structure.options']]
                .filter((item): item is MenuItem & { command: string } => item.command !== undefined)
                // the items of the submenu are offered where the submenu is
                .filter(item => menus['view/title'].includes(item) || view === 'enigma.structure')
                .map(item => ({ command: item.command, when: item.when, args: [{ $treeViewId: view }] })),
        }));
    const keys = (context: Context): Place => ({
        name: 'the keys',
        context,
        items: manifest.contributes.keybindings.map(binding => ({
            command: binding.command,
            when: binding.when,
            args: binding.args === undefined ? [] : [binding.args],
        })),
    });

    const contextOf = (place: Place): Context => ({
        ...ACTIVATION_KEYS,
        ...Object.fromEntries(contextKeys),
        isMac: process.platform === 'darwin',
        ...place.context,
    });

    /** Runs a command; what waits for the user and is not one of the questions answered here is dismissed. */
    async function run(command: string, args: unknown[]): Promise<void> {
        let finished = false;
        const done = execute(command, ...args).then(() => {
            finished = true;
        });
        await Promise.race([done, pause(3000)]);
        if (!finished) {
            await execute('workbench.action.closeQuickOpen');
            await Promise.race([done, pause(15000)]);
            assert.ok(finished, `${command} finished`);
        }
    }

    /**
     * Runs what a place offers, one after the other, each when its condition holds at that moment: what ran before
     * changes what is offered, as it would in the menus.
     */
    async function sweep(places: Place[], prepare: () => Promise<void>): Promise<void> {
        for (const place of places) {
            // only what ran can have changed where things are
            let ready = false;
            for (const item of place.items) {
                if (!ready) {
                    await (place.prepare ?? prepare)();
                    ready = true;
                }

                if (!holds(item.when, contextOf(place))) {
                    continue;
                }

                ready = false;

                const before = unexpectedTrouble().length;
                log.push(`${item.command} from ${place.name}`);
                await run(item.command, item.args);
                // what it causes may take a moment
                await pause(60);
                const refused = REFUSALS[item.command];
                const isRefusal = (found: Trouble) => found.where === 'notification' && refused?.test(found.text) === true;
                const trouble = unexpectedTrouble().slice(before);
                if (refused && trouble.some(isRefusal)) {
                    expectTrouble(refused);
                }

                assert.deepEqual(
                    trouble.filter(found => !isRefusal(found)).map(found => `[${found.where}] ${found.text}`),
                    [],
                    `${item.command} from ${place.name} went wrong. Before it:\n  ${log.slice(-8).join('\n  ')}`,
                );
            }
        }
    }

    /** Closes what a command left open for the user to type into, like the search. */
    const dismiss = () => vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    const noJar = async () => {
        await dismiss();
        assert.equal(api.project.isOpen, false, 'nothing that is offered opens a jar when every question is cancelled');
    };
    const jarOpen = async () => {
        await dismiss();
        if (!api.project.isOpen) {
            await api.project.openJar(sweepJar);
            await waitFor('the jar', () => api.project.isOpen && api.index.size > 0);
        }
    };
    const withMappings = async () => {
        await jarOpen();
        if (!api.project.state?.mappingsPath) {
            await api.project.openMappings(sweepMappings);
            await waitFor('the mappings', () => api.project.state?.mappingsPath !== undefined);
        }

        if (!api.project.state?.dirty) {
            await api.editing.rename({ kind: 'class', name: 'b' }, `Renamed${Date.now()}`);
            await waitFor('unsaved changes', () => api.project.state?.dirty);
        }
    };

    /** A class in an editor, with the cursor somewhere in it: on nothing, or on a name of each kind. */
    async function inClass(view: 'source' | 'bytecode', prepare: () => Promise<void>): Promise<Place[]> {
        /** The class in an editor, shown from its tab: documents of tabs closed earlier stay in memory for a while. */
        const shownAt = async (position?: vscode.Position): Promise<vscode.TextEditor> => {
            await prepare();
            const tab = () =>
                vscode.window.tabGroups.all
                    .flatMap(group => group.tabs)
                    .map(candidate => (candidate.input instanceof vscode.TabInputText ? candidate.input.uri : undefined))
                    .find(uri => uri?.scheme === 'enigma' && uri.query === `class=e&view=${view}`);
            if (!tab()) {
                // like clicking into the code: what ran before may have left the focus in a panel, like the log's
                await execute('workbench.action.closePanel');
                await execute('workbench.action.focusActiveEditorGroup');
                await openClass(api, 'e');
                if (view === 'bytecode') {
                    await execute('enigma.showBytecode');
                }
            }

            const shown = await vscode.window.showTextDocument(await waitFor(`the ${view} of e`, tab), { preview: false });
            await waitFor(`the text of the ${view}`, () => api.documents.source(shown.document.uri) && shown.document.getText().length > 0);
            if (position) {
                shown.selection = new vscode.Selection(position, position);
                await execute('workbench.action.focusActiveEditorGroup');
            }

            return shown;
        };
        const loaded = api.documents.source((await shownAt()).document.uri)!;
        const positions = [new vscode.Position(0, 0)];
        const kinds = new Set<string>();
        for (const [line, character, , group] of loaded.refs) {
            const kind = loaded.groups[group]?.kind;
            if (kind !== undefined && !kinds.has(kind)) {
                kinds.add(kind);
                positions.push(new vscode.Position(line, character + 1));
            }
        }

        const places: Place[] = [];
        for (const position of positions) {
            const at = `${view} at ${position.line}:${position.character}`;
            const editorOf = () => shownAt(position);
            const shown = await editorOf();
            const resource = shown.document.uri;
            const context = {
                resourceScheme: resource.scheme,
                resourceExtname: path.extname(resource.path),
                editorLangId: shown.document.languageId,
            };
            const located = (place: Place): Place => ({ ...place, name: `${place.name}, in the ${at}`, prepare: editorOf });
            places.push(
                located(keys({ ...context, editorTextFocus: true })),
                located({ ...palette(), context }),
                located({
                    name: 'the menu of the editor',
                    context,
                    items: menus['editor/context'].map(item => ({ command: item.command!, when: item.when, args: [resource] })),
                }),
                located({
                    name: 'the title of the editor',
                    context,
                    items: menus['editor/title'].map(item => ({
                        command: item.command!,
                        when: item.when,
                        args: [resource, { groupId: 1, editorIndex: 0 }],
                    })),
                }),
                // twice: the first time starts renaming, after which other keys are offered
                located(keys({ ...context, editorTextFocus: true })),
            );
        }

        return places;
    }

    async function sweepInClass(view: 'source' | 'bytecode', prepare: () => Promise<void>): Promise<void> {
        await sweep(await inClass(view, prepare), prepare);
        await execute('enigma.inlineRename.cancel');
    }

    before(async () => {
        api = await activate();
        fs.copyFileSync(path.join(fixtures, 'inheritance_tree.jar'), sweepJar);
        fs.writeFileSync(sweepMappings, 'CLASS a BaseClass\n');
        // on a port of its own: another window may have the default one
        await vscode.workspace.getConfiguration('enigma').update('mcp.port', await freePort(), vscode.ConfigurationTarget.Global);
        clipboard = await vscode.env.clipboard.readText();
        const ask =
            (kind: string, value: unknown = undefined) =>
            (question: unknown) => {
                log.push(`  ${kind}: ${typeof question === 'string' ? question : JSON.stringify(question)?.substring(0, 120)}`);
                return Promise.resolve(value);
            };
        const questions = {
            showInputBox: ask('input'),
            showQuickPick: (_items: unknown, options: unknown) => ask('pick')(options),
            showOpenDialog: ask('open'),
            showSaveDialog: ask('save'),
            showWarningMessage: ask('warning'),
            showInformationMessage: ask('information'),
        };
        for (const [name, stand] of Object.entries(questions)) {
            originals[name] = window[name];
            window[name] = stand;
        }
    });

    after(async () => {
        Object.assign(window, originals);
        await vscode.env.clipboard.writeText(clipboard);
        const configuration = vscode.workspace.getConfiguration('enigma');
        for (const key of ['mcp.port', 'mcp.enabled', 'classTree.mode', 'decompiler', 'java.home']) {
            await configuration.update(key, undefined, vscode.ConfigurationTarget.Global);
            if (configuration.inspect(key)?.workspaceValue !== undefined) {
                await configuration.update(key, undefined, vscode.ConfigurationTarget.Workspace);
            }
        }

        if (api.project.isOpen) {
            window.showWarningMessage = () => Promise.resolve("Don't Save");
            await api.project.closeJar();
            Object.assign(window, originals);
        }
    });

    it('with no jar open: the palette, the titles of the views and the keys', async () => {
        assert.equal(api.project.isOpen, false);
        await sweep([palette(), ...viewTitles(), keys({})], noJar);
    });

    it('opens a jar from the explorer and from the title of its tab', async () => {
        const uri = vscode.Uri.file(sweepJar);
        const offered = (menu: string) =>
            menus[menu].filter(item =>
                holds(item.when, { resourceExtname: '.jar', resourceScheme: 'file', explorerResourceIsFolder: false }),
            );
        assert.deepEqual(
            offered('explorer/context').map(item => item.command),
            ['enigma.openJarFile'],
        );
        await run('enigma.openJarFile', [uri, [uri]]);
        await waitFor('the jar', () => api.project.isOpen && api.index.size > 0);
        assert.deepEqual(
            offered('editor/title/context').map(item => item.command),
            ['enigma.openJarFile'],
        );
        // the same jar again
        await run('enigma.openJarFile', [uri, { groupId: 1, editorIndex: 0 }]);
        assert.ok(api.project.isOpen);
    });

    it('with a jar open: the palette, the titles of the views and the keys', async () => {
        await sweep([palette(), ...viewTitles(), keys({})], jarOpen);
    });

    it('with a jar open: the menus of every class and package in the class trees', async function () {
        this.timeout(600000);
        await jarOpen();
        for (const mode of ['all', 'obfuscated', 'deobfuscated'] as const) {
            const view = `enigma.classes.${mode}`;
            const tree = api.classTrees[mode];
            const nodes = (parent?: ClassTreeNode): ClassTreeNode[] => {
                const children = tree.getChildren(parent);
                return [...children, ...children.flatMap(child => nodes(child))];
            };
            for (const node of nodes()) {
                const item = tree.getTreeItem(node);
                await sweep(
                    [
                        {
                            name: `the menu of ${String(item.label instanceof Object ? item.label.label : item.label)} in ${view}`,
                            context: { view, viewItem: item.contextValue },
                            items: menus['view/item/context'].map(entry => ({ command: entry.command!, when: entry.when, args: [node] })),
                        },
                    ],
                    jarOpen,
                );
            }
        }
    });

    it('with a jar open: a class in the editor, with the cursor on nothing and on a name of each kind', async function () {
        this.timeout(600000);
        await sweepInClass('source', jarOpen);
    });

    it('with a jar open: the bytecode of a class in the editor', async function () {
        this.timeout(600000);
        await sweepInClass('bytecode', jarOpen);
    });

    it('with mappings and unsaved changes: the palette, the titles of the views and the keys', async () => {
        await sweep([palette(), ...viewTitles(), keys({})], withMappings);
    });

    it('with mappings and unsaved changes: a class in the editor', async function () {
        this.timeout(600000);
        await sweepInClass('source', withMappings);
    });

    it('names the tabs of open classes after mappings that replace all others', async () => {
        // as when they are opened here, or arrive from the host of a session: which classes changed is not said
        await jarOpen();
        await execute('workbench.action.closeAllEditors');
        const opened = await openClass(api, 'e');
        const tabOf = () =>
            vscode.window.tabGroups.all
                .flatMap(group => group.tabs)
                .find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.query === opened.document.uri.query);
        const replacement = path.join(workspace, 'replacement.mapping');
        fs.writeFileSync(replacement, 'CLASS e TabRenamed\n');
        await withStub(
            vscode.window,
            'showWarningMessage',
            () => Promise.resolve("Don't Save"),
            () => api.project.openMappings(replacement),
        );
        await waitFor('the tab to have the new name', () => tabOf()?.label === 'TabRenamed.java');
    });
});
