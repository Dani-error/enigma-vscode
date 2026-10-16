import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { OpenState } from '../engine/protocol';
import { ErrorReporter } from './errors';
import { t } from '../l10n';

interface SnapshotInfo {
    jar: string;
    mappings: string | null;
    time: number;
}

const SNAPSHOT_DELAY = 2500;

/**
 * Protects unsaved mapping changes. The editor can close without asking, and the engine can stop: shortly after every
 * change all mappings are written to a recovery area, and offered back the next time the jar is opened.
 */
export class Recovery implements vscode.Disposable {
    private timer?: NodeJS.Timeout;
    private writing = Promise.resolve();
    /** Checksum of the jar whose snapshot the user was asked about, but did not decide on. */
    private undecided?: string;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly backend: Backend,
        private readonly reporter: ErrorReporter,
        private readonly state: () => OpenState | undefined,
    ) {}

    private get directory(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'recovery');
    }

    private paths(checksum: string): { mappings: string; info: string } {
        return { mappings: path.join(this.directory, `${checksum}.mapping`), info: path.join(this.directory, `${checksum}.json`) };
    }

    private remove(checksum: string): void {
        const paths = this.paths(checksum);
        this.writing = this.writing
            .then(() => {
                fs.rmSync(paths.mappings, { force: true });
                fs.rmSync(paths.info, { force: true });
            })
            .catch(() => undefined);
    }

    /** Follows the state of the project: a change is written down soon, and what was saved needs no recovering. */
    track(previous: OpenState | undefined, state: OpenState | undefined): void {
        clearTimeout(this.timer);
        if (!state?.jarChecksum) {
            return;
        }

        if (state.dirty) {
            this.timer = setTimeout(() => void this.write(), SNAPSHOT_DELAY);
        } else if (previous?.dirty && previous.jarChecksum === state.jarChecksum) {
            // The changes were just saved (or deliberately given up): there is nothing left to recover.
            // A snapshot found on disk while nothing is dirty is left alone: it is what offer() is about to ask about.
            this.remove(state.jarChecksum);
        }
    }

    /** Writes all current mappings to the recovery area. Called shortly after every change, and when shutting down. */
    write(): Promise<void> {
        clearTimeout(this.timer);
        const state = this.state();
        if (!state?.dirty || !state.jarChecksum || !this.backend.running) {
            return this.writing;
        }

        const checksum = state.jarChecksum;
        const paths = this.paths(checksum);
        const info: SnapshotInfo = { jar: state.jarPath, mappings: state.mappingsPath, time: Date.now() };
        this.writing = this.writing
            .then(async () => {
                if (this.undecided === checksum && fs.existsSync(paths.mappings)) {
                    // The user has not decided what to do with an older snapshot yet. Do not overwrite it with new work.
                    const kept = path.join(this.directory, `${checksum}.previous.mapping`);
                    fs.renameSync(paths.mappings, kept);
                    this.undecided = undefined;
                    this.backend.output.warn(`Unsaved changes from an earlier session were not restored; they are kept in ${kept}`);
                }

                await this.backend.request('mappings/snapshot', { path: paths.mappings });
                fs.writeFileSync(paths.info, JSON.stringify(info));
            })
            .catch(error => this.backend.output.warn(`Failed to write recovery snapshot: ${error}`));
        return this.writing;
    }

    /** Offers to bring back what was not saved the last time the open jar was worked on, if there is anything. */
    async offer(): Promise<void> {
        const state = this.state();
        if (!state?.jarChecksum) {
            return;
        }

        const paths = this.paths(state.jarChecksum);
        if (!fs.existsSync(paths.mappings) || !fs.existsSync(paths.info)) {
            return;
        }

        let info: SnapshotInfo;
        try {
            info = JSON.parse(fs.readFileSync(paths.info, 'utf8')) as SnapshotInfo;
        } catch {
            return;
        }

        // work done against other mappings of the same jar is not this project's
        if ((info.mappings ?? null) !== (state.mappingsPath ?? null)) {
            return;
        }

        const when = new Date(info.time).toLocaleString();
        const choice = await vscode.window.showWarningMessage(
            t('recovery.enigmaFoundUnsavedMappingChangesFor', path.basename(state.jarPath), when),
            { modal: true, detail: t('recovery.restoringBringsTheChangesBackAs') },
            t('recovery.restore'),
            t('recovery.discard'),
        );

        if (choice === t('recovery.restore')) {
            await this.reporter.run(() => this.backend.request('mappings/restoreSnapshot', { path: paths.mappings }));
        } else if (choice === t('recovery.discard')) {
            this.remove(state.jarChecksum);
        } else {
            // dismissed: ask again next time, and make sure new edits do not silently replace the snapshot
            this.undecided = state.jarChecksum;
        }
    }

    /** The unsaved changes were given up on purpose: they are not to be offered for recovery later. */
    discard(): void {
        clearTimeout(this.timer);
        const checksum = this.state()?.jarChecksum;
        if (checksum) {
            this.remove(checksum);
        }
    }

    dispose(): void {
        clearTimeout(this.timer);
    }
}
