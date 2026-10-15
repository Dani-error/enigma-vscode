import * as vscode from 'vscode';
import { ClassItem, SymbolKind } from './engine/protocol';

export const symbolKind = (kind: SymbolKind) => {
    switch (kind) {
        case 'class': return vscode.SymbolKind.Class;
        case 'interface': return vscode.SymbolKind.Interface;
        case 'annotation': return vscode.SymbolKind.Interface;
        case 'enum': return vscode.SymbolKind.Enum;
        case 'record': return vscode.SymbolKind.Struct;
        case 'enumConstant': return vscode.SymbolKind.EnumMember;
        case 'field': return vscode.SymbolKind.Field;
        case 'method': return vscode.SymbolKind.Method;
        case 'constructor': return vscode.SymbolKind.Constructor;
        case 'parameter':
        case 'local': return vscode.SymbolKind.Variable;
        default: return vscode.SymbolKind.Object;
    }
}

export const classIcon = (item: Pick<ClassItem, 'kind' | 'abstract' | 'throwable'>) => {
    switch (item.kind) {
        case 'annotation':
        case 'interface':
        case 'enum':
        case 'record': return item.kind;
        default: return item.throwable ? 'exception' : item.abstract ? 'abstract' : 'class';
    }
}

let iconFolder: vscode.Uri | undefined;

/** Tells where the pictures of resources/icons are. Called once, when the extension starts. */
export const useIcons = (folder: vscode.Uri) => {
    iconFolder = folder;
}

export const treeIcon: (kind: SymbolKind | undefined) => vscode.Uri | vscode.ThemeIcon = (kind: SymbolKind | undefined) => {
    const name = kind && OWN_ICONS[kind];
    return name && iconFolder ? vscode.Uri.joinPath(iconFolder, `${name}.svg`) : themeIcon(kind);
}

/** The pictures of resources/icons, by what they are for. */
const OWN_ICONS: Partial<Record<SymbolKind, string>> = {
    class: 'class', interface: 'interface', enum: 'enum', annotation: 'annotation', record: 'record',
    method: 'method', constructor: 'constructor', field: 'field', enumConstant: 'field',
};

export const themeIcon = (kind: SymbolKind | 'package' | undefined) => {
    switch (kind) {
        case 'class': return new vscode.ThemeIcon('symbol-class');
        case 'interface':
        case 'annotation': return new vscode.ThemeIcon('symbol-interface');
        case 'enum': return new vscode.ThemeIcon('symbol-enum');
        case 'record': return new vscode.ThemeIcon('symbol-struct');
        case 'enumConstant': return new vscode.ThemeIcon('symbol-enum-member');
        case 'field': return new vscode.ThemeIcon('symbol-field');
        case 'method': return new vscode.ThemeIcon('symbol-method');
        case 'constructor': return new vscode.ThemeIcon('symbol-constructor');
        case 'parameter':
        case 'local': return new vscode.ThemeIcon('symbol-variable');
        case 'package': return new vscode.ThemeIcon('symbol-namespace');
        default: return new vscode.ThemeIcon('symbol-misc');
    }
}
