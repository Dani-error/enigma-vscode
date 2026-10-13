import { t } from '../l10n';
import { ErrorData, Problem, Task } from './protocol';

/** What went wrong, by the key of `RpcException.said` and `Backend.notifyUserOf`. */
const SAID: Record<Problem, (...args: string[]) => string> = {
    'no-jar': () => t('messages.noJarIsOpen'),
    'profile-not-found': path => t('messages.enigmaProfileNotFound', path),
    'unknown-decompiler': id => t('messages.unknownDecompiler', id),
    'jar-not-found': path => t('messages.jarFileNotFound', path),
    'library-not-found': path => t('messages.libraryJarNotFound', path),
    'already-connected': () => t('messages.alreadyConnected'),
    'not-connected': () => t('messages.notConnected'),
    'connect-failed': (address, reason) => t('messages.couldNotConnectTo', address, reason),
    'server-start-failed': (port, reason) => t('messages.couldNotStartTheServerOn', port, reason),
    'unknown-mapping-format': format => t('messages.unknownMappingFormat', format),
    'mappings-not-found': path => t('messages.mappingsNotFound', path),
    'no-mappings-file-to-save': () => t('messages.noMappingsFileIsOpenUse'),
    'no-mappings-file': () => t('messages.noMappingsFileIsOpen'),
    'save-while-connected': () => t('messages.mappingsCannotBeSavedWhileConnected'),
    'save-failed': reason => t('messages.failedToSaveMappings', reason),
    'auto-save-failed': reason => t('messages.autoSaveFailed', reason),
    'snapshot-failed': reason => t('messages.failedToWriteRecoverySnapshot', reason),
    'class-not-found': name => t('messages.classNotFoundInJar', name),
    'export-source-failed': (count, first) => t('messages.failedToWriteSourceFileS', count, first),
    'editing-disabled': what => t('messages.editingNamesIsDisabledByThe', what),
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
    const words = said && 'key' in said && said.key ? SAID[said.key] as typeof SAID[Problem] | undefined : undefined;
    return words ? words(...(said && 'args' in said ? said.args ?? [] : [])) : text;
}

/** What the engine is doing, in the language of the editor. */
export function describeTask(task: Task, args: string[] = []): string {
    const words = TASKS[task] as typeof TASKS[Task] | undefined;
    return words?.(...args) ?? [task, ...args].join(' ');
}
