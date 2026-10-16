import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { ClassIndex } from '../documents/classIndex';
import { parseClassUri, toRange } from '../documents/classUri';
import { EnigmaDocuments } from '../documents/documents';
import { SearchResult, topLevelClassOf } from '../engine/protocol';
import { declarationOf } from './declarations';
import { symbolKind } from '../kinds';

/**
 * The names of the jar as the editor's symbols.
 */
export class SymbolProvider implements vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider<vscode.SymbolInformation> {
    private readonly searchResults = new WeakMap<vscode.SymbolInformation, SearchResult>();

    constructor(
        private readonly backend: Backend,
        private readonly index: ClassIndex,
        private readonly documents: EnigmaDocuments,
        private readonly isOpen: () => boolean,
    ) {}

    async provideDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
        const parsed = parseClassUri(document.uri);
        if (!parsed || !this.isOpen()) {
            return [];
        }

        // make sure the positions asked for are those of the text the editor has
        if (!this.documents.source(document.uri)) {
            return [];
        }

        const symbols = (await this.backend.request('class/symbols', parsed)) ?? [];
        const lastLine = Math.max(0, document.lineCount - 1);
        const created: vscode.DocumentSymbol[] = [];
        const roots: vscode.DocumentSymbol[] = [];
        for (const symbol of symbols) {
            const range = toRange(symbol.range);
            const item = new vscode.DocumentSymbol(symbol.name || '<unnamed>', symbol.detail ?? '', symbolKind(symbol.kind), range, range);
            created.push(item);
            const parent = symbol.parent !== null ? created[symbol.parent] : undefined;
            (parent ? parent.children : roots).push(item);
        }

        // The engine knows where names are, not where bodies end. Approximate: a symbol extends until its next sibling.
        const extend = (items: vscode.DocumentSymbol[], end: vscode.Position) => {
            items.sort((a, b) => a.selectionRange.start.compareTo(b.selectionRange.start));
            items.forEach((item, i) => {
                const next = items[i + 1];
                const itemEnd = next
                    ? new vscode.Position(
                          Math.max(item.selectionRange.end.line, next.selectionRange.start.line - 1),
                          Number.MAX_SAFE_INTEGER,
                      )
                    : end;
                const clamped = itemEnd.isBefore(item.selectionRange.end) ? item.selectionRange.end : itemEnd;
                item.range = new vscode.Range(item.selectionRange.start, clamped);
                extend(
                    item.children.filter(child => item.range.contains(child.selectionRange)),
                    clamped,
                );
            });
        };
        extend(roots, new vscode.Position(lastLine, Number.MAX_SAFE_INTEGER));
        return roots;
    }

    async provideWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
        if (!this.isOpen() || query.trim().length === 0) {
            return [];
        }

        const results = await this.backend.request('search', { query, limit: 100 });
        return results.map(result => {
            const uri = this.index.uri(topLevelClassOf(result.entry));
            const symbol = new vscode.SymbolInformation(
                result.name + (result.kind === 'method' ? (result.detail ?? '') : ''),
                symbolKind(result.kind),
                (result.container ?? '').replace(/\//g, '.'),
                new vscode.Location(uri, new vscode.Position(0, 0)),
            );
            this.searchResults.set(symbol, result);
            return symbol;
        });
    }

    async resolveWorkspaceSymbol(symbol: vscode.SymbolInformation): Promise<vscode.SymbolInformation> {
        const result = this.searchResults.get(symbol);
        if (result) {
            const location = await declarationOf(this.backend, this.index, result.entry).catch(() => undefined);
            if (location) {
                symbol.location = location;
            }
        }

        return symbol;
    }
}
