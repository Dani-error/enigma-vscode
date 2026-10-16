import * as vscode from 'vscode';
import { Enigma } from '../enigma';
import { JarOpener } from '../project/jarOpener';
import { Register, Targets } from './registry';

/**
 * The file a command was given, if it was given one. Commands are also run from the buttons of views, which pass
 * something of their own, and from the palette, which passes nothing: then there is no file, and the user is asked.
 */
const fileOf = (argument: unknown): string | undefined =>
    typeof argument === 'string' ? argument : argument instanceof vscode.Uri && argument.scheme === 'file' ? argument.fsPath : undefined;

/** Jars, mappings, exporting, and working on them together. */
export const registerProjectCommands = (
    register: Register,
    targets: Targets,
    { project, editor, jarOpener, collabPane, backend }: Enigma,
) => {
    register('enigma.openJar', (jar?: unknown) => project.openJar(fileOf(jar)));
    // "Open with Enigma" on a jar in the explorer, or on the tab of one; the files that were selected with it come second
    register('enigma.openJarFile', async (jar?: vscode.Uri) => {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        const target = jar ?? (tab instanceof vscode.TabInputCustom && tab.viewType === JarOpener.viewType ? tab.uri : undefined);
        if (target) {
            await jarOpener.open(target);
        } else {
            await project.openJar();
        }
    });
    register('enigma.closeJar', () => project.closeJar());
    register('enigma.openRecent', () => project.openRecent());
    register('enigma.reloadAll', () => project.reloadAll());

    register('enigma.openMappings', (mappings?: unknown) => project.openMappings(fileOf(mappings)));
    register('enigma.openMappingsFolder', () => project.openMappings(undefined, true));
    register('enigma.saveMappings', async () => {
        // a name still being typed belongs to what is saved
        if (await editor.commitActive('enter')) {
            await project.saveMappings();
        }
    });
    register('enigma.saveMappingsAs', async () => {
        if (await editor.commitActive('enter')) {
            await project.saveMappingsAs();
        }
    });
    register('enigma.closeMappings', () => project.closeMappings());
    register('enigma.reloadMappings', () => project.reloadMappings());
    register('enigma.dropMappings', () => project.dropMappings());

    register('enigma.exportSource', () => project.exportSource());
    register('enigma.exportJar', () => project.exportJar());

    register('enigma.collab.open', () => (targets.requireProject() ? collabPane.reveal() : undefined));
    register('enigma.collab.disconnect', () => backend.request('collab/disconnect'));
};
