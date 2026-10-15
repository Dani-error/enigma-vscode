import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { parseClassUri } from '../documents/classUri';
import { MappingsChangedParams } from '../engine/protocol';
import { settings } from '../config';
import { ClassViews } from './classViews';

type Progress = Record<string, [mapped: number, mappable: number]>;

/**
 * Mapping progress per class, shown in the class trees once asked for: the stat icons of Enigma's class tree. Counted
 * by the engine, and counted again for the classes an edit touches.
 */
export class ClassProgress implements vscode.Disposable {
    private progress?: Progress;
    private readonly disposables: vscode.Disposable[];

    constructor(private readonly backend: Backend, private readonly classes: ClassViews) {
        this.disposables = [
            backend.onDidChangeProject(() => this.apply(undefined)),
            backend.onDidChangeMappings(params => void this.update(params)),
        ];
    }

    private count(classes?: string[]): Promise<Progress> {
        return this.backend.request('stats/classes', classes ? { ...settings.statistics, classes } : settings.statistics);
    }

    private apply(progress: Progress | undefined): void {
        this.progress = progress;
        void vscode.commands.executeCommand('setContext', 'enigma.classStats', progress !== undefined);
        this.classes.setProgress(progress);
    }

    async show(): Promise<void> {
        this.apply(await this.count());
    }

    hide(): void {
        this.apply(undefined);
    }

    private async update(params: MappingsChangedParams): Promise<void> {
        if (!this.progress) {
            return;
        }

        try {
            if (params.full) {
                this.apply(await this.count());
                return;
            }

            // an edit affects the classes being looked at, and the classes that were renamed
            const affected = new Set(params.classes.map(item => item.obf));
            for (const document of vscode.workspace.textDocuments) {
                const parsed = parseClassUri(document.uri);
                if (parsed) {
                    affected.add(parsed.class);
                }
            }

            if (affected.size > 0) {
                const updated = await this.count([...affected]);
                if (this.progress) {
                    this.apply({ ...this.progress, ...updated });
                }
            }
        } catch {
            // statistics are a nicety; never let them get in the way of editing
        }
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
