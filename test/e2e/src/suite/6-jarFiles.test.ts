import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { Api, activate, execute, jar, openClass, pause, waitFor, withStub } from './harness';

describe('Enigma in VS Code: jars opened as files', () => {
    let api: Api;

    before(async () => {
        api = await activate();
    });

    const uri = vscode.Uri.file(jar);
    const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
    /** Tabs of Enigma's way of opening a jar. It has nothing to show, so there should never be one for long. */
    const jarTabs = () => tabs().filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'enigma.jar');
    const classTabs = () =>
        tabs()
            .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'enigma')
            .map(tab => tab.label);

    it('is one of the ways to open a jar, not the default one', async () => {
        const contributes = vscode.extensions.getExtension('danibcastro.enigma-vscode')!.packageJSON.contributes;
        // listed by "Open With...", next to the editor's own way, which stays the default
        assert.deepEqual(
            contributes.customEditors.map(
                (editor: { viewType: string; displayName: string; priority: string; selector: { filenamePattern: string }[] }) => [
                    editor.viewType,
                    editor.displayName,
                    editor.priority,
                    editor.selector[0].filenamePattern,
                ],
            ),
            [['enigma.jar', 'Enigma', 'option', '*.jar']],
        );
        assert.ok(
            contributes.menus['explorer/context'].some(
                (entry: { command: string; when: string }) =>
                    entry.command === 'enigma.openJarFile' && entry.when.includes('resourceExtname == .jar'),
            ),
        );

        // opened the ordinary way, which is what a click in the explorer does, a jar is the editor's business
        await vscode.commands.executeCommand('vscode.open', uri);
        await pause(500);
        assert.equal(jarTabs().length, 0);
        assert.equal(api.project.isOpen, false, 'looking at a jar opens nothing');
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    it('opens the jar in Enigma when chosen in "Open With...", without a page of its own', async () => {
        await vscode.commands.executeCommand('vscode.openWith', uri, 'enigma.jar');
        // the mappings this jar was saved with earlier come with it, as when it is opened from the menu
        await waitFor(
            'the jar to be open in Enigma, with its mappings',
            () => api.project.isOpen && api.index.get('a')?.deobf === 'BaseClass',
        );
        assert.equal(fs.realpathSync(api.project.state!.jarPath), fs.realpathSync(jar));
        await waitFor('its tab to be gone', () => jarTabs().length === 0);

        // chosen again for the jar that is open, it shows it without loading it again; so does the menu of the explorer
        const revision = api.project.state!.revision;
        await vscode.commands.executeCommand('vscode.openWith', uri, 'enigma.jar');
        await waitFor('its tab to be gone', () => jarTabs().length === 0);
        await execute('enigma.openJarFile', uri);
        assert.equal(api.project.isOpen, true);
        assert.equal(api.project.state!.revision, revision);
    });

    it('closes tabs of classes whose jar is not open, and brings them back with it', async () => {
        // What the editor restores when a window is opened, before the jar is. (Done here by hand: a test cannot close
        // and reopen its window.)
        await openClass(api, 'a');
        await openClass(api, 'd');
        assert.deepEqual(classTabs(), ['BaseClass.java', 'd.java']);
        await api.project.setAsideTabs(api.project.state!.jarPath);
        assert.deepEqual(classTabs(), []);
        await execute('enigma.restartBackend');
        await waitFor('the tabs to be back with the jar', () => api.project.isOpen && classTabs().join() === 'BaseClass.java,d.java');
        assert.equal(vscode.window.activeTextEditor?.document.uri.query, 'class=d&view=source', 'the one that was in front is in front');

        await withStub(
            vscode.window,
            'showWarningMessage',
            async () => "Don't Save",
            () => execute('enigma.closeJar'),
        );
        await waitFor('the jar to be closed', () => !api.project.isOpen);
    });
});
