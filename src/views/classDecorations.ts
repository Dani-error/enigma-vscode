import * as vscode from 'vscode';
import { t } from '../l10n';

type Progress = Record<string, [mapped: number, mappable: number]>;

export class ClassDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
    static readonly scheme = 'enigma-class';

    private progress: Progress = {};
    private readonly emitter = new vscode.EventEmitter<undefined>();
    private readonly registration = vscode.window.registerFileDecorationProvider(this);

    readonly onDidChangeFileDecorations = this.emitter.event;

    /** The address the items of the trees carry for a class, so that it can be marked. Nothing can be read there. */
    static uri(obf: string): vscode.Uri {
        return vscode.Uri.from({ scheme: ClassDecorations.scheme, path: `/${obf}` });
    }

    setProgress(progress: Progress): void {
        this.progress = progress;
        this.emitter.fire(undefined);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const stats = uri.scheme === ClassDecorations.scheme ? this.progress[uri.path.substring(1)] : undefined;
        if (!stats || stats[1] === 0) {
            return undefined;
        }

        const [mapped, mappable] = stats;
        if (mapped >= mappable) {
            return { badge: '●', tooltip: t('classDecorations.fullyMapped'), color: new vscode.ThemeColor('testing.iconPassed') };
        }

        // a class nothing was done to yet looks like any other: a jar that was just opened is not a list of faults
        return mapped > 0
            ? {
                  badge: '◐',
                  tooltip: t('classDecorations.partiallyMappedOfNames', mapped, mappable),
                  color: new vscode.ThemeColor('testing.iconQueued'),
              }
            : { badge: '○', tooltip: t('classDecorations.notMappedNoneOfNames', mappable) };
    }

    dispose(): void {
        this.registration.dispose();
        this.emitter.dispose();
    }
}
