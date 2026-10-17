import { t } from '../l10n';
import { Change, ChangeKind, Editable, ErrorData, Problem, Task } from './protocol';

/** What the user may be kept from editing, in the words the panes already use for it. */
const EDITABLE: Record<Editable, () => string> = {
    class: () => t('common.class'),
    method: () => t('entryDescription.method'),
    field: () => t('entryDescription.field'),
    parameter: () => t('entryDescription.parameter'),
    local: () => t('entryDescription.localVariable'),
    javadoc: () => t('entryPage.javadoc'),
};

/** What went wrong, by the key of `RpcException.said` and `Backend.notifyUserOf`. */
const SAID: Record<Problem, (...args: string[]) => string> = {
    'no-jar': () => t('messages.noJarIsOpen'),
    'profile-not-found': path => t('messages.enigmaProfileNotFound', path),
    'profile-invalid': (path, reason) => t('messages.enigmaProfileInvalid', path, reason),
    'unknown-decompiler': id => t('messages.unknownDecompiler', id),
    'jar-not-found': path => t('messages.jarFileNotFound', path),
    'library-not-found': path => t('messages.libraryJarNotFound', path),
    'already-connected': () => t('messages.alreadyConnected'),
    'not-connected': () => t('messages.notConnected'),
    'connect-failed': (address, reason) => t('messages.couldNotConnectTo', address, reason),
    'server-start-failed': (port, reason) => t('messages.couldNotStartTheServerOn', port, reason),
    'unknown-mapping-format': format => t('messages.unknownMappingFormat', format),
    'mappings-not-found': path => t('messages.mappingsNotFound', path),
    'mappings-read-failed': (path, reason) => t('messages.couldNotReadMappings', path, reason),
    'mappings-from-server': () => t('messages.mappingsFromServer'),
    'no-mappings-file-to-save': () => t('messages.noMappingsFileIsOpenUse'),
    'no-mappings-file': () => t('messages.noMappingsFileIsOpen'),
    'save-while-connected': () => t('messages.mappingsCannotBeSavedWhileConnected'),
    'save-failed': reason => t('messages.failedToSaveMappings', reason),
    'auto-save-failed': reason => t('messages.autoSaveFailed', reason),
    'snapshot-failed': reason => t('messages.failedToWriteRecoverySnapshot', reason),
    'class-not-found': name => t('messages.classNotFoundInJar', name),
    'export-source-failed': (count, first) => t('messages.failedToWriteSourceFileS', count, first),
    'export-jar-failed': (path, reason) => t('messages.couldNotExportJar', path, reason),
    'editing-disabled': what =>
        t('messages.editingNamesIsDisabledByThe', (EDITABLE[what as Editable] as (() => string) | undefined)?.() ?? what),
    'not-renamable': () => t('messages.thisEntryCannotBeRenamed'),
    'nothing-to-undo': () => t('messages.nothingToUndo'),
    'nothing-to-redo': () => t('messages.nothingToRedo'),
};

/** What the engine is doing, by the key of Backend.progress. */
const TASKS: Record<Task, (...args: string[]) => string> = {
    'opening-jar': name => t('messages.opening', name),
    'opening-mappings': name => t('messages.openingMappings', name),
    'saving-mappings': () => t('messages.savingMappings'),
    'dropping-mappings': () => t('messages.droppingInvalidMappings'),
    'exporting-source': () => t('messages.exportingSource'),
    'exporting-jar': () => t('messages.exportingJar'),
    'generating-statistics': () => t('messages.generatingStatistics'),
};

/**
 * What the engine reported, in the language of the editor.
 * @param text what it sent as text: a message of Enigma, or the key with its values when there are no words here
 * @param said the key and the values, when the engine layer named what happened
 */
export function describeSaid(text: string, said?: ErrorData | { key?: Problem; args?: string[] }): string {
    // an engine that is newer than this may name what there are no words for here
    const words = said && 'key' in said && said.key ? (SAID[said.key] as (typeof SAID)[Problem] | undefined) : undefined;
    return words ? words(...(said && 'args' in said ? (said.args ?? []) : [])) : text;
}

/** What the engine is doing, in the language of the editor. */
export function describeTask(task: Task, args: string[] = []): string {
    const words = TASKS[task] as (typeof TASKS)[Task] | undefined;
    return words?.(...args) ?? [task, ...args].join(' ');
}

/** What the user did to the mappings, by the kind the engine names it with. */
const CHANGES: Record<ChangeKind, (...args: string[]) => string> = {
    'rename': (from, to) => t('changes.rename', from, to),
    'edit-javadoc': name => t('changes.editJavadoc', name),
    'mark-deobfuscated': name => t('changes.markDeobfuscated', name),
    'reset-obfuscated': name => t('changes.resetObfuscated', name),
    'rename-package': (from, to) => t('changes.renamePackage', from, to),
    'move-package': (from, to) => t('changes.movePackage', from, to),
};

/** A change of the mappings, for "Undo ..." and "Redo ...", in the language of the editor. */
export function describeChange(change: Change | null | undefined): string {
    const words = change ? (CHANGES[change.kind] as (typeof CHANGES)[ChangeKind] | undefined) : undefined;
    return change && words ? words(...change.args) : change ? [change.kind, ...change.args].join(' ') : '';
}
