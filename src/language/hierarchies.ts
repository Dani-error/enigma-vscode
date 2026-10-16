import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { ClassIndex } from '../documents/classIndex';
import { toRange } from '../documents/classUri';
import { EnigmaDocuments } from '../documents/documents';
import { EntryInfo, EntryRef } from '../engine/protocol';
import { declarationOf } from './declarations';
import { symbolKind } from '../kinds';

/** How many classes are decompiled at most to answer one hierarchy request. */
const MAX_HIERARCHY_ITEMS = 80;

/**
 * The editor's Type Hierarchy and Call Hierarchy views, from the engine's index of the jar.
 */
export class HierarchyProvider implements vscode.TypeHierarchyProvider, vscode.CallHierarchyProvider {
    /** Entries behind the items handed to the editor's hierarchy views. */
    private readonly entries = new WeakMap<object, EntryRef>();

    constructor(
        private readonly backend: Backend,
        private readonly index: ClassIndex,
        private readonly documents: EnigmaDocuments,
    ) {}

    private async typeItem(info: EntryInfo): Promise<vscode.TypeHierarchyItem | undefined> {
        if (!info.inJar) {
            return undefined;
        }

        const location = await declarationOf(this.backend, this.index, info.entry);
        if (!location) {
            return undefined;
        }

        const packageName = info.fullName.includes('/')
            ? info.fullName.substring(0, info.fullName.lastIndexOf('/')).replace(/\//g, '.')
            : '';
        const item = new vscode.TypeHierarchyItem(
            symbolKind(info.kind),
            info.simpleName.replace(/\$/g, '.'),
            packageName,
            location.uri,
            location.range,
            location.range,
        );
        this.entries.set(item, info.entry);
        return item;
    }

    async prepareTypeHierarchy(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.TypeHierarchyItem | undefined> {
        const token = await this.documents.tokenAt(document, position);
        if (!token) {
            return undefined;
        }

        // from a member, show the hierarchy of the class it belongs to
        const classEntry: EntryRef = token.entry.kind === 'class' ? token.entry : { kind: 'class', name: token.entry.owner };
        const info = await this.backend.request('entry/info', { entry: classEntry });
        return this.typeItem(info);
    }

    private async relatedTypes(
        item: vscode.TypeHierarchyItem,
        method: 'hierarchy/supertypes' | 'hierarchy/subtypes',
    ): Promise<vscode.TypeHierarchyItem[]> {
        const entry = this.entries.get(item);
        if (!entry || entry.kind !== 'class') {
            return [];
        }

        const related = await this.backend.request(method, { class: entry.name });
        const items = await Promise.all(related.slice(0, MAX_HIERARCHY_ITEMS).map(info => this.typeItem(info).catch(() => undefined)));
        return items.filter((candidate): candidate is vscode.TypeHierarchyItem => candidate !== undefined);
    }

    provideTypeHierarchySupertypes(item: vscode.TypeHierarchyItem): Promise<vscode.TypeHierarchyItem[]> {
        return this.relatedTypes(item, 'hierarchy/supertypes');
    }

    provideTypeHierarchySubtypes(item: vscode.TypeHierarchyItem): Promise<vscode.TypeHierarchyItem[]> {
        return this.relatedTypes(item, 'hierarchy/subtypes');
    }

    private async callItem(info: EntryInfo): Promise<vscode.CallHierarchyItem | undefined> {
        if (!info.inJar) {
            return undefined;
        }

        const location = await declarationOf(this.backend, this.index, info.entry);
        if (!location) {
            return undefined;
        }

        const item = new vscode.CallHierarchyItem(
            symbolKind(info.kind),
            `${info.simpleName}${info.type ?? ''}`,
            (info.owner ?? '').replace(/\//g, '.'),
            location.uri,
            location.range,
            location.range,
        );
        this.entries.set(item, info.entry);
        return item;
    }

    async prepareCallHierarchy(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CallHierarchyItem | undefined> {
        const token = await this.documents.tokenAt(document, position);
        if (!token || token.entry.kind !== 'method') {
            return undefined;
        }

        return this.callItem(token);
    }

    /** Where, in the class of {@code context}, {@code entry} is referenced. */
    private async callSites(sites: { entry: EntryRef; context: EntryRef }[]): Promise<vscode.Range[]> {
        const ranges: vscode.Range[] = [];
        for (const site of sites) {
            const location = await this.backend.request('nav/reference', site).catch(() => null);
            location?.ranges.forEach(range => ranges.push(toRange(range)));
        }

        return ranges;
    }

    async provideCallHierarchyIncomingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyIncomingCall[]> {
        const entry = this.entries.get(item);
        if (!entry) {
            return [];
        }

        const callers = await this.backend.request('calls/incoming', { entry });
        const calls = await Promise.all(
            callers.slice(0, MAX_HIERARCHY_ITEMS).map(async caller => {
                const callerItem = await this.callItem(caller).catch(() => undefined);
                if (!callerItem) {
                    return undefined;
                }

                const ranges = await this.callSites(caller.sites);
                return new vscode.CallHierarchyIncomingCall(callerItem, ranges.length > 0 ? ranges : [callerItem.selectionRange]);
            }),
        );
        return calls.filter((call): call is vscode.CallHierarchyIncomingCall => call !== undefined);
    }

    async provideCallHierarchyOutgoingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyOutgoingCall[]> {
        const entry = this.entries.get(item);
        if (!entry) {
            return [];
        }

        const callees = await this.backend.request('calls/outgoing', { entry });
        const calls = await Promise.all(
            callees.slice(0, MAX_HIERARCHY_ITEMS).map(async callee => {
                const calleeItem = await this.callItem(callee).catch(() => undefined);
                if (!calleeItem) {
                    return undefined;
                }

                return new vscode.CallHierarchyOutgoingCall(calleeItem, await this.callSites(callee.sites));
            }),
        );
        return calls.filter((call): call is vscode.CallHierarchyOutgoingCall => call !== undefined);
    }
}
