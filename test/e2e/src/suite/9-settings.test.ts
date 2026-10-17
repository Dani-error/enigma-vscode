import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Api, activate, execute, fixtures, freePort, openClass, waitFor, workspace } from './harness';

// Every setting of the extension, set to each kind of value it takes while a jar is open with unsaved changes, and
// the extension still working afterwards: the engine running with the jar, a class shown. Nothing may go wrong.

interface Schema {
    type: string | string[];
    enum?: unknown[];
    items?: { enum?: unknown[] };
    default?: unknown;
}

/** How long the engine has to be up with the jar to count as having settled after a change. */
const STEADY_MS = 1500;

describe('Enigma in VS Code: every setting, set to each of its values', () => {
    let api: Api;
    const configuration = () => vscode.workspace.getConfiguration('enigma');
    const manifest = vscode.extensions.getExtension('danibcastro.enigma-vscode')!.packageJSON as {
        contributes: { configuration: { properties: Record<string, Schema> } };
    };
    const properties = manifest.contributes.configuration.properties;
    const settingsJar = path.join(workspace, 'settings.jar');
    const library = path.join(workspace, 'settings-library.jar');
    const profile = path.join(workspace, 'profile.json');
    const window = vscode.window as unknown as Record<string, unknown>;
    const showInformation = vscode.window.showInformationMessage;
    const showWarning = vscode.window.showWarningMessage;
    const ports: number[] = [];

    /** The values each setting is tried with, besides its default; what is not listed takes those of its type. */
    const values = (key: string, schema: Schema): unknown[] => {
        const special: Record<string, () => unknown[]> = {
            // the runtime the engine already uses, chosen by hand; a Java too old is tested in 1-project
            'java.home': () => (api.backend.runtime?.home ? [api.backend.runtime.home] : []),
            'java.vmArgs': () => [['-Xmx1g', '-Dfile.encoding=UTF-8']],
            'profile': () => [profile],
            // a jar without plugins: there is nothing for the engine to find in it
            'pluginJars': () => [[library]],
            'libraries': () => [[library]],
            'vineflower': () => [{ ind: '  ', rsy: true, dgs: 1 }],
            'editable': () => [[], ['class'], ['javadoc', 'local']],
            'maxRecentProjects': () => [0, 1],
            'references.maxClasses': () => [1],
            'mcp.port': () => ports,
        };
        if (special[key]) {
            return special[key]();
        }

        if (schema.enum) {
            return schema.enum.filter(value => value !== schema.default);
        }

        assert.equal(schema.type, 'boolean', `values to try for enigma.${key} are listed here`);
        return [!schema.default];
    };

    /** What a setting is for, done after it changed. */
    const uses: Record<string, (value: unknown) => Promise<void>> = {
        'stats.includeSynthetic': () => countClasses(),
        'stats.countFallback': () => countClasses(),
        'mcp.enabled': async value => {
            await waitFor(`the MCP server ${value ? 'to answer' : 'to stop'}`, async () => (await answers()) === value);
        },
        'mcp.port': async () => {
            await configuration().update('mcp.enabled', true, vscode.ConfigurationTarget.Global);
            await waitFor('the MCP server to answer on the port', answers);
            await configuration().update('mcp.enabled', undefined, vscode.ConfigurationTarget.Global);
            await waitFor('the MCP server to stop', async () => !(await answers()));
        },
    };

    async function countClasses(): Promise<void> {
        await execute('enigma.generateClassStats');
        await execute('enigma.hideClassStats');
    }

    /** Whether something answers on the port of the MCP server. Without the token, it is turned away. */
    async function answers(): Promise<boolean> {
        const port = configuration().get<number>('mcp.port');
        try {
            const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', signal: AbortSignal.timeout(2000) });
            return response.status === 401;
        } catch {
            return false;
        }
    }

    /** The extension working: the engine with the jar and its changes, and a class shown in an editor. */
    async function works(): Promise<void> {
        // what follows a change, like a restart, starts a moment later: up for a while is up
        let since: number | undefined;
        await waitFor(
            'the engine with the jar',
            () => {
                const up = api.backend.running && api.project.isOpen && api.index.size > 0;
                since = up ? (since ?? Date.now()) : undefined;
                return since !== undefined && Date.now() - since > STEADY_MS;
            },
            60000,
        );
        assert.ok(api.project.state?.dirty, 'the changes that were not saved are still there');
        // like clicking into the code: the focus may be in a panel
        await execute('workbench.action.closePanel');
        await execute('workbench.action.focusActiveEditorGroup');
        const editor = await openClass(api, 'e');
        assert.match(editor.document.getText(), /class /);
    }

    before(async () => {
        api = await activate();
        fs.copyFileSync(path.join(fixtures, 'inheritance_tree.jar'), settingsJar);
        fs.copyFileSync(path.join(fixtures, 'packages.jar'), library);
        fs.writeFileSync(profile, '{}\n');
        ports.push(await freePort(), await freePort());
        // the question of the settings that take effect after a restart: yes
        window.showInformationMessage = (message: string, ...rest: unknown[]) =>
            rest.includes('Restart Now')
                ? Promise.resolve('Restart Now')
                : Reflect.apply(showInformation, vscode.window, [message, ...rest]);
        // the questions of opening the jar, and of a restart: the changes that were not saved are wanted back
        window.showWarningMessage = (_message: string, ...rest: unknown[]) =>
            Promise.resolve(rest.includes('Restore') ? 'Restore' : "Don't Save");
        await api.project.openJar(settingsJar);
        await waitFor('the jar', () => api.project.isOpen && api.index.size > 0);
        await api.editing.rename({ kind: 'class', name: 'a' }, 'SettingsBase');
        await waitFor('unsaved changes', () => api.project.state?.dirty);
        // the MCP server on ports of its own: another window may have the default one
        await configuration().update('mcp.port', ports[0], vscode.ConfigurationTarget.Global);
    });

    after(async () => {
        window.showInformationMessage = showInformation;
        window.showWarningMessage = showWarning;
        for (const key of Object.keys(properties)) {
            await configuration().update(key.substring('enigma.'.length), undefined, vscode.ConfigurationTarget.Global);
        }
    });

    for (const [setting, schema] of Object.entries(properties)) {
        const key = setting.substring('enigma.'.length);
        it(`${setting}: each of its values, and back`, async function () {
            this.timeout(300000);
            await works();
            const original = configuration().inspect(key)?.globalValue;
            for (const value of [...values(key, schema), original]) {
                await configuration().update(key, value, vscode.ConfigurationTarget.Global);
                await works();
                await uses[key]?.(value ?? schema.default);
            }
        });
    }
});
