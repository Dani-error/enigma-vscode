import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as vscode from 'vscode';
import { settings } from '../config';
import { t } from '../l10n';
import { INSTRUCTIONS } from './catalog';
import { AiTool, toText } from './tools';

const TOKEN_KEY = 'enigma.mcp.token';
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface RpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: { protocolVersion?: unknown; name?: unknown; arguments?: unknown };
}

/**
 * Gives the tools to assistants outside the editor, such as Claude Code, over the Model Context Protocol.
 *
 * It is the extension that answers, because it is what talks to the engine: an assistant sees the jar as the user
 * has it open, with the names given so far, and what it renames shows up in the editor at once. The server is a
 * small HTTP endpoint ("streamable HTTP" in the protocol's terms, answering each request directly). It listens on
 * this machine only, and only to who has its token; it is off until the user turns it on.
 */
export class McpServer implements vscode.Disposable {
    private server?: http.Server;
    private listening?: number;
    private token?: string;
    private readonly disposables: vscode.Disposable[];

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly tools: AiTool[],
        private readonly output: vscode.LogOutputChannel,
    ) {
        this.disposables = [
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('enigma.mcp')) {
                    void this.apply();
                }
            }),
        ];
        void this.apply();
    }

    /** The port the server listens on, if it is running. */
    get port(): number | undefined {
        return this.listening;
    }

    /** What a client has to send to be let in. Made once per installation and kept with the editor's secrets. */
    async secret(): Promise<string> {
        this.token ??= await this.context.secrets.get(TOKEN_KEY);
        if (!this.token) {
            this.token = crypto.randomBytes(24).toString('hex');
            await this.context.secrets.store(TOKEN_KEY, this.token);
        }

        return this.token;
    }

    /** Starts or stops the server as the settings say. */
    async apply(): Promise<void> {
        const wanted = settings.mcpEnabled ? settings.mcpPort : undefined;
        if (wanted === this.listening) {
            return;
        }

        await this.stop();
        if (wanted === undefined) {
            return;
        }

        await this.secret();
        const server = http.createServer((request, response) => void this.serve(request, response));
        try {
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(wanted, '127.0.0.1', resolve);
            });
        } catch (error) {
            const busy = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
            this.output.warn(`MCP server not started on port ${wanted}: ${error instanceof Error ? error.message : String(error)}`);
            void vscode.window.showWarningMessage(
                busy
                    ? t('mcpServer.enigmaPortIsInUseSo', wanted)
                    : t('mcpServer.enigmaTheMcpServerCouldNot', error instanceof Error ? error.message : String(error)),
            );
            return;
        }

        this.server = server;
        this.listening = wanted;
        this.output.info(`MCP server listening on http://127.0.0.1:${wanted}/mcp`);
    }

    private async stop(): Promise<void> {
        const server = this.server;
        this.server = undefined;
        this.listening = undefined;
        if (server) {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    }

    private async serve(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
        const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
            response.writeHead(status, body === undefined ? headers : { 'Content-Type': 'application/json', ...headers });
            response.end(body === undefined ? undefined : JSON.stringify(body));
        };

        // A page in a browser can reach this machine's ports too. It cannot know the token, but it gets no further
        // than this either way.
        const origin = request.headers.origin;
        if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1])(:\d+)?$/.test(origin)) {
            return send(403, { error: 'Requests from web pages are not accepted.' });
        }

        if (new URL(request.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') {
            return send(404, { error: 'The MCP endpoint is /mcp.' });
        }

        const given = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
        const expected = await this.secret();
        if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
            return send(
                401,
                { error: 'Not authorized. Run "Enigma: Connect an Assistant over MCP..." in VS Code for the address and token.' },
                { 'WWW-Authenticate': 'Bearer' },
            );
        }

        if (request.method !== 'POST') {
            // no stream of the server's own: it only ever answers
            return send(405, { error: 'Only POST is supported.' }, { Allow: 'POST' });
        }

        let message: RpcRequest | RpcRequest[];
        try {
            const chunks: Buffer[] = [];
            for await (const chunk of request) {
                chunks.push(chunk as Buffer);
            }

            message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RpcRequest | RpcRequest[];
        } catch {
            return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'The request is not JSON.' } });
        }

        const answers = (await Promise.all((Array.isArray(message) ? message : [message]).map(one => this.handle(one)))).filter(
            answer => answer !== undefined,
        );
        if (answers.length === 0) {
            // only notifications: nothing to say
            return send(202);
        }

        send(200, Array.isArray(message) ? answers : answers[0]);
    }

    /** Answers one message of the protocol. Public so that tests can speak it without a socket. */
    async handle(message: RpcRequest): Promise<object | undefined> {
        if (message?.id === undefined || message.id === null) {
            return undefined;
        }

        const result = (value: unknown) => ({ jsonrpc: '2.0', id: message.id, result: value });
        switch (message.method) {
            case 'initialize': {
                const asked = message.params?.protocolVersion;
                return result({
                    protocolVersion: typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                    capabilities: { tools: {} },
                    serverInfo: {
                        name: 'enigma',
                        title: 'Enigma',
                        version: (this.context.extension.packageJSON as { version: string }).version,
                    },
                    instructions: INSTRUCTIONS,
                });
            }
            case 'ping':
                return result({});
            case 'tools/list':
                return result({
                    tools: this.tools.map(tool => ({
                        name: tool.name,
                        title: tool.title,
                        description: tool.description,
                        inputSchema: tool.inputSchema,
                        annotations: {
                            title: tool.title,
                            readOnlyHint: !tool.changes,
                            destructiveHint: false,
                            idempotentHint: true,
                            openWorldHint: false,
                        },
                    })),
                });
            case 'tools/call': {
                const name = message.params?.name;
                const tool = this.tools.find(candidate => candidate.name === name);
                if (!tool) {
                    return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `Unknown tool: ${String(name)}` } };
                }

                // what goes wrong in a tool is for the model to read and act on, not a failure of the protocol
                try {
                    return result({
                        content: [{ type: 'text', text: toText(await tool.run(message.params?.arguments ?? {})) }],
                        isError: false,
                    });
                } catch (error) {
                    return result({
                        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
                        isError: true,
                    });
                }
            }

            default:
                return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
        }
    }

    /** Turns the server on and hands the user what an assistant needs to connect. */
    async connect(): Promise<void> {
        if (!settings.mcpEnabled) {
            await settings.update('mcp.enabled', true);
        }

        await this.apply();
        if (this.listening === undefined) {
            return;
        }

        const url = `http://127.0.0.1:${this.listening}/mcp`;
        const token = await this.secret();
        const choices = [
            {
                label: 'Claude Code',
                detail: t('mcpServer.copiesTheCommandThatAddsEnigma'),
                claude: true,
                text: `claude mcp add --transport http enigma ${url} --header "Authorization: Bearer ${token}"`,
            },
            {
                label: t('mcpServer.anotherAssistant'),
                detail: t('mcpServer.copiesAConfigurationForClientsThat'),
                claude: false,
                text: JSON.stringify(
                    { mcpServers: { enigma: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } },
                    undefined,
                    2,
                ),
            },
        ];
        const choice = await vscode.window.showQuickPick(choices, {
            title: t('mcpServer.connectAnAssistantToEnigma'),
            placeHolder: t('mcpServer.enigmaAnswersOnWhileThisWindow', url),
        });
        if (choice) {
            await vscode.env.clipboard.writeText(choice.text);
            void vscode.window.showInformationMessage(
                choice.claude ? t('mcpServer.enigmaCopiedRunItInA') : t('mcpServer.enigmaCopiedPasteItIntoThe'),
            );
        }
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        void this.stop();
    }
}
