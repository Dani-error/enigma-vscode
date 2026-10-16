import * as vscode from 'vscode';
import { Enigma } from '../enigma';
import { themeIcon } from '../kinds';
import { SearchResult, SearchType } from '../engine/protocol';
import { Register, Targets } from './registry';
import { t } from '../l10n';

/** Enigma's search dialogue: classes, methods and fields by part of their name, ranked by the engine. */
export const registerSearchCommands = (register: Register, targets: Targets, { backend, editors, reporter }: Enigma) => {
    const search = (types: SearchType[], title: string) => {
        if (!targets.requireProject()) {
            return;
        }

        const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { result?: SearchResult }>();
        quickPick.title = title;
        quickPick.placeholder = t('searchCommands.typePartOfAnObfuscatedOr');
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        let request = 0;
        let timer: NodeJS.Timeout | undefined;

        const update = () => {
            const query = quickPick.value.trim();
            const current = ++request;
            if (query.length === 0) {
                quickPick.items = [];
                return;
            }

            quickPick.busy = true;
            backend.request('search', { query, types, limit: 150 }).then(
                results => {
                    if (current !== request) {
                        return;
                    }

                    // the engine has ranked the results already; keep its order instead of letting the picker re-filter
                    quickPick.items = results.map(result => ({
                        label: `$(${themeIcon(result.kind).id}) ${result.name}${result.kind === 'method' ? (result.detail ?? '') : ''}`,
                        description: [result.deobfuscated ? result.obfName : undefined, result.kind === 'field' ? result.detail : undefined]
                            .filter(Boolean)
                            .join('  '),
                        detail: (result.container ?? '').replace(/\//g, '.') || undefined,
                        alwaysShow: true,
                        result,
                    }));
                    quickPick.busy = false;
                },
                error => {
                    quickPick.busy = false;
                    reporter.report(error);
                },
            );
        };

        quickPick.onDidChangeValue(() => {
            clearTimeout(timer);
            timer = setTimeout(update, 120);
        });
        quickPick.onDidAccept(async () => {
            const result = quickPick.selectedItems[0]?.result;
            quickPick.hide();
            if (result) {
                void backend.request('search/hit', { id: result.id }).catch(() => undefined);
                await editors.navigate(result.entry).catch(error => reporter.report(error));
            }
        });
        quickPick.onDidHide(() => {
            clearTimeout(timer);
            quickPick.dispose();
        });
        quickPick.show();
    };

    register('enigma.search', () => search([], t('searchCommands.searchAll')));
    register('enigma.searchClasses', () => search(['class'], t('searchCommands.searchClasses')));
    register('enigma.searchMethods', () => search(['method'], t('searchCommands.searchMethods')));
    register('enigma.searchFields', () => search(['field'], t('searchCommands.searchFields')));
};
