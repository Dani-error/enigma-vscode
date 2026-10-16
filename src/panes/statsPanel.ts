import * as path from 'node:path';
import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { ClassIndex } from '../documents/classIndex';
import { ClassEditors } from '../documents/classEditors';
import { OpenState, StatsResult } from '../engine/protocol';
import { settings } from '../config';
import { FromStatsPage, StatsOptions, ToStatsPage } from './messages';
import { page, problemOf, webviewOptions } from './webview';
import { t } from '../l10n';

/**
 * The "Mapping Statistics" page: Enigma's stats dialogue and what its diagram shows, kept up to date while mapping.
 */
export class StatsPanel implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private request = 0;
    private staleTimer?: NodeJS.Timeout;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly backend: Backend,
        private readonly index: ClassIndex,
        private readonly editors: ClassEditors,
        private readonly state: () => OpenState | undefined,
    ) {
        this.disposables.push(
            backend.onDidChangeMappings(() => {
                // recount once the user pauses, and only if the page is being looked at
                clearTimeout(this.staleTimer);
                this.staleTimer = setTimeout(() => {
                    if (this.panel?.visible) {
                        this.post({ type: 'stale' });
                    }
                }, 1500);
            }),
            backend.onDidChangeProject(state => {
                if (!state.jarPath) {
                    this.panel?.dispose();
                }
            }),
        );
    }

    private post(message: ToStatsPage): void {
        void this.panel?.webview.postMessage(message);
    }

    private defaults(): StatsOptions {
        return {
            types: ['classes', 'methods', 'fields', 'parameters'],
            package: this.context.workspaceState.get<string>('enigma.stats.package') ?? '',
            ...settings.statistics,
        };
    }

    show(): void {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel('enigma.stats', t('common.mappingStatistics'), vscode.ViewColumn.Active, {
            ...webviewOptions(this.context.extensionUri),
            retainContextWhenHidden: true,
        });
        this.panel = panel;
        panel.iconPath = new vscode.ThemeIcon('graph');
        panel.webview.html = page(panel.webview, this.context.extensionUri, 'stats', t('common.mappingStatistics'));
        panel.webview.onDidReceiveMessage((message: FromStatsPage) => void this.onMessage(message), undefined, this.disposables);
        panel.onDidDispose(
            () => {
                this.panel = undefined;
            },
            undefined,
            this.disposables,
        );
    }

    /** Counts with the given options. Public so that tests can act as the web view. */
    async generate(options: StatsOptions): Promise<StatsResult> {
        return this.backend.request('stats/generate', {
            types: options.types,
            topLevelPackage: options.package.replace(/\./g, '/'),
            includeSynthetic: options.includeSynthetic,
            countFallback: options.countFallback,
        });
    }

    private async onMessage(message: FromStatsPage): Promise<void> {
        switch (message.type) {
            case 'ready': {
                const options = this.defaults();
                const jar = this.state()?.jarPath;
                this.post({ type: 'state', state: { jarName: jar ? path.basename(jar) : '', options, loading: true } });
                await this.count(options);
                break;
            }

            case 'generate':
                await this.context.workspaceState.update('enigma.stats.package', message.options.package);
                await this.count(message.options);
                break;
            case 'open': {
                // leaves of the tree are top-level classes, by their current name
                const item = this.index.byName(message.name.replace(/\./g, '/'));
                if (item) {
                    await this.editors.openClass(item.obf);
                }

                break;
            }
        }
    }

    private async count(options: StatsOptions): Promise<void> {
        const request = ++this.request;
        try {
            const stats = await this.generate(options);
            if (request === this.request) {
                this.post({ type: 'result', stats });
            }
        } catch (error) {
            if (request === this.request) {
                this.post({ type: 'result', error: problemOf(error).message });
            }
        }
    }

    dispose(): void {
        clearTimeout(this.staleTimer);
        this.panel?.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
