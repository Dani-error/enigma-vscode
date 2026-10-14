import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { ClassIndex } from '../documents/classIndex';
import { SCHEME } from '../documents/classUri';
import { EnigmaDocuments } from '../documents/documents';
import { Editing } from '../project/editing';
import { HierarchyProvider } from './hierarchies';
import { NavigationProvider } from './navigation';
import { RenameProvider } from './rename';
import { SymbolProvider } from './symbols';

const SELECTOR: vscode.DocumentSelector = { scheme: SCHEME };

/**
 * Connects the engine to the editor's own features, so that renaming, navigation, hierarchies and symbol search work
 * on decompiled classes through the standard editor commands.
 */
export function registerLanguageFeatures(backend: Backend, index: ClassIndex, documents: EnigmaDocuments, editing: Editing, isOpen: () => boolean): vscode.Disposable {
    const navigation = new NavigationProvider(backend, index, documents);
    const hierarchies = new HierarchyProvider(backend, index, documents);
    const symbols = new SymbolProvider(backend, index, documents, isOpen);
    return vscode.Disposable.from(
        vscode.languages.registerRenameProvider(SELECTOR, new RenameProvider(documents, editing)),
        vscode.languages.registerDefinitionProvider(SELECTOR, navigation),
        vscode.languages.registerReferenceProvider(SELECTOR, navigation),
        vscode.languages.registerHoverProvider(SELECTOR, navigation),
        vscode.languages.registerDocumentSymbolProvider(SELECTOR, symbols, { label: 'Enigma' }),
        vscode.languages.registerImplementationProvider(SELECTOR, navigation),
        vscode.languages.registerTypeHierarchyProvider(SELECTOR, hierarchies),
        vscode.languages.registerCallHierarchyProvider(SELECTOR, hierarchies),
        vscode.languages.registerDocumentHighlightProvider(SELECTOR, navigation),
        vscode.languages.registerWorkspaceSymbolProvider(symbols),
    );
}
