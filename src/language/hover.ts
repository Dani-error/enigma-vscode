import * as vscode from 'vscode';
import { EntryInfo, TokenInfo } from '../engine/protocol';
import { t } from '../l10n';

const describeMapping = (info: EntryInfo) => {
    switch (info.tokenType) {
        case 'obfuscated':
            return t('hover.notMapped');
        case 'deobfuscated':
            return t('hover.mapped');
        case 'jar_proposed':
            return info.sourcePluginId
                ? t('hover.proposedFromTheBytecodeBy', `\`${info.sourcePluginId}\``)
                : t('hover.proposedFromTheBytecode');
        case 'dynamic_proposed':
            return info.sourcePluginId
                ? t('hover.proposedFromOtherMappingsBy', `\`${info.sourcePluginId}\``)
                : t('hover.proposedFromOtherMappings');
        default:
            return info.tokenType;
    }
};

/** The contents of Enigma's identifier panel and entry tooltip, as a hover. */
export function hoverMarkdown(info: TokenInfo | EntryInfo): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    const modifiers = info.modifiers.length > 0 ? info.modifiers.join(' ') + ' ' : '';
    // Java as it is written: the hover shows a declaration
    const kind = info.kind === 'annotation' ? '@interface' : info.kind;

    let signature: string;
    if (info.entry.kind === 'class') {
        signature = `${modifiers}${kind} ${info.fullName.replace(/\//g, '.')}`;
    } else if (info.entry.kind === 'method') {
        signature = `${modifiers}${info.simpleName}${info.type ?? ''}`;
    } else {
        signature = `${modifiers}${info.name || ('text' in info ? info.text : '')}${info.type ? `: ${info.type}` : ''}`;
    }

    markdown.appendCodeblock(signature, 'java');

    const rows: string[] = [];
    if (info.owner) {
        const owner = `\`${info.owner.replace(/\//g, '.')}\``;
        rows.push(info.method ? t('hover.declaredInMethod', owner, `\`${info.method}\``) : t('hover.declaredIn', owner));
    }

    if (info.entry.kind === 'class') {
        if (info.superClass && info.superClass !== 'java/lang/Object') {
            rows.push(t('hover.extends', `\`${info.superClass.replace(/\//g, '.')}\``));
        }

        if (info.interfaces && info.interfaces.length > 0) {
            rows.push(t('hover.implements', info.interfaces.map(name => `\`${name.replace(/\//g, '.')}\``).join(', ')));
        }
    }

    const obfuscated =
        info.entry.kind === 'local'
            ? t('hover.index', info.index)
            : `\`${info.obfName}\`${info.descriptor ? ` \`${info.descriptor}\`` : ''}`;
    rows.push(t('hover.obfuscated', obfuscated, describeMapping(info)));
    if (!info.inJar && info.entry.kind !== 'local') {
        rows.push(`_${t('hover.notPartOfTheJarCannot')}_`);
    }

    markdown.appendMarkdown(rows.join('  \n'));
    if (info.javadoc) {
        markdown.appendMarkdown('\n\n---\n\n');
        markdown.appendText(info.javadoc);
    }

    // what can be done with the name, one click away
    const links: string[] = [];
    const link = (label: string, command: string) =>
        links.push(`[${label}](command:${command}?${encodeURIComponent(JSON.stringify([info.entry]))})`);
    if (info.renamable) {
        links.push(`[${t('common.rename')}](command:editor.action.rename)`);
        link(info.tokenType === 'deobfuscated' ? t('hover.reset') : t('hover.markAsDeobfuscated'), 'enigma.toggleMapping');
    }

    if (info.documentable) {
        links.push('[Javadoc](command:enigma.editJavadoc)');
    }

    if (info.inJar && info.entry.kind !== 'local') {
        if (info.entry.kind !== 'field') {
            link(t('common.inheritance'), 'enigma.showInheritance');
        }

        link(t('common.calls'), 'enigma.showCalls');
    }

    if (links.length > 0) {
        markdown.appendMarkdown(`\n\n---\n\n${links.join(' · ')}`);
        markdown.isTrusted = {
            enabledCommands: [
                'editor.action.rename',
                'enigma.toggleMapping',
                'enigma.editJavadoc',
                'enigma.showInheritance',
                'enigma.showCalls',
            ],
        };
    }

    return markdown;
}
