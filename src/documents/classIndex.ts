import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { ClassItem, LocationResult, View } from '../engine/protocol';
import { SCHEME, toRange } from './classUri';

/**
 * Every top-level class of the open jar, with its current name. Shared by the class trees and by anything that has to
 * build the address of a class.
 */
export class ClassIndex implements vscode.Disposable {
    private readonly classes = new Map<string, ClassItem>();
    private readonly emitter = new vscode.EventEmitter<void>();
    private loading?: Promise<void>;
    /** File name of the open jar; the first part of the address of its classes. */
    jarName = 'jar';

    /** Fired after the list or any name in it changed. */
    readonly onDidChange = this.emitter.event;

    constructor(private readonly backend: Backend) {}

    get all(): Iterable<ClassItem> {
        return this.classes.values();
    }

    get size(): number {
        return this.classes.size;
    }

    get(obf: string): ClassItem | undefined {
        return this.classes.get(obf);
    }

    /** Finds a class by its current, deobfuscated name. */
    byName(deobf: string): ClassItem | undefined {
        for (const item of this.classes.values()) {
            if (item.deobf === deobf) {
                return item;
            }
        }

        return undefined;
    }

    clear(): void {
        this.classes.clear();
        this.emitter.fire();
    }

    reload(): Promise<void> {
        const load = this.backend.request('classes/list').then(items => {
            if (this.loading !== load) {
                return;
            }

            this.classes.clear();
            for (const item of items) {
                this.classes.set(item.obf, item);
            }

            this.emitter.fire();
        });
        this.loading = load;
        return load;
    }

    /** Resolves when the classes asked for last are here. */
    async loaded(): Promise<void> {
        await this.loading?.catch(() => undefined);
    }

    update(items: ClassItem[]): void {
        for (const item of items) {
            this.classes.set(item.obf, item);
        }

        if (items.length > 0) {
            this.emitter.fire();
        }
    }

    /**
     * The address of a class, shaped like a path into the jar: `enigma:/test.jar!/com/example/Name.java`.
     *
     * The path carries the current, deobfuscated name, as that is what editor tabs and breadcrumbs display. The
     * obfuscated name in the query is what identifies the class. The `.jar!/` part is what the language definitions of
     * this extension match on, so that these documents are neither taken for files of a Java project nor handed to
     * Java tooling, which cannot make sense of them.
     */
    uri(obf: string, view: View = 'source', deobf?: string): vscode.Uri {
        const topLevel = obf.split('$')[0];
        const name = deobf ?? this.classes.get(topLevel)?.deobf ?? topLevel;
        return vscode.Uri.from({
            scheme: SCHEME,
            path: `/${this.jarName}!/${name}.${view === 'bytecode' ? 'bytecode' : 'java'}`,
            query: `class=${encodeURIComponent(topLevel)}&view=${view}`,
        });
    }

    /** A place in a class, as the editor wants it. */
    location(result: LocationResult): vscode.Location {
        const uri = this.uri(result.class, result.view, result.deobfName);
        return new vscode.Location(uri, result.range ? toRange(result.range) : new vscode.Position(0, 0));
    }

    dispose(): void {
        this.emitter.dispose();
    }
}
