import * as path from 'node:path';
import * as vscode from 'vscode';
import { OpenState } from '../engine/protocol';
import { t } from '../l10n';

/**
 * Shows the state of the project: in the status bar, and to the menus and key bindings, which are enabled by it.
 */
export class ProjectStatus implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);

    constructor() {
        this.item.name = 'Enigma';
    }

    /**
     * @param state the open project, if any
     * @param decompiler the name of its decompiler
     */
    show(state: OpenState | undefined, decompiler?: string): void {
        void vscode.commands.executeCommand('setContext', 'enigma.projectOpen', !!state);
        void vscode.commands.executeCommand('setContext', 'enigma.mappingsOpen', !!state?.mappingsPath);
        void vscode.commands.executeCommand('setContext', 'enigma.dirty', !!state?.dirty);
        void vscode.commands.executeCommand('setContext', 'enigma.canUndo', !!state?.canUndo);
        void vscode.commands.executeCommand('setContext', 'enigma.canRedo', !!state?.canRedo);
        void vscode.commands.executeCommand('setContext', 'enigma.connection', state?.connection ?? 'not_connected');

        if (!state) {
            this.item.hide();
            return;
        }

        const jar = path.basename(state.jarPath);
        const mappings = state.mappingsPath ? path.basename(state.mappingsPath) : undefined;
        const connection = state.connection === 'hosting' ? ' $(broadcast)' : state.connection === 'connected' ? ' $(plug)' : '';
        this.item.text = `$(symbol-keyword) ${jar}${mappings ? ` $(arrow-right) ${mappings}` : ''}${state.dirty ? ' $(circle-filled)' : ''}${connection}`;
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**Enigma**\n\nJar: \`${state.jarPath}\`\n\n${t('common.mappings')}: ${state.mappingsPath ? `\`${state.mappingsPath}\`` : `_${t('status.none')}_`}`);
        tooltip.appendMarkdown(`\n\n${t('common.decompiler')}: ${decompiler ?? state.decompiler}`);
        if (state.dirty) {
            tooltip.appendMarkdown(`\n\n$(circle-filled) ${t('status.unsavedMappingChangesClickToSave')}`);
            tooltip.supportThemeIcons = true;
        }

        this.item.tooltip = tooltip;
        this.item.command = state.dirty ? 'enigma.saveMappings' : 'enigma.showClasses';
        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
    }
}
