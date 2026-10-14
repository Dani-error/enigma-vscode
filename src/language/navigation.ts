import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { ClassIndex } from '../documents/classIndex';
import { parseClassUri, toRange } from '../documents/classUri';
import { EnigmaDocuments } from '../documents/documents';
import { EntryRef, TreeNodeResult } from '../engine/protocol';
import { settings } from '../config';
import { declarationOf } from './declarations';
import { hoverMarkdown } from './hover';
import { t } from '../l10n';

/** How many classes are decompiled at most to answer one request for implementations. */
const MAX_IMPLEMENTATIONS = 80;

/**
 * Getting around from a name in the code: its declaration, its references, its implementations, its other
 * occurrences in the class, and what the engine knows about it.
 */
export class NavigationProvider implements
    vscode.DefinitionProvider, vscode.ReferenceProvider, vscode.DocumentHighlightProvider, vscode.HoverProvider, vscode.ImplementationProvider {
    constructor(private readonly backend: Backend, private readonly index: ClassIndex, private readonly documents: EnigmaDocuments) {
    }

    async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location | undefined> {
        const location = await this.documents.atPosition(document, position, 'nav/definition');
        return location ? this.index.location(location) : undefined;
    }

    async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext): Promise<vscode.Location[]> {
        const limit = settings.maxReferenceClasses;
        const result = await this.documents.atPosition(document, position, 'nav/references', { includeDeclaration: context.includeDeclaration, limit });
        if (!result) {
            return [];
        }

        if (result.truncated) {
            vscode.window.setStatusBarMessage(t('navigation.enigmaOnlyTheFirstReferencingClasses', result.searchedClasses), 8000);
        }

        return result.locations.flatMap(location => {
            const uri = this.index.uri(location.class, location.view, location.deobfName);
            return location.ranges.map(range => new vscode.Location(uri, toRange(range)));
        });
    }

    /** Highlights the other occurrences of the entry under the cursor in the same class. */
    async provideDocumentHighlights(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DocumentHighlight[]> {
        const parsed = parseClassUri(document.uri);
        const token = await this.documents.tokenAt(document, position);
        if (!parsed || !token) {
            return [];
        }

        const result = await this.documents.atPosition(document, position, 'nav/references', { includeDeclaration: true, limit: 1 });
        const here = result?.locations.find(location => location.class === parsed.class);
        return (here?.ranges ?? [token.range]).map(range => new vscode.DocumentHighlight(toRange(range)));
    }

    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        const token = await this.documents.tokenAt(document, position);
        return token ? new vscode.Hover(hoverMarkdown(token), toRange(token.range)) : undefined;
    }

    async provideImplementation(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
        const token = await this.documents.tokenAt(document, position);
        if (!token || (token.entry.kind !== 'class' && token.entry.kind !== 'method')) {
            return [];
        }

        const result = await this.backend.request('hierarchy/implementations', { entry: token.entry });
        const entries: EntryRef[] = [];
        const collect = (node: TreeNodeResult, isRoot: boolean) => {
            if (!isRoot && node.entry && node.navigable !== false && entries.length < MAX_IMPLEMENTATIONS) {
                entries.push(node.entry);
            }

            node.children.forEach(child => collect(child, false));
        };
        if (result.root) {
            collect(result.root, true);
        }

        const locations = await Promise.all(entries.map(entry => declarationOf(this.backend, this.index, entry).catch(() => undefined)));
        return locations.filter((location): location is vscode.Location => location !== undefined);
    }
}
