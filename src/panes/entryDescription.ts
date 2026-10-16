import { EntryInfo, SymbolKind, TokenInfo } from '../engine/protocol';
import { Fact, PaneEntry } from './messages';
import { t } from '../l10n';

// a map rather than an object: "constructor" is one of the kinds
const kinds = () => new Map<SymbolKind, [label: string, icon: string]>([
    ['class', [t('common.class'), 'symbol-class']],
    ['interface', [t('common.interface'), 'symbol-interface']],
    ['annotation', [t('common.annotation'), 'symbol-interface']],
    ['enum', [t('common.enum'), 'symbol-enum']],
    ['record', [t('common.record'), 'symbol-struct']],
    ['enumConstant', [t('entryDescription.enumConstant'), 'symbol-enum-member']],
    ['field', [t('entryDescription.field'), 'symbol-field']],
    ['method', [t('entryDescription.method'), 'symbol-method']],
    ['constructor', [t('entryDescription.constructor'), 'symbol-constructor']],
    ['parameter', [t('entryDescription.parameter'), 'symbol-parameter']],
    ['local', [t('entryDescription.localVariable'), 'symbol-variable']],
]);

const dotted = (name: string) => name.replace(/\//g, '.');

export const describeEntry = (info: EntryInfo | TokenInfo): PaneEntry => {
    const [kindLabel, icon] = kinds().get(info.kind) ?? [info.kind, 'symbol-misc'];
    const entry = info.entry;
    const isClass = entry.kind === 'class';
    const isMethod = entry.kind === 'method';
    const isConstructor = info.kind === 'constructor';
    const text = 'text' in info ? info.text : undefined;

    let state: PaneEntry['state'];
    let stateLabel: string;
    if (!info.inJar && entry.kind !== 'local') {
        state = 'library';
        stateLabel = t('entryDescription.library');
    } else if (info.tokenType === 'deobfuscated') {
        state = 'deobfuscated';
        stateLabel = t('common.mapped');
    } else if (info.tokenType === 'jar_proposed' || info.tokenType === 'dynamic_proposed') {
        state = 'proposed';
        stateLabel = t('common.proposed');
    } else {
        state = 'obfuscated';
        stateLabel = t('common.notMapped');
    }

    const facts: Fact[] = [];
    if (entry.kind === 'local') {
        facts.push({ label: t('entryDescription.index'), value: String(info.index ?? entry.index) });
        if (info.owner) {
            facts.push({ label: t('entryDescription.declaredIn'), value: `${dotted(info.owner)}${info.method ? `.${info.method}` : ''}` });
        }

        if (info.type) {
            facts.push({ label: t('entryDescription.type'), value: info.type, mono: true });
        }
    } else {
        facts.push({ label: t('common.obfuscated'), value: info.obfName, mono: true, copy: true });
        if (info.owner) {
            facts.push({ label: t('entryDescription.declaredIn'), value: dotted(info.owner) });
        }

        if (isClass) {
            if (info.outerClass) {
                facts.push({ label: t('entryDescription.outerClass'), value: dotted(info.outerClass) });
            }

            if (info.superClass && info.superClass !== 'java/lang/Object') {
                facts.push({ label: t('entryDescription.extends'), value: dotted(info.superClass) });
            }

            if (info.interfaces && info.interfaces.length > 0) {
                facts.push({ label: t('entryDescription.implements'), value: info.interfaces.map(dotted).join(', ') });
            }
        } else if (info.type) {
            facts.push({ label: isMethod ? t('entryDescription.signature') : t('entryDescription.type'), value: info.type, mono: true });
        }

        if (info.descriptor) {
            facts.push({ label: t('entryDescription.descriptor'), value: info.descriptor, mono: true, copy: true });
        }
    }

    if (info.modifiers.length > 0) {
        facts.push({ label: t('entryDescription.modifiers'), value: info.modifiers.join(' ') });
    }

    if (info.sourcePluginId) {
        facts.push({ label: t('entryDescription.proposedBy'), value: info.sourcePluginId, mono: true });
    }

    const name = info.renameName || text || info.name;
    const topLevelClass = isClass && !entry.name.includes('$') || (isConstructor && entry.kind === 'method' && !entry.owner.includes('$'));
    let lockedReason: string | undefined;
    if (!info.renamable) {
        lockedReason = !info.inJar && entry.kind !== 'local' ? t('entryDescription.notPartOfTheJarIt')
            : entry.kind === 'local' && !entry.parameter ? t('common.enigmaCannotRenameLocalVariablesOnly')
                : t('entryDescription.thisNameCannotBeChangedIt');
    }

    const actions: PaneEntry['actions'] = [];
    if (info.navigable) {
        actions.push({ id: 'declaration', label: t('entryDescription.declaration'), icon: 'go-to-file', title: t('entryDescription.goToTheDeclaration') });
    }

    if (isClass || isMethod) {
        actions.push({ id: 'inheritance', label: t('common.inheritance'), icon: 'type-hierarchy-sub', title: t('entryDescription.showWhereThisIsInheritedAnd') });
    }

    if ((isClass || isMethod) && !isConstructor) {
        actions.push({ id: 'implementations', label: t('common.implementations'), icon: 'symbol-interface', title: t('entryDescription.showWhatImplementsThis') });
    }

    if (entry.kind !== 'local' && info.inJar) {
        actions.push({ id: 'calls', label: t('common.calls'), icon: 'call-incoming', title: t('entryDescription.showWhatReferencesThis') });
    }

    return {
        key: JSON.stringify(entry),
        kind: info.kind,
        kindLabel,
        icon,
        name,
        displayName: info.simpleName || text || info.name,
        state,
        stateLabel,
        renamable: info.renamable,
        nameHint: topLevelClass
            ? t('entryDescription.enterToRenameUseToSeparate')
            : isConstructor ? t('entryDescription.enterToRenameTheClass') : t('entryDescription.enterToRenameEveryUseOf'),
        lockedReason,
        documentable: info.documentable,
        javadoc: info.javadoc ?? '',
        facts,
        toggle: info.renamable
            ? info.tokenType === 'deobfuscated'
                ? { label: t('entryDescription.resetToObfuscated'), title: t('entryDescription.removeThisNameFromTheMappings') }
                : { label: t('entryDescription.markAsDeobfuscated'), title: t('entryDescription.keepTheCurrentNameAsIts') }
            : null,
        actions,
    };
}
