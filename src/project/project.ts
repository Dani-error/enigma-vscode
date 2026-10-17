import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { ClassIndex } from '../documents/classIndex';
import { ClassEditors } from '../documents/classEditors';
import { EnigmaDocuments } from '../documents/documents';
import { BackendState, MappingFormat, OpenState, UserNotification, isOpen } from '../engine/protocol';
import { settings } from '../config';
import { ErrorReporter } from './errors';
import { ProjectDescriptor, ProjectMemory } from './memory';
import { Recovery } from './recovery';
import { ProjectStatus } from './status';
import { t } from '../l10n';
import { filePath } from './paths';

/**
 * Owns the open jar and its mappings: the equivalent of Enigma's file menu. What an editor extension needs on top of
 * that is done by its parts: remembering the project of each window (memory.ts), protecting unsaved work (recovery.ts),
 * showing the state (status.ts).
 */
export class Project implements vscode.Disposable {
    /** The project that is open, if one is. */
    state?: OpenState;
    private documents!: EnigmaDocuments;
    private editors!: ClassEditors;

    private readonly status = new ProjectStatus();
    private readonly recovery: Recovery;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly emitter = new vscode.EventEmitter<OpenState | undefined>();
    private restoring: Promise<unknown> = Promise.resolve();
    /** A project was open in this window since it started: bringing it back after a hiccup of the engine is not a question. */
    private openedHere = false;
    private restarting = false;
    private lastRestart: Promise<unknown> = Promise.resolve();
    private restartsPending = 0;
    /** What could not be opened because the engine did not start; opened once it does. */
    private pendingOpen?: ProjectDescriptor;

    /** Fired whenever the state of the project changed, including when a jar is opened or closed. */
    readonly onDidChange = this.emitter.event;

    constructor(
        context: vscode.ExtensionContext,
        private readonly backend: Backend,
        private readonly index: ClassIndex,
        private readonly memory: ProjectMemory,
        private readonly reporter: ErrorReporter,
    ) {
        this.recovery = new Recovery(context, backend, reporter, () => this.state);
        this.disposables.push(
            this.status,
            this.recovery,
            backend.onDidChangeState(state => this.setState(state)),
            backend.onDidChangeProject(state => {
                this.setState(state);
                if (!state.jarPath) {
                    this.index.clear();
                }
            }),
            backend.onDidChangeMappings(params => {
                if (params.full) {
                    void this.index.reload().catch(() => undefined);
                } else {
                    this.index.update(params.classes);
                }
            }),
            backend.onUserNotification(notification => this.showNotification(notification)),
            backend.onDidExit(({ expected }) => {
                const had = this.state?.jarPath;
                this.setState(undefined);
                this.index.clear();
                if (!expected && !this.restarting) {
                    void this.onBackendCrashed(had ?? undefined);
                }
            }),
            vscode.workspace.onDidChangeConfiguration(event => this.onConfigurationChanged(event)),
        );
        this.setState(undefined);
    }

    get isOpen(): boolean {
        return this.state !== undefined;
    }

    get formats(): MappingFormat[] {
        return this.backend.info?.formats ?? [];
    }

    /**
     * Gives the project the texts of the classes and the editors showing them. Not passed when it is created, as
     * they are created with it: the texts wait for the project to be ready.
     */
    attach(documents: EnigmaDocuments, editors: ClassEditors): void {
        this.documents = documents;
        this.editors = editors;
    }

    /** Resolves once the project this window had open is available again, or it is clear that there is none. */
    async whenReady(): Promise<boolean> {
        await this.restoring.catch(() => undefined);
        return this.isOpen;
    }

    private setState(state: BackendState | undefined): void {
        const previous = this.state;
        this.state = isOpen(state) ? state : undefined;
        const current = this.state;

        this.status.show(current, this.backend.info?.decompilers.find(decompiler => decompiler.id === current?.decompiler)?.name);
        if (current) {
            this.openedHere = true;
            this.memory.remember({
                jar: current.jarPath,
                mappings: current.mappingsPath ?? undefined,
                format: current.mappingsFormat ?? undefined,
            });
        }

        this.recovery.track(previous, current);
        this.emitter.fire(current);
    }

