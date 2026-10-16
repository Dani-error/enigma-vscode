import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    Api,
    Offered,
    activate,
    classDocument,
    execute,
    freePort,
    mappings,
    openClass,
    positionOf,
    typeAt,
    waitFor,
    withStub,
    workspace,
} from './harness';

describe('Enigma in VS Code: saving, restarting and working together', () => {
    let api: Api;

    before(async () => {
        api = await activate();
    });

    it('saves mappings, applying a name that is still being typed, and asks before discarding changes', async () => {
        // first save: format and location are asked for
        await withStub(
            vscode.window,
            'showQuickPick',
            async (items: Offered[]) => items.find(item => item.format?.id === 'enigma:enigma_file'),
            () =>
                withStub(
                    vscode.window,
                    'showSaveDialog',
                    async () => vscode.Uri.file(mappings),
                    () => execute('enigma.saveMappings'),
                ),
        );
        await waitFor('the mappings to be saved', () => api.project.state?.dirty === false && fs.existsSync(mappings));

        const saved = fs.readFileSync(mappings, 'utf8');
        assert.match(saved, /CLASS a BaseClass/);
        assert.match(saved, /METHOD a performBaseThings \(\)V/);
        assert.match(saved, /METHOD a getFullName2 \(\)Ljava\/lang\/String;/);
        assert.match(saved, /COMMENT Does the base things\./);
        assert.equal(api.project.state?.mappingsPath, mappings);

        // later saves go straight to the same file, with the name in the editor applied first
        const editor = await openClass(api, 'a');
        const document = editor.document;
        await typeAt(editor, 'String getFullName2()', 'String getFullName2'.length, '3');
        await waitFor('the edit', () => document.getText().includes('getFullName23'));
        await execute('enigma.saveMappings');
        await waitFor('the save', () => api.project.state?.dirty === false && fs.readFileSync(mappings, 'utf8').includes('getFullName23'));
        await waitFor(
            'the editor to settle',
            () => !api.editor.renaming && !document.isDirty && document.getText().includes('String getFullName23()'),
        );
    });

    it('choosing a Java runtime with "Select Java..." keeps the project and its editors open', async function () {
        const installed = api.javaInstallations().find(installation => installation.home);
        if (!installed) {
            this.skip();
        }

        const editor = await openClass(api, 'd');
        const tabsBefore = vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.label);
        const textBefore = editor.document.getText();

        let offered: string[] = [];
        await withStub(
            vscode.window,
            'showQuickPick',
            async (items: Offered[]) => {
                offered = items.map(item => item.label);
                return items.find(item => item.home === installed.home);
            },
            () => execute('enigma.selectJava'),
        );
        assert.ok(
            offered.some(label => label.startsWith('Java ')),
            `installed runtimes are offered: ${offered.join(', ')}`,
        );

        // the engine restarts on the chosen runtime, and nothing the user had open is gone
        await waitFor(
            'the engine to restart on the chosen Java',
            () =>
                api.backend.running &&
                api.backend.runtime?.home === installed.home &&
                api.project.isOpen &&
                api.index.get('a')?.deobf === 'BaseClass',
        );
        assert.deepEqual(
            vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.label),
            tabsBefore,
        );
        await waitFor(
            'the open classes to be shown again',
            () =>
                classDocument('d').getText() === textBefore && ['a', 'd', 'e'].every(name => api.documents.source(classDocument(name).uri)),
        );

        // back to automatic detection for the rest of the tests
        await withStub(
            vscode.window,
            'showQuickPick',
            async (items: Offered[]) => items.find(item => item.label.includes('Detect automatically')),
            () => execute('enigma.selectJava'),
        );
        await waitFor(
            'the engine to restart on a detected Java',
            () =>
                api.backend.running &&
                api.project.isOpen &&
                api.index.get('a')?.deobf === 'BaseClass' &&
                api.backend.runtime?.source !== 'the enigma.java.home setting',
        );
        await waitFor(
            'the open classes to be shown again',
            () =>
                classDocument('d').getText() === textBefore &&
                !classDocument('d').isDirty &&
                ['a', 'd', 'e'].every(name => api.documents.source(classDocument(name).uri)),
        );
    });

    it('hosts a collaboration session from its pane', async () => {
        const port = await freePort();
        await api.collabPane.onMessage({ type: 'host', username: 'host_user', port, password: 'secret' });
        await waitFor('the session to start', () => api.project.state?.connection === 'hosting');
        await waitFor('the host to be listed', () => api.collabPane.users.includes('host_user'));

        await api.collabPane.onMessage({ type: 'chat', text: 'hello from the test' });
        const chat = await waitFor('the chat message', () => api.collabPane.log.find(message => message.type === 'chat'));
        assert.equal(chat.body, 'hello from the test');

        await api.collabPane.onMessage({ type: 'disconnect' });
        await waitFor('the session to end', () => api.project.state?.connection === 'not_connected');
        assert.deepEqual(api.collabPane.users, []);
        assert.equal(api.index.get('a')?.deobf, 'BaseClass', 'the mappings are kept');
    });

    it('brings back the project and unsaved changes after the engine is restarted', async () => {
        const document = classDocument('a');
        await execute(
            'vscode.executeDocumentRenameProvider',
            document.uri,
            positionOf(document, 'String getFullName23()', 'String '.length),
            'fetchName',
        );
        await waitFor(
            'the unsaved rename to be shown',
            () => api.project.state?.dirty === true && document.getText().includes('String fetchName()'),
        );

        // closing mappings with unsaved changes asks first; cancelling keeps everything
        let asked = 0;
        await withStub(
            vscode.window,
            'showWarningMessage',
            async () => {
                asked++;
                return undefined;
            },
            () => execute('enigma.closeMappings'),
        );
        assert.equal(asked, 1);
        assert.equal(api.project.state?.mappingsPath, mappings);
        assert.equal(api.project.state?.dirty, true);

        // "fetchName" is not saved. A restart is what happens after a crash, or when the window is reloaded.
        let prompt = '';
        await withStub(
            vscode.window,
            'showWarningMessage',
            async (message: string) => {
                prompt = message;
                return 'Restore';
            },
            () => execute('enigma.restartBackend'),
        );

        await waitFor('the project to be reopened', () => api.project.isOpen && api.index.get('a')?.deobf === 'BaseClass');
        assert.match(prompt, /unsaved mapping changes/);
        assert.equal(api.project.state?.mappingsPath, mappings);
        assert.equal(api.project.state?.dirty, true, 'restored changes are still unsaved');

        // the editors that were open show the restored state without being reopened
        await waitFor('open classes to be refreshed', () => classDocument('a').getText().includes('String fetchName()'));
        assert.ok(classDocument('a').getText().includes('Does the base things.'));
        assert.match(fs.readFileSync(mappings, 'utf8'), /getFullName23/, 'the file on disk is untouched until saved');
    });

    it('reports unreadable mappings as a problem on the file', async () => {
        const broken = path.join(workspace, 'broken.mapping');
        fs.writeFileSync(broken, 'CLASS a Base\n\tMETHOD\n');

        let message = '';
        await withStub(
            vscode.window,
            'showWarningMessage',
            async () => "Don't Save",
            () =>
                withStub(
                    vscode.window,
                    'showErrorMessage',
                    async (text: string) => {
                        message = text;
                        return undefined;
                    },
                    () => execute('enigma.openMappings', broken),
                ),
        );

        assert.match(message, /could not read the mappings/);
        const diagnostics = await waitFor('a diagnostic on the mappings file', () => {
            const found = vscode.languages.getDiagnostics(vscode.Uri.file(broken));
            return found.length > 0 ? found : undefined;
        });
        assert.equal(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
        assert.equal(diagnostics[0].source, 'Enigma');
        // the previous mappings are still loaded
        assert.equal(api.index.get('a')?.deobf, 'BaseClass');
    });

    it('closes the jar and its editors', async () => {
        await withStub(
            vscode.window,
            'showWarningMessage',
            async () => "Don't Save",
            () => execute('enigma.closeJar'),
        );
        await waitFor('the jar to be closed', () => !api.project.isOpen);

        const open = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'enigma');
        assert.equal(open.length, 0);
        assert.equal(api.index.size, 0);
    });
});
