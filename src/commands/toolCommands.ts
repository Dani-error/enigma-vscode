import * as vscode from 'vscode';
import { Enigma } from '../enigma';
import { settings } from '../config';
import { Register } from './registry';
import { t } from '../l10n';

const quote = (value: string) => {
    return /^[\w@%+=:,./-]+$/.test(value) ? value : process.platform === 'win32' ? `"${value.replace(/"/g, '\\"')}"` : `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

/** Enigma's program that has no window, run in a terminal: its dedicated server. */
export const registerToolCommands = (register: Register, { backend, project }: Enigma) => {
    const runInTerminal = async (name: string, mainClass: string, args: string) => {
        const runtime = await backend.findRuntime();
        // launcher stubs such as macOS' /usr/bin/java follow JAVA_HOME; point it at the runtime that was found
        const terminal = vscode.window.createTerminal({ name, env: { JAVA_HOME: runtime.home ?? null } });
        terminal.show();
        // Enigma's own logging configuration also writes build/logs into the working directory, which is the user's
        // workspace here. The backend's configuration logs to the console only.
        terminal.sendText(`${quote(runtime.executable)} -Dtinylog.configuration=enigma-vscode-tinylog.properties -cp ${quote(backend.classpath())} ${mainClass} ${args}`.trim());
    };

    register('enigma.startDedicatedServer', async () => {
        const jar = project.state?.jarPath ?? (await vscode.window.showOpenDialog({ title: t('toolCommands.jarToServe'), filters: { [t('common.javaArchives')]: ['jar'] } }))?.[0]?.fsPath;
        if (!jar) {
            return;
        }

        const mappings = project.state?.mappingsPath ?? await vscode.window.showInputBox({
            title: t('toolCommands.dedicatedServer13Mappings'), prompt: t('toolCommands.pathOfTheMappingsTheServer'),
        });
        if (!mappings) {
            return;
        }

        const port = await vscode.window.showInputBox({ title: t('toolCommands.dedicatedServer23Port'), value: '34712' });
        if (!port) {
            return;
        }

        const password = await vscode.window.showInputBox({ title: t('toolCommands.dedicatedServer33Password'), password: true, prompt: t('toolCommands.leaveEmptyForNone') });
        if (password === undefined) {
            return;
        }

        const profile = settings.profile;
        const args = [`--jar ${quote(jar)}`, `--mappings ${quote(mappings)}`, `--port ${quote(port)}`];
        if (password) {
            args.push(`--password ${quote(password)}`);
        }

        if (profile) {
            args.push(`--profile ${quote(profile)}`);
        }

        await runInTerminal(t('toolCommands.terminalName'), 'org.quiltmc.enigma.network.DedicatedEnigmaServer', args.join(' '));
    });
}
