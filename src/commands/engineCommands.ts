import * as vscode from 'vscode';
import { Enigma } from '../enigma';
import { MINIMUM_JAVA, discoverInstallations } from '../engine/java';
import { describeOrigin } from '../engine/javaText';
import { settings } from '../config';
import { Register } from './registry';
import { t } from '../l10n';

/** The engine itself: the Java it runs on, the decompiler it uses, its log. */
export const registerEngineCommands = (register: Register, { backend, project, output }: Enigma) => {
    register('enigma.restartBackend', () => project.restartBackend());
    register('enigma.showOutput', () => output.show());

    register('enigma.selectJava', async () => {
        const installations = discoverInstallations().filter(installation => installation.version >= MINIMUM_JAVA);
        const browse = { label: `$(folder-opened) ${t('engineCommands.browse')}`, description: t('engineCommands.chooseTheInstallationDirectoryOfA'), home: undefined as string | undefined };
        const automatic = { label: `$(sparkle) ${t('engineCommands.detectAutomatically')}`, description: t('engineCommands.clearTheSettingAndUseJava'), home: '' as string | undefined };
        const picked = await vscode.window.showQuickPick([
            ...installations.map(installation => ({ label: `Java ${installation.version}`, description: installation.home, home: installation.home })),
            automatic,
            browse,
        ], { title: t('engineCommands.selectJavaOrNewerForThe', MINIMUM_JAVA), matchOnDescription: true });
        if (!picked) {
            return;
        }

        let home = picked.home;
        if (picked === browse) {
            const chosen = await vscode.window.showOpenDialog({ title: t('engineCommands.javaInstallationDirectory'), canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
            home = chosen?.[0]?.fsPath;
            if (!home) {
                return;
            }
        }

        // changing the setting restarts the engine, or starts it if it could not be started before
        await settings.update('java.home', home || undefined);
    });

    register('enigma.selectDecompiler', async () => {
        const info = await backend.start();
        const current = project.state?.decompiler ?? settings.decompiler;
        const picked = await vscode.window.showQuickPick(info.decompilers.map(decompiler => ({
            label: decompiler.id === current ? `$(check) ${decompiler.name}` : `$(blank) ${decompiler.name}`,
            description: decompiler.id === 'enigma:bytecode' ? t('engineCommands.annotatedBytecodeInsteadOfSource') : undefined,
            id: decompiler.id,
        })), { title: t('common.decompiler') });
        if (picked) {
            // the setting is what is remembered; changing it switches the running engine
            await settings.update('decompiler', picked.id);
            if (project.isOpen && project.state?.decompiler !== picked.id) {
                await backend.request('decompiler/set', { id: picked.id });
            }
        }
    });

    register('enigma.about', async () => {
        const info = await backend.start();
        void vscode.window.showInformationMessage(
            `Enigma ${info.enigmaVersion}`,
            {
                modal: true,
                detail: `${t('engineCommands.aToolForDeobfuscationOfJava')}\n\n`
                    + `Vineflower ${info.vineflowerVersion}\nCFR ${info.cfrVersion}\nProcyon ${info.procyonVersion}\n`
                    + `Java ${info.javaVersion}${backend.runtime ? ` (${t('engineCommands.runtimeFrom', backend.runtime.executable, describeOrigin(backend.runtime.origin))})` : ''}`,
            },
        );
    });
}
