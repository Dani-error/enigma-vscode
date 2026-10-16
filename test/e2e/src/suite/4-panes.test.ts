import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { EntryRef } from '../../../../src/engine/protocol';
import {
    Api,
    classOf,
    METHOD_DO_BASE_THINGS,
    activate,
    classDocument,
    entryInfo,
    everywhere,
    execute,
    openClass,
    pause,
    positionOf,
    screenshot,
    typeAt,
    typeOver,
    waitFor,
    withStub,
} from './harness';

/** A tool as the MCP server lists it. */
interface Listed {
    name: string;
    description: string;
    inputSchema: unknown;
    annotations: { readOnlyHint: boolean };
}

/** What the tests read of the extension's own package.json. */
interface Manifest {
    contributes: { languageModelTools: { name: string; modelDescription: string; inputSchema: unknown }[] };
}

describe('Enigma in VS Code: panes and views', () => {
    let api: Api;

    before(async () => {
        api = await activate();
    });

    it('shows what is under the cursor in the Identifier pane, where it can be renamed and documented', async () => {
        const editor = await openClass(api, 'a');
        const position = positionOf(editor.document, 'void doBaseThings()', 'void '.length + 1);
        editor.selection = new vscode.Selection(position, position);

        const entry = await waitFor('the pane to follow the cursor', () =>
            api.entryPane.entry?.displayName === 'doBaseThings' ? api.entryPane.entry : undefined,
        );
        assert.equal(entry.kindLabel, 'Method');
        assert.equal(entry.state, 'deobfuscated');
        assert.equal(entry.renamable, true);
        assert.equal(entry.name, 'doBaseThings');

        // javadoc is written in the pane
        await api.entryPane.onMessage({ type: 'saveJavadoc', key: entry.key, text: 'Does the base things.' });
        await waitFor('the javadoc to appear in the class', () => classDocument('a').getText().includes('Does the base things.'));
        await waitFor('the pane to show the javadoc', () => api.entryPane.entry?.javadoc.startsWith('Does the base things.'));

        // javadoc that would break out of its comment is refused and nothing changes
        await api.entryPane.onMessage({ type: 'saveJavadoc', key: entry.key, text: 'bad */ comment' });
        assert.ok(classDocument('a').getText().includes('Does the base things.'));
        assert.ok(!classDocument('a').getText().includes('bad */'));

        // the name field renames like the editor does, and refuses what the engine refuses
        await api.entryPane.onMessage({ type: 'rename', key: entry.key, name: 'performBaseThings' });
        await waitFor('the rename from the pane', () => classDocument('d').getText().includes('void performBaseThings()'));
        await waitFor('the pane to show the new name', () => api.entryPane.entry?.name === 'performBaseThings');
        // the cursor stays on the name, and so does the pane: the text is not replaced under it
        await waitFor(
            'the class to be settled',
            () => !classDocument('a').isDirty && classDocument('a').getText().includes('void performBaseThings()'),
        );
        await pause(400);
        const cursor = vscode.window.activeTextEditor!.selection.active;
        const line = classDocument('a').lineAt(cursor.line).text;
        const start = line.indexOf('performBaseThings');
        assert.ok(
            start >= 0 && cursor.character >= start && cursor.character <= start + 'performBaseThings'.length,
            `the cursor is at ${cursor.character} of "${line}"`,
        );
        assert.equal(api.entryPane.entry?.name, 'performBaseThings');
        await api.entryPane.onMessage({ type: 'rename', key: entry.key, name: 'class' });
        assert.equal((await entryInfo(api, METHOD_DO_BASE_THINGS)).name, 'performBaseThings');

        // library classes are shown, but locked
        const current = classDocument('a');
        const library = positionOf(current, 'String');
        const shown = vscode.window.visibleTextEditors.find(candidate => candidate.document === current)!;
        shown.selection = new vscode.Selection(library, library);
        const locked = await waitFor('the pane to show the library class', () =>
            api.entryPane.entry?.displayName === 'String' ? api.entryPane.entry : undefined,
        );
        assert.equal(locked.renamable, false);
        assert.equal(locked.state, 'library');
    });

    it('filters the structure view and shows hierarchies', async () => {
        await openClass(api, 'a');
        await execute('enigma.showStructure');
        await waitFor('the structure of the class', () =>
            api.structure.getChildren().some(node => node.label.includes('performBaseThings')),
        );

        await execute('enigma.structure.obfuscation.obfuscated');
        assert.equal(api.structure.options.obfuscation, 'obfuscated');
        await waitFor(
            'only obfuscated members',
            () =>
                api.structure.getChildren().length > 0 &&
                !api.structure.getChildren().some(node => node.label.includes('performBaseThings')),
        );
        await execute('enigma.structure.obfuscation.all');
        await waitFor('all members again', () => api.structure.getChildren().some(node => node.label.includes('performBaseThings')));

        const editor = await openClass(api, 'd');
        const position = positionOf(editor.document, 'class d', 'class '.length);
        editor.selection = new vscode.Selection(position, position);
        await execute('enigma.showInheritance');
        assert.equal(api.analysis.title, 'Inheritance');
        assert.equal(api.analysis.selected?.label, 'd');

        // the buttons of the view look at the same class in another way
        await execute('enigma.analysis.calls');
        await waitFor('the calls of the class', () => api.analysis.subject?.mode === 'calls');
    });

    it('has its panes where Enigma has its dockers: classes left, identifier below, structure and collaboration right', async () => {
        const contributes = vscode.extensions.getExtension('danibcastro.enigma-vscode')!.packageJSON.contributes;
        const containerOf = (view: string) =>
            Object.keys(contributes.views).find(container =>
                contributes.views[container].some((candidate: { id: string }) => candidate.id === view),
            );
        const placeOf = (container?: string) =>
            Object.keys(contributes.viewsContainers).find(place =>
                contributes.viewsContainers[place].some((candidate: { id: string }) => candidate.id === container),
            );
        const place = (view: string) => placeOf(containerOf(view));

        // the left side has the classes and nothing else
        assert.deepEqual(
            contributes.views.enigma.map((view: { id: string }) => view.id),
            ['enigma.classes.obfuscated', 'enigma.classes.deobfuscated', 'enigma.classes.all'],
        );
        assert.equal(place('enigma.classes.obfuscated'), 'activitybar');
        assert.equal(place('enigma.entry'), 'panel');
        assert.equal(place('enigma.structure'), 'secondarySidebar');
        assert.equal(place('enigma.analysis'), 'secondarySidebar');
        assert.equal(place('enigma.collab'), 'secondarySidebar');
        assert.equal(containerOf('enigma.structure'), containerOf('enigma.analysis'), 'structure and hierarchies share a tab');
        assert.notEqual(containerOf('enigma.collab'), containerOf('enigma.structure'), 'collaboration has a tab of its own');

        // the editor knows these places: each got its command
        const commands = await vscode.commands.getCommands(true);
        for (const container of ['enigma', 'enigma-identifier', 'enigma-analysis', 'enigma-collaboration']) {
            assert.ok(commands.includes(`workbench.view.extension.${container}`), `${container} is registered`);
        }

        // opening the first class brought up the panes around the code, without anyone asking
        await waitFor('the Identifier pane to be shown', () => api.entryPane.visible);

        const editor = await openClass(api, 'e');
        const position = positionOf(editor.document, 'String getFullName2()', 'String '.length + 3);
        editor.selection = new vscode.Selection(position, position);
        await execute('enigma.showInheritance');
        await waitFor('the structure to be shown', () => api.structureView.visible);
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        await waitFor('the pane to follow the cursor', () => api.entryPane.entry?.displayName === 'getFullName2');
        await screenshot('layout');

        if (process.env.ENIGMA_E2E_SCREENSHOTS) {
            await typeAt(editor, 'String getFullName2()', 'String getFullName2'.length, 'Fo');
            await waitFor('the edit', () => everywhere(editor.document, 'getFullName2Fo'));
            await screenshot('renaming');
            await execute('enigma.inlineRename.cancel');
            await waitFor('the name to be restored', () => everywhere(editor.document, 'getFullName2') && !editor.document.isDirty);

            await vscode.commands.executeCommand('enigma.collab.focus');
            await screenshot('collaboration');
            await vscode.commands.executeCommand('enigma.structure.focus');
            await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        }
    });

    it('lists the classes in two trees or in one, as configured', async () => {
        const mode = () => vscode.workspace.getConfiguration('enigma').get<string>('classTree.mode');
        const views = api.classViews;
        await vscode.commands.executeCommand('workbench.view.extension.enigma');

        // by default, like Enigma: what is still obfuscated, and what was named
        assert.equal(mode(), 'split');
        await waitFor('the two trees', () => views.obfuscated.visible && views.deobfuscated.visible && !views.all.visible);
        assert.ok(api.classTrees.deobfuscated.nodeOf('a'), 'BaseClass is listed as named');
        assert.equal(api.classTrees.obfuscated.nodeOf('a'), undefined);
        assert.ok(api.classTrees.obfuscated.nodeOf('d'));

        // one tree instead, from the menu of the views
        await execute('enigma.classTree.showAll');
        await waitFor(
            'the single tree',
            () => mode() === 'all' && views.all.visible && !views.obfuscated.visible && !views.deobfuscated.visible,
        );
        assert.equal(api.classTrees.all.classCount, api.index.size, 'it has every class');
        assert.ok(api.classTrees.all.nodeOf('a') && api.classTrees.all.nodeOf('d'));

        // the tree that is shown is the one a class is revealed in
        await openClass(api, 'd');
        await execute('enigma.revealInClassTree');
        await waitFor('the class to be selected in the single tree', () => classOf(views.all.selection[0]) === 'd');
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        await screenshot('classes-in-one-tree');

        // and back
        await execute('enigma.classTree.showSplit');
        await waitFor(
            'the two trees again',
            () => mode() === 'split' && views.obfuscated.visible && views.deobfuscated.visible && !views.all.visible,
        );
        await execute('enigma.revealInClassTree');
        await waitFor('the class to be selected among the obfuscated ones', () => classOf(views.obfuscated.selection[0]) === 'd');
        await vscode.workspace.getConfiguration('enigma').update('classTree.mode', undefined, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    });

    it("shows classes with Enigma's icons, and how far they are mapped next to their names", async () => {
        const tree = api.classTrees.all;
        const item = (obf: string) => tree.getTreeItem(tree.nodeOf(obf)!);
        const icon = (obf: string) => path.basename((item(obf).iconPath as vscode.Uri).fsPath);
        // BaseClass and SubclassA are abstract, SubclassB is not
        assert.deepEqual(['a', 'c', 'd'].map(icon), ['abstract.svg', 'abstract.svg', 'class.svg']);
        // the pictures are part of the extension, one for everything a class can be
        const icons = path.join(vscode.extensions.getExtension('danibcastro.enigma-vscode')!.extensionPath, 'resources', 'icons');
        assert.equal(path.dirname((item('a').iconPath as vscode.Uri).fsPath), icons);
        for (const name of ['class', 'interface', 'enum', 'annotation', 'record', 'abstract', 'exception']) {
            assert.ok(fs.readFileSync(path.join(icons, `${name}.svg`), 'utf8').includes('<svg'), name);
        }

        // like in Enigma, nothing says how far a class is until that was counted
        const mark = (obf: string) => api.classDecorations.provideFileDecoration(item(obf).resourceUri!);
        await execute('enigma.hideClassStats');
        assert.equal(mark('a'), undefined);
        await execute('enigma.generateClassStats');
        await waitFor('the progress of the classes', () => mark('a') !== undefined);
        // BaseClass has names by now, though not all of them; whatever the others have, the mark says the same as the numbers
        assert.equal(mark('a')!.badge, '◐');
        assert.match(String(mark('a')!.tooltip), /^Partially mapped: \d+ of \d+ names$/);
        for (const obf of ['a', 'c', 'd', 'e']) {
            const shown = mark(obf)!;
            assert.ok(['●', '◐', '○'].includes(shown.badge!), `${obf}: ${shown.badge}`);
            // only what was worked on stands out
            assert.equal(shown.color !== undefined, shown.badge !== '○', obf);
        }

        await execute('enigma.hideClassStats');
        assert.equal(mark('a'), undefined);
    });

    it('shows bytecode read-only', async () => {
        await openClass(api, 'd');
        await execute('enigma.showBytecode');
        const bytecode = await waitFor('the bytecode view', () => {
            const active = vscode.window.activeTextEditor;
            return active?.document.uri.path.endsWith('.bytecode') && active.document.getText().includes('ALOAD') ? active : undefined;
        });
        assert.equal(bytecode.document.languageId, 'enigma-bytecode');
        assert.match(bytecode.document.getText(), /performBaseThings/);

        const before = bytecode.document.getText();
        await execute('type', { text: 'x' });
        assert.equal(bytecode.document.getText(), before);
        assert.equal(bytecode.document.isDirty, false);
        // what cannot be typed cannot be changed in another way either
        await bytecode.edit(builder => builder.insert(new vscode.Position(0, 0), 'x'));
        await waitFor('the bytecode to be as it was', () => bytecode.document.getText() === before && !bytecode.document.isDirty);
    });

    it('counts mapping statistics', async () => {
        const stats = await api.statsPanel.generate({
            types: ['classes', 'methods', 'fields', 'parameters'],
            package: '',
            includeSynthetic: false,
            countFallback: false,
        });
        assert.ok(stats.mappable > 0);
        assert.ok(stats.mapped >= 3 && stats.mapped < stats.mappable, `${stats.mapped} of ${stats.mappable} mapped`);

        const classesOnly = await api.statsPanel.generate({
            types: ['classes'],
            package: '',
            includeSynthetic: false,
            countFallback: false,
        });
        assert.ok(classesOnly.mappable < stats.mappable);
        assert.equal(classesOnly.mapped, 1);
    });

    it('keeps a class working when names are changed and changed back', async () => {
        // SubclassB and the method only it declares
        const method: EntryRef = { kind: 'method', owner: 'd', name: 'b', desc: '()V' };
        const type: EntryRef = { kind: 'class', name: 'd' };
        const original = { method: (await entryInfo(api, method)).name, type: (await entryInfo(api, type)).name };
        const works = async (methodName: string, what: string) => {
            await waitFor(`the class to be in line with the engine ${what}`, () => {
                const active = vscode.window.activeTextEditor;
                return (
                    active?.document.uri.query === 'class=d&view=source' &&
                    !active.document.isDirty &&
                    api.editor.inSync(active.document) &&
                    active.document.getText().includes(`void ${methodName}()`)
                );
            });
            await pause(300);
            const active = vscode.window.activeTextEditor!;
            assert.ok(api.editor.inSync(active.document), `in line ${what}`);
            const position = positionOf(active.document, `void ${methodName}()`, 'void '.length);
            active.selection = new vscode.Selection(position.translate(0, 1), position.translate(0, 1));
            active.selection = new vscode.Selection(position, position);
            await waitFor(
                `the pane to show the method ${what}`,
                () => api.entryPane.entry?.kindLabel === 'Method' && api.entryPane.entry.name === methodName,
            );
        };

        await openClass(api, 'd');
        await works(original.method, 'at first');
        for (const round of [1, 2]) {
            // a method, to a name and back to the one it had
            await api.editing.rename(method, 'describe');
            await works('describe', `after renaming a method, round ${round}`);
            await api.editing.rename(method, original.method);
            await works(original.method, `after renaming a method back, round ${round}`);

            // the class itself, which moves it to a tab of another name each time
            await api.editing.rename(type, 'Renamed');
            await waitFor('the tab of the renamed class', () =>
                vscode.window.activeTextEditor?.document.uri.path.endsWith('/Renamed.java'),
            );
            await works(original.method, `after renaming the class, round ${round}`);
            await api.editing.rename(type, original.type);
            await waitFor(
                'the tab of the class under the name it had',
                () => !vscode.window.activeTextEditor?.document.uri.path.endsWith('/Renamed.java'),
            );
            await works(original.method, `after renaming the class back, round ${round}`);

            // and typed over in the code, which is where the tab changes while a name is being edited
            for (const [from, to] of [
                [original.type, 'Typed'],
                ['Typed', original.type],
            ]) {
                const active = vscode.window.activeTextEditor!;
                await typeOver(active, `class ${from} `, 'class '.length, from, to);
                await waitFor(`"${to}" to be typed`, () => active.document.getText().includes(`class ${to} `));
                assert.equal(await execute('enigma.inlineRename.commit'), true);
                await waitFor(`the tab of ${to}`, () => vscode.window.activeTextEditor?.document.uri.path.endsWith(`/${to}.java`));
                await works(original.method, `after typing ${to} over the name of the class, round ${round}`);
            }
        }
    });

    it('keeps the names of a class in a package marked when its name is typed over and typed back', async () => {
        const obf = 'org/quiltmc/enigma/input/Keep';
        await execute('enigma.openClass', obf);
        await waitFor('the class to be shown', () => {
            const active = vscode.window.activeTextEditor;
            return (
                !!active &&
                active.document.uri.path.endsWith('/Keep.java') &&
                active.document.getText().includes('class Keep ') &&
                api.editor.inSync(active.document)
            );
        });
        for (const [from, to] of [
            ['Keep', 'TestRename'],
            ['TestRename', 'Keep'],
        ]) {
            const active = vscode.window.activeTextEditor!;
            await typeOver(active, `class ${from} `, 'class '.length, from, to);
            await waitFor(`"${to}" to be typed`, () => active.document.getText().includes(`class ${to} `));
            // the first name in a package is asked about
            assert.equal(
                await withStub(
                    vscode.window,
                    'showWarningMessage',
                    async () => 'Rename',
                    () => execute('enigma.inlineRename.commit'),
                ),
                true,
            );
            await waitFor(`the tab of ${to}`, () => vscode.window.activeTextEditor?.document.uri.path.endsWith(`/${to}.java`));
            await pause(1500);
            const shown = vscode.window.activeTextEditor!;
            assert.ok(shown.document.getText().includes(`class ${to} `), shown.document.getText());
            assert.equal(shown.document.isDirty, false, `${to} has no unsaved changes`);
            assert.ok(api.editor.inSync(shown.document), `${to} is in line with the engine, so its names are marked`);
        }
    });

    it('lets the assistants of the editor look around in the jar and name things', async () => {
        const names = [
            'enigma_overview',
            'enigma_list_classes',
            'enigma_read_class',
            'enigma_list_members',
            'enigma_search',
            'enigma_describe',
            'enigma_references',
            'enigma_callers',
            'enigma_callees',
            'enigma_hierarchy',
            'enigma_rename',
            'enigma_set_javadoc',
        ];
        assert.deepEqual(
            vscode.lm.tools
                .filter(tool => tool.name.startsWith('enigma_'))
                .map(tool => tool.name)
                .sort(),
            [...names].sort(),
        );
        const call = async (name: string, input: object) => {
            const result = await vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined });
            return result.content.map(part => (part instanceof vscode.LanguageModelTextPart ? part.value : '')).join('');
        };

        const classes = JSON.parse(await call('enigma_list_classes', {}));
        assert.equal(classes.total, api.index.size);
        assert.ok(
            classes.classes.some((item: { obfuscatedName: string; kind: string }) => item.obfuscatedName === 'a' && item.kind === 'class'),
        );
        assert.equal(JSON.parse(await call('enigma_list_classes', { package: 'org/quiltmc' })).total, 1);

        // a class is found by the name it has now as well as by the one in the jar
        const current = api.index.get('a')!.deobf;
        assert.match(await call('enigma_read_class', { class: current }), /public abstract class /);
        assert.match(await call('enigma_read_class', { class: 'a' }), /public abstract class /);
        await assert.rejects(call('enigma_read_class', { class: 'no/such/Thing' }), /There is no class/);

        // what is listed for a member is what renames it
        const members = JSON.parse(await call('enigma_list_members', { class: 'd' })).members;
        const method = members.find(
            (member: { entry: { kind: string; name: string; desc?: string } }) =>
                member.entry.kind === 'method' && member.entry.name === 'b' && member.entry.desc === '()V',
        );
        assert.ok(method, JSON.stringify(members));
        const before = (await entryInfo(api, method.entry)).name;
        assert.deepEqual(JSON.parse(await call('enigma_rename', { entry: method.entry, newName: 'namedByAnAssistant' })), {
            renamed: true,
            to: 'namedByAnAssistant',
        });
        assert.equal((await entryInfo(api, method.entry)).name, 'namedByAnAssistant');
        assert.ok(
            JSON.parse(await call('enigma_search', { query: 'namedByAnAssistant', kinds: ['method'] })).some(
                (found: { entry: { name: string } }) => found.entry.name === 'b',
            ),
        );

        // a name the engine refuses is refused, with its reason, and changes nothing
        const refused = JSON.parse(await call('enigma_rename', { entry: method.entry, newName: 'class' }));
        assert.equal(refused.renamed, false);
        assert.ok(refused.messages.length > 0);
        assert.equal((await entryInfo(api, method.entry)).name, 'namedByAnAssistant');

        assert.equal(
            JSON.parse(await call('enigma_set_javadoc', { entry: method.entry, javadoc: 'Written by an assistant.' })).written,
            true,
        );
        await waitFor('the javadoc in the class', () => classDocument('d').getText().includes('Written by an assistant.'));
        // and gone again, for the tests that follow
        // context and evidence: what the jar is, what an entry is, how it is used and what it is related to
        const overview = JSON.parse(await call('enigma_overview', {}));
        assert.equal(overview.jar, 'inheritance_tree.jar');
        assert.equal(overview.classes, api.index.size);
        assert.ok(
            overview.packages.some(
                (item: { package: string; classes: number }) => item.package === 'org/quiltmc/enigma/input' && item.classes === 1,
            ),
            JSON.stringify(overview.packages),
        );
        assert.match(overview.guide, /Read before naming/);
        const described = JSON.parse(await call('enigma_describe', { entry: method.entry }));
        assert.equal(described.kind, 'method');
        assert.equal(described.javadoc, 'Written by an assistant.');
        assert.equal(described.obfuscatedName, 'b');
        const hierarchy = JSON.parse(await call('enigma_hierarchy', { class: 'd' }));
        assert.ok(
            hierarchy.extendsOrImplements.some((item: { entry: { name: string } }) => item.entry.name === 'a'),
            JSON.stringify(hierarchy),
        );
        assert.ok(
            JSON.parse(await call('enigma_hierarchy', { class: 'a' })).extendedOrImplementedBy.some(
                (item: { entry: { name: string } }) => item.entry.name === 'd',
            ),
        );
        // BaseClass.getName is called by the classes that extend it
        const getName = { kind: 'method', owner: 'a', name: 'a', desc: '()Ljava/lang/String;' };
        const callers = JSON.parse(await call('enigma_callers', { entry: getName }));
        assert.ok(
            callers.total > 0 && callers.callers.every((caller: { entry: { kind: string } }) => caller.entry.kind === 'method'),
            JSON.stringify(callers),
        );
        assert.ok(JSON.parse(await call('enigma_references', { entry: getName })).total > 0);
        const callees = JSON.parse(await call('enigma_callees', { entry: callers.callers[0].entry }));
        assert.ok(
            callees.uses.some(
                (used: { entry: { name: string; desc?: string } }) => used.entry.name === 'a' && used.entry.desc === '()Ljava/lang/String;',
            ),
            JSON.stringify(callees),
        );
        assert.ok(
            callees.uses.some((used: { library?: boolean }) => used.library),
            'what it uses of libraries is listed too',
        );
        // a long class comes in parts
        assert.match(await call('enigma_read_class', { class: 'a', fromLine: 5 }), /\/\/ Lines 5 to \d+ of \d+\./);

        // one change right after the other, as an assistant makes them: classes in tabs at the back keep up too
        await call('enigma_set_javadoc', { entry: method.entry, javadoc: '' });
        await call('enigma_rename', { entry: method.entry, newName: before });
        assert.equal((await entryInfo(api, method.entry)).name, before);
        await waitFor(
            'the class to show what the engine has',
            () => !classDocument('d').getText().includes('Written by an assistant.') && !classDocument('d').isDirty,
        );
    });

    it('gives assistants outside the editor the same tools over MCP, to who has the token only', async () => {
        const configuration = vscode.workspace.getConfiguration('enigma');
        const port = 41000 + Math.floor(Math.random() * 2000);
        assert.equal(api.mcp.port, undefined, 'off until it is turned on');
        await configuration.update('mcp.port', port, vscode.ConfigurationTarget.Global);
        await configuration.update('mcp.enabled', true, vscode.ConfigurationTarget.Global);
        try {
            await waitFor('the MCP server to listen', () => api.mcp.port === port);
            const token = await api.mcp.secret();
            const post = (body: object, headers: Record<string, string> = { Authorization: `Bearer ${token}` }) =>
                fetch(`http://127.0.0.1:${port}/mcp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...headers },
                    body: JSON.stringify(body),
                });
            const rpc = async <T>(method: string, params: object = {}) =>
                ((await (await post({ jsonrpc: '2.0', id: 1, method, params })).json()) as { result: T }).result;

            // nobody else gets in: not without the token, and not a web page with it
            assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {})).status, 401);
            assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer wrong' })).status, 401);
            assert.equal(
                (
                    await post(
                        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
                        { Authorization: `Bearer ${token}`, Origin: 'https://example.com' },
                    )
                ).status,
                403,
            );

            const hello = await rpc<{ protocolVersion: string; serverInfo: { name: string }; instructions: string }>('initialize', {
                protocolVersion: '2025-03-26',
                capabilities: {},
                clientInfo: { name: 'test', version: '0' },
            });
            assert.equal(hello.protocolVersion, '2025-03-26');
            assert.equal(hello.serverInfo.name, 'enigma');
            assert.match(hello.instructions, /Read before naming/);
            assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);

            // the very tools of the chat, described the same way
            const listed = (await rpc<{ tools: Listed[] }>('tools/list')).tools;
            const declared = (vscode.extensions.getExtension('danibcastro.enigma-vscode')!.packageJSON as Manifest).contributes
                .languageModelTools;
            assert.deepEqual(
                listed.map(tool => [tool.name, tool.description, tool.inputSchema]),
                declared.map(tool => [tool.name, tool.modelDescription, tool.inputSchema]),
            );
            assert.deepEqual(
                listed.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name),
                ['enigma_rename', 'enigma_set_javadoc'],
            );

            const text = async (name: string, input: object) => {
                const result = await rpc<{ content: { text: string }[]; isError: boolean }>('tools/call', { name, arguments: input });
                return { text: result.content[0].text, failed: result.isError };
            };
            assert.equal(JSON.parse((await text('enigma_overview', {})).text).classes, api.index.size);
            assert.match((await text('enigma_read_class', { class: 'd' })).text, /class /);
            // what a tool cannot do is told to the model, not to the protocol
            const missing = await text('enigma_read_class', { class: 'no/such/Thing' });
            assert.equal(missing.failed, true);
            assert.match(missing.text, /There is no class/);

            // a rename made this way is a rename like any other
            const method: EntryRef = { kind: 'method', owner: 'd', name: 'b', desc: '()V' };
            const before = (await entryInfo(api, method)).name;
            assert.equal(JSON.parse((await text('enigma_rename', { entry: method, newName: 'namedOverMcp' })).text).renamed, true);
            assert.equal((await entryInfo(api, method)).name, 'namedOverMcp');
            await waitFor('the name in the editor', () => classDocument('d').getText().includes('void namedOverMcp()'));
            await text('enigma_rename', { entry: method, newName: before });
            await waitFor(
                'the name it had in the editor',
                () => !classDocument('d').getText().includes('namedOverMcp') && !classDocument('d').isDirty,
            );
        } finally {
            await configuration.update('mcp.enabled', undefined, vscode.ConfigurationTarget.Global);
            await configuration.update('mcp.port', undefined, vscode.ConfigurationTarget.Global);
        }

        await waitFor('the MCP server to stop', () => api.mcp.port === undefined);
    });
});
