import * as os from 'node:os';
import * as vscode from 'vscode';
import { Backend } from '../engine/backend';
import { CollabMessage, CollabState } from '../engine/protocol';
import { settings } from '../config';
import { FromCollabPage, LoggedMessage, ToCollabPage } from './messages';
import { page, problemOf, webviewOptions } from './webview';
import { t } from '../l10n';

const MAX_MESSAGES = 500;

/**
 * The "Collaboration" pane: Enigma's connect and host dialogues, its user list and its message log, with a chat box.
 */
export class CollabPane implements vscode.WebviewViewProvider, vscode.Disposable {
    static readonly viewId = 'enigma.collab';

    private view?: vscode.WebviewView;
    private state: CollabState = { state: 'not_connected', users: [] };
    private messages: LoggedMessage[] = [];
    private session: { self?: string; port?: number; address?: string } = {};
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly backend: Backend,
        private readonly isOpen: () => boolean,
        private readonly confirmDiscard: (action: string) => Promise<boolean>,
    ) {
        this.disposables.push(
            vscode.window.registerWebviewViewProvider(CollabPane.viewId, this, { webviewOptions: { retainContextWhenHidden: true } }),
            backend.onDidChangeCollabState(state => {
                if (state.state === 'not_connected' && this.state.state !== 'not_connected') {
                    this.messages = [];
                    this.session = {};
                }

                this.state = state;
                this.send();
            }),
            backend.onCollabMessage(message => this.onCollabMessage(message)),
            backend.onDidChangeProject(() => this.send()),
            backend.onDidExit(() => {
                this.state = { state: 'not_connected', users: [] };
                this.messages = [];
                this.session = {};
                this.send();
            }),
        );
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = webviewOptions(this.context.extensionUri);
        view.webview.html = page(view.webview, this.context.extensionUri, 'collab', t('collabPane.collaboration'));
        view.webview.onDidReceiveMessage((message: FromCollabPage) => void this.onMessage(message), undefined, this.disposables);
        view.onDidDispose(() => {
            this.view = undefined;
        }, undefined, this.disposables);
        this.updateBadge();
    }

    get users(): string[] {
        return this.state.users;
    }

    get log(): LoggedMessage[] {
        return this.messages;
    }

    private updateBadge(): void {
        if (this.view) {
            const others = this.state.state === 'not_connected' ? 0 : this.state.users.length;
            this.view.badge = others > 0 ? { value: others, tooltip: t('collabPane.connected', others) } : undefined;
            this.view.description = this.state.state === 'hosting' ? t('collabPage.hosting') : this.state.state === 'connected' ? t('collabPage.connected') : undefined;
        }
    }

    private post(message: ToCollabPage): void {
        void this.view?.webview.postMessage(message);
    }

    private send(): void {
        this.updateBadge();
        this.post({
            type: 'state',
            state: {
                projectOpen: this.isOpen(),
                connection: this.state.state,
                users: this.state.users,
                messages: this.messages,
                self: this.session.self,
                port: this.session.port,
                address: this.session.address,
                defaults: {
                    username: this.context.globalState.get<string>('enigma.collab.username') ?? os.userInfo().username,
                    address: this.context.globalState.get<string>('enigma.collab.address') ?? '',
                    port: this.context.globalState.get<number>('enigma.collab.port') ?? 34712,
                },
            },
        });
    }

    private onCollabMessage(message: CollabMessage): void {
        const logged: LoggedMessage = { ...message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        if (message.type === 'chat') {
            const prefix = `${message.user}: `;
            logged.body = message.text.startsWith(prefix) ? message.text.substring(prefix.length) : message.text;
        }

        this.messages.push(logged);
        if (this.messages.length > MAX_MESSAGES) {
            this.messages.splice(0, this.messages.length - MAX_MESSAGES);
        }

        this.send();

        const level = settings.serverNotifications;
        const visible = this.view?.visible ?? false;
        if (!visible && message.user !== this.session.self && level !== 'none' && (message.type !== 'chat' || level === 'full')) {
            if (message.type === 'chat' || message.type === 'connect' || message.type === 'disconnect') {
                vscode.window.setStatusBarMessage(`$(comment-discussion) ${message.text}`, 6000);
            }
        }
    }

    /** Brings the pane up, on its form to join or to host. */
    async reveal(): Promise<void> {
        await vscode.commands.executeCommand(`${CollabPane.viewId}.focus`);
    }

    /** Handles a message of the web view. Public so that tests can act as the web view. */
    async onMessage(message: FromCollabPage): Promise<void> {
        switch (message.type) {
            case 'ready':
                this.send();
                break;
            case 'connect':
            case 'host':
                try {
                    const { username, password } = message;
                    await this.context.globalState.update('enigma.collab.username', username);
                    if (message.type === 'connect') {
                        if (!await this.confirmDiscard(t('collabPane.doYouWantToSaveThem'))) {
                            this.post({ type: 'failed', message: t('collabPane.notConnectedYourMappingsHaveUnsaved') });
                            return;
                        }

                        await this.context.globalState.update('enigma.collab.address', message.address);
                        this.session = { self: username, address: message.address };
                        await this.backend.request('collab/connect', { username, address: message.address, password });
                    } else {
                        await this.context.globalState.update('enigma.collab.port', message.port);
                        this.session = { self: username, port: message.port };
                        await this.backend.request('collab/host', { username, port: message.port, password });
                    }

                    this.send();
                } catch (error) {
                    this.session = {};
                    this.post({ type: 'failed', message: problemOf(error).message });
                }

                break;
            case 'disconnect':
                await this.backend.request('collab/disconnect').then(undefined, error => void vscode.window.showErrorMessage(`Enigma: ${problemOf(error).message}`));
                break;
            case 'chat':
                await this.backend.request('collab/sendMessage', { text: message.text }).then(undefined, error => void vscode.window.showErrorMessage(`Enigma: ${problemOf(error).message}`));
                break;
            case 'navigate':
                await vscode.commands.executeCommand('enigma.navigateTo', message.entry);
                break;
        }
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
    }
}