    private showNotification(notification: UserNotification): void {
        const text = notification.details ? `${notification.text} ${notification.details}` : notification.text;
        this.backend.output.info(`[${notification.type}] ${text}`);
        if (notification.type === 'error') {
            void vscode.window.showErrorMessage(`Enigma: ${text}`);
        } else if (notification.type === 'warning') {
            void vscode.window.showWarningMessage(`Enigma: ${text}`);
        } else {
            vscode.window.setStatusBarMessage(`Enigma: ${text}`, 5000);
        }
    }

    private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
        if (!event.affectsConfiguration('enigma')) {
            return;
        }

        const javaChanged = event.affectsConfiguration('enigma.java.home') || event.affectsConfiguration('enigma.java.vmArgs');
        if (javaChanged && this.restartsPending > 0) {
            // the engine is down for a restart that read the settings before this: once more, after it
            void this.restartBackend();
            return;
        }

        if (!this.backend.running) {
            // The engine is not running, most likely because it could not be started with the previous Java settings.
            // Try again right away, so that fixing the setting visibly fixes the problem.
            if (javaChanged) {
                void this.retryStart();
            }

            return;
        }

        if (event.affectsConfiguration('enigma.java.home')) {
            // a different runtime was chosen deliberately: switch to it without making the user ask twice
            void this.restartBackend();
            return;
        }

        const needsRestart = ['enigma.java.vmArgs', 'enigma.profile', 'enigma.pluginJars'].some(setting =>
            event.affectsConfiguration(setting),
        );
        if (needsRestart) {
            void vscode.window
                .showInformationMessage(t('project.thisEnigmaSettingTakesEffectAfter'), t('project.restartNow'))
                .then(choice => {
                    if (choice) {
                        void vscode.commands.executeCommand('enigma.restartBackend');
                    }
                });
            return;
        }

        if (event.affectsConfiguration('enigma.decompiler') && this.isOpen) {
            const id = settings.decompiler;
            if (id && id !== this.state?.decompiler) {
                void this.reporter.run(() => this.backend.request('decompiler/set', { id }));
            }
        }

        void this.backend.configure().catch(error => this.reporter.report(error));
    }

    /**
     * Starts the engine after its Java settings changed, and opens what was waiting for it.
     */
    private async retryStart(): Promise<void> {
        try {
            await this.backend.start();
        } catch (error) {
            this.reporter.report(error);
            return;
        }

        const runtime = this.backend.runtime;
        vscode.window.setStatusBarMessage(
            runtime ? t('project.enigmaEngineStartedWithJava', runtime.version) : t('project.enigmaEngineStarted'),
            6000,
        );

        const descriptor = this.pendingOpen ?? (this.openedHere ? this.memory.ofWindow : undefined);
        if (descriptor && !this.isOpen && fs.existsSync(descriptor.jar)) {
            await this.open(descriptor, { quiet: true });
            this.documents?.refreshAll();
        } else if (!descriptor && !this.isOpen) {
            // the engine could not be started when the window opened: what that would have led to
            await this.restore();
        }
    }

    /**
     * Reopens what this window had open the last time, if the user wants that. Unless told otherwise they are asked:
     * a jar takes a while to load, and the window may have been opened for something else.
     */
    restore(): Promise<unknown> {
        const descriptor = this.memory.ofWindow;
        const mode = settings.reopenLastProject;
        if (!descriptor || mode === 'never' || !fs.existsSync(descriptor.jar)) {
            if (descriptor) {
                void this.setAsideTabs(descriptor.jar);
            }

            return this.restoring;
        }

        const reopen = async () => {
            if (await this.open(descriptor, { quiet: true })) {
                this.documents?.refreshAll();
            } else {
                // without their jar, the tabs the editor restored have nothing to show
                await this.setAsideTabs(descriptor.jar);
            }
        };
        if (mode === 'always') {
            this.restoring = reopen();
            return this.restoring;
        }

        // Not part of what is waited for. The classes the editor restored in tabs are closed until the jar is open:
        // they come back with it, also when that is later, from "Open Recent Project...".
        void this.setAsideTabs(descriptor.jar);
        void vscode.window
            .showInformationMessage(
                descriptor.mappings
                    ? t('project.enigmaReopenWith', path.basename(descriptor.jar), path.basename(descriptor.mappings))
                    : t('project.enigmaReopen', path.basename(descriptor.jar)),
                t('project.reopen'),
                t('project.alwaysReopen'),
                t('project.notNow'),
            )
            .then(async choice => {
                if (choice === t('project.alwaysReopen')) {
                    await settings.update('reopenLastProject', 'always');
                }

                if ((choice === t('project.reopen') || choice === t('project.alwaysReopen')) && !this.isOpen) {
                    await reopen();
                }
            });
        return this.restoring;
    }

    /**
     * Asks what to do with unsaved changes before something that would lose them.
     * @returns whether to go ahead
     */
    async confirmDiscard(question: string): Promise<boolean> {
        if (!this.state?.dirty) {
            return true;
        }

        const choice = await vscode.window.showWarningMessage(
            t('project.yourMappingsHaveUnsavedChanges'),
            { modal: true, detail: question },
            t('project.save'),
            t('project.dontSave'),
        );

        if (choice === t('project.save')) {
            return (await this.saveMappings()) && !this.state?.dirty;
        }

        if (choice === t('project.dontSave')) {
            // giving the changes up is a decision: do not offer to recover them later
            this.recovery.discard();
            return true;
        }

        return false;
    }

    private async onBackendCrashed(jar: string | undefined): Promise<void> {
        const choice = await vscode.window.showErrorMessage(
            jar ? t('project.theEnigmaEngineStoppedUnexpectedlyChanges') : t('project.theEnigmaEngineStoppedUnexpectedly'),
            t('project.restart'),
            t('common.showLog'),
        );

        if (choice === t('project.restart')) {
            await vscode.commands.executeCommand('enigma.restartBackend');
        } else if (choice === t('common.showLog')) {
            this.backend.output.show();
        }
    }

    /** Restarts the engine, bringing the project and its unsaved changes back. */
    restartBackend(): Promise<void> {
        // One after the other: a restart asked for while another runs starts the engine again once that one is done,
        // with the settings as they are then. Starting along with it would start it with those it read.
        this.restartsPending++;
        const restart = this.lastRestart.then(() => this.restart()).finally(() => this.restartsPending--);
        this.lastRestart = restart.catch(() => undefined);
        // What is read meanwhile waits for the jar to be open again (see whenReady). Not for the restart to end: that
        // brings tabs back, and waits for them to be read.
        this.restoring = new Promise<void>(resolve => {
            const listener = this.backend.onDidChangeProject(state => {
                if (state.jarPath) {
                    listener.dispose();
                    resolve();
                }
            });
            void restart.finally(() => {
                listener.dispose();
                resolve();
            });
        });
        return restart;
    }

    private async restart(): Promise<void> {
        const descriptor = this.state
            ? { jar: this.state.jarPath, mappings: this.state.mappingsPath ?? undefined, format: this.state.mappingsFormat ?? undefined }
            : this.memory.ofWindow;
        this.restarting = true;
        try {
            await this.recovery.write();
            await this.backend.restart();
        } catch (error) {
            // bring the project back as soon as the engine can be started again
            this.pendingOpen = descriptor && fs.existsSync(descriptor.jar) ? descriptor : undefined;
            this.reporter.report(error);
            return;
        } finally {
            this.restarting = false;
        }

        if (descriptor && fs.existsSync(descriptor.jar)) {
            await this.open(descriptor, { quiet: true });
            this.documents?.refreshAll();
        }
    }

    private async open(descriptor: ProjectDescriptor, options: { quiet?: boolean } = {}): Promise<boolean> {
        const opened = await (this.editors
            ? this.editors.whileOpening(() => this.openJarAndMappings(descriptor, options))
            : this.openJarAndMappings(descriptor, options));
        if (opened) {
            await this.recovery.offer();
        }

        return opened;
    }

    private async openJarAndMappings(descriptor: ProjectDescriptor, options: { quiet?: boolean }): Promise<boolean> {
        const libraries = settings.libraries;
        try {
            await this.backend.request('project/openJar', { jar: descriptor.jar, libraries });
            this.pendingOpen = undefined;
        } catch (error) {
            // if the engine could not even be started, open this as soon as it can
            this.pendingOpen = this.backend.running ? undefined : descriptor;
            this.reporter.report(error);
            return false;
        }

        if (descriptor.mappings) {
            if (fs.existsSync(descriptor.mappings)) {
                await this.loadMappings(descriptor.mappings, descriptor.format);
            } else if (!options.quiet) {
                void vscode.window.showWarningMessage(t('project.enigmaTheMappingsNoLongerExist', descriptor.mappings));
            }
        }

        await this.index.reload().catch(() => undefined);
        await this.bringBackTabs(descriptor.jar);
        return true;
    }

    /**
     * Closes the tabs of classes and remembers them for the jar they belong to. The editor restores tabs when a
     * window is opened, but without their jar all they can show is an error.
     */
    // This cannot be done when the window closes instead, which would spare the user the sight of tabs closing: the
    // editor no longer carries it out while it shuts down (tried).
    async setAsideTabs(jar: string): Promise<void> {
        const tabs = this.editors?.openTabs() ?? [];
        if (tabs.length === 0) {
            return;
        }

        // before anything is waited for: the editor is reading these right now, and gets no error for an answer
        this.documents.setAside(tabs);
        await this.memory.setAside({ jar, tabs });
        await this.editors.closeAll();
    }

    /** Opens the tabs that were set aside for a jar again, now that it is open. */
    private async bringBackTabs(jar: string): Promise<void> {
        // for another jar they mean nothing
        const aside = await this.memory.takeAside();
        if (aside?.jar !== jar) {
            return;
        }

        // the one that was looked at comes last, so that it ends up in front
        const tabs = aside.tabs.filter(tab => this.index.get(tab.class));
        for (const tab of [...tabs.filter(candidate => !candidate.active), ...tabs.filter(candidate => candidate.active)]) {
            await this.editors
                .openClass(tab.class, tab.view, { preview: false, viewColumn: tab.column, preserveFocus: !tab.active })
                .then(undefined, error => this.backend.output.warn(`Could not reopen ${tab.class}: ${error}`));
        }
    }

    async openJar(jar?: string): Promise<void> {
        if (!jar) {
            const picked = await vscode.window.showOpenDialog({
                title: t('project.openJar'),
                canSelectMany: false,
                filters: { [t('common.javaArchives')]: ['jar'], [t('project.allFiles')]: ['*'] },
                defaultUri: this.defaultDirectory(),
            });
            jar = picked?.[0] && filePath(picked[0].fsPath);
        }

        if (!jar || !(await this.confirmDiscard(t('project.saveBeforeOpeningJar')))) {
            return;
        }

        jar = filePath(jar);

        await this.closeTabs();

        // search for mappings that are associated with the jar, like Enigma does at startup
        const known = this.memory.recent().find(project => project.jar === jar && project.mappings && fs.existsSync(project.mappings));
        await this.open(known ?? { jar });
    }

    async openRecent(): Promise<void> {
        const recent = this.memory.recent();
        if (recent.length === 0) {
            void vscode.window.showInformationMessage(t('project.enigmaNoRecentProjects'));
            return;
        }

        const picked = await vscode.window.showQuickPick(
            recent.map(project => ({
                label: path.basename(project.jar),
                description: project.mappings ? `→ ${path.basename(project.mappings)}` : t('project.noMappings'),
                detail: project.mappings ? `${project.jar}  •  ${project.mappings}` : project.jar,
                project,
            })),
            { title: t('project.openRecentEnigmaProject'), matchOnDescription: true, matchOnDetail: true },
        );

        if (!picked) {
            return;
        }

        if (!fs.existsSync(picked.project.jar)) {
            void vscode.window.showErrorMessage(t('project.enigmaNoLongerExists', picked.project.jar));
            return;
        }

        if (await this.confirmDiscard(t('project.saveBeforeOpeningProject'))) {
            await this.closeTabs();
            await this.open(picked.project);
        }
    }

    async closeJar(): Promise<void> {
        if (!this.isOpen || !(await this.confirmDiscard(t('project.saveBeforeClosingJar')))) {
            return;
        }

        await this.closeTabs();
        await this.reporter.run(() => this.backend.request('project/closeJar'));
        await this.memory.forgetWindow();
    }

    /** Closes the classes of the jar that is about to go. What the editor is still reading of them is answered without it. */
    private async closeTabs(): Promise<void> {
        this.documents.setAside(this.editors.openTabs());
        await this.editors.closeAll();
    }

    async reloadAll(): Promise<void> {
        if (this.isOpen && (await this.confirmDiscard(t('project.saveBeforeReloading')))) {
            const libraries = settings.libraries;
            await this.editors.whileOpening(async () => {
                await this.reporter.run(() => this.backend.request('project/reload', { libraries }));
                await this.index.reload().catch(() => undefined);
            });
            this.documents.refreshAll();
        }
    }

    private defaultDirectory(): vscode.Uri | undefined {
        const current = this.state?.mappingsPath ?? this.state?.jarPath ?? this.memory.recent()[0]?.jar;
        return current ? vscode.Uri.file(path.dirname(current)) : vscode.workspace.workspaceFolders?.[0]?.uri;
    }

    private async loadMappings(mappingsPath: string, format?: string): Promise<boolean> {
        try {
            await this.backend.request('mappings/open', { path: mappingsPath, format });
            this.reporter.clearMappingProblems();
            return true;
        } catch (error) {
            this.reporter.report(error);
            return false;
        }
    }

    /**
     * Opens mappings, asking which, if no path is given.
     * @param folder ask for a directory of mappings rather than a file
     */
    async openMappings(mappingsPath?: string, folder = false): Promise<void> {
        if (!this.isOpen) {
            return;
        }

        if (!mappingsPath) {
            const filters: Record<string, string[]> = {};
            for (const format of this.formats.filter(candidate => candidate.read && !candidate.directory)) {
                filters[format.name] = format.extensions;
            }

            const picked = await vscode.window.showOpenDialog({
                title: folder ? t('project.openMappingsFolder') : t('project.openMappings'),
                openLabel: t('project.openMappings'),
                canSelectMany: false,
                canSelectFiles: !folder,
                // only macOS has a dialogue that takes either; elsewhere, folders have their own command
                canSelectFolders: folder || process.platform === 'darwin',
                filters: folder
                    ? undefined
                    : { [t('common.mappings')]: Object.values(filters).flat(), ...filters, [t('project.allFiles')]: ['*'] },
                defaultUri: this.defaultDirectory(),
            });
            mappingsPath = picked?.[0] && filePath(picked[0].fsPath);
        }

        if (mappingsPath && (await this.confirmDiscard(t('project.saveBeforeOpeningMappings')))) {
            await this.loadMappings(filePath(mappingsPath));
            await this.recovery.offer();
        }
    }

    /** @returns whether the mappings were saved */
    async saveMappings(): Promise<boolean> {
        if (!this.isOpen) {
            return false;
        }

        if (!this.state?.mappingsPath) {
            return this.saveMappingsAs();
        }

        const format = this.formats.find(candidate => candidate.id === this.state?.mappingsFormat);
        if (format && !format.write) {
            void vscode.window.showWarningMessage(t('project.enigmaCannotWriteMappingsChooseAnother', format.name));
            return this.saveMappingsAs();
        }

        return (
            (await this.reporter.run(async () => {
                await this.backend.request('mappings/save');
                vscode.window.setStatusBarMessage(t('project.enigmaMappingsSaved'), 3000);
                return true;
            })) ?? false
        );
    }

    async saveMappingsAs(): Promise<boolean> {
        if (!this.isOpen) {
            return false;
        }

        const writable = this.formats.filter(format => format.write);
        const current = this.state?.mappingsFormat;
        const picked = await vscode.window.showQuickPick(
            writable.map(format => ({
                label: `$(${format.directory ? 'folder' : format.extensions.includes('zip') ? 'file-zip' : 'file'}) ${format.name}`,
                description: `${format.directory ? t('project.aFolderWithOneFilePer') : format.extensions.map(extension => `.${extension}`).join(', ')}${format.id === current ? `  ·  ${t('project.currentFormat')}` : ''}`,
                format,
            })),
            { title: t('project.saveMappingsAs'), placeHolder: t('project.whichFormat'), matchOnDescription: true },
        );
        if (!picked) {
            return false;
        }

        const format = picked.format;
        const target = await vscode.window.showSaveDialog({
            title: format.directory ? t('project.saveMappingsToDirectory') : t('project.saveMappings'),
            saveLabel: t('project.saveMappings'),
            filters: format.directory ? undefined : { [format.name]: format.extensions },
            defaultUri: this.defaultDirectory(),
        });
        if (!target) {
            return false;
        }

        return (
            (await this.reporter.run(async () => {
                await this.backend.request('mappings/save', { path: filePath(target.fsPath), format: format.id });
                vscode.window.setStatusBarMessage(t('project.enigmaMappingsSaved'), 3000);
                return true;
            })) ?? false
        );
    }

    async closeMappings(): Promise<void> {
        if (this.isOpen && (await this.confirmDiscard(t('project.saveBeforeClosingMappings')))) {
            await this.reporter.run(() => this.backend.request('mappings/close'));
        }
    }

    async reloadMappings(): Promise<void> {
        if (this.isOpen && (await this.confirmDiscard(t('project.saveBeforeReloadingMappings')))) {
            await this.reporter.run(() => this.backend.request('mappings/reload'));
        }
    }

    async dropMappings(): Promise<void> {
        if (!this.isOpen) {
            return;
        }

        const result = await this.reporter.run(() => this.backend.request('mappings/drop'));
        if (!result) {
            return;
        }

        if (result.dropped.length === 0) {
            void vscode.window.showInformationMessage(t('project.enigmaAllMappingsMatchTheJar'));
            return;
        }

        for (const entry of result.dropped) {
            this.backend.output.info(`Dropped mapping of ${entry.kind} ${'owner' in entry ? `${entry.owner}.` : ''}${entry.name}`);
        }

        const choice = await vscode.window.showInformationMessage(
            t('project.enigmaDroppedMappingSThatDo', result.dropped.length),
            t('common.showLog'),
        );
        if (choice) {
            this.backend.output.show();
        }
    }

    async exportSource(): Promise<void> {
        if (!this.isOpen) {
            return;
        }

        const picked = await vscode.window.showOpenDialog({
            title: t('project.exportDecompiledSourceTo'),
            openLabel: t('project.exportSource'),
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: this.defaultDirectory(),
        });
        if (picked?.[0]) {
            const target = filePath(picked[0].fsPath);
            if (await this.reporter.run(async () => (await this.backend.request('export/source', { path: target }), true))) {
                void vscode.window.showInformationMessage(t('project.enigmaExportedTheDecompiledSourceTo', target));
            }
        }
    }

    async exportJar(): Promise<void> {
        const jar = this.state?.jarPath;
        if (!jar) {
            return;
        }

        const target = await vscode.window.showSaveDialog({
            title: t('project.exportRemappedJar'),
            saveLabel: t('project.exportJar'),
            filters: { [t('common.javaArchives')]: ['jar'] },
            defaultUri: vscode.Uri.file(path.join(path.dirname(jar), `${path.basename(jar, '.jar')}-deobf.jar`)),
        });
        if (target) {
            if (await this.reporter.run(async () => (await this.backend.request('export/jar', { path: filePath(target.fsPath) }), true))) {
                void vscode.window.showInformationMessage(t('project.enigmaExportedTheRemappedJarTo', filePath(target.fsPath)));
            }
        }
    }

    /** Writes unsaved changes to the recovery area now: the window is closing. */
    writeSnapshot(): Promise<void> {
        return this.recovery.write();
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.emitter.dispose();
    }
}
