import * as vscode from 'vscode';
import { ConfigureParams, Editable } from './engine/protocol';

const SECTION = 'enigma';

function read<T>(name: string): T | undefined {
    return vscode.workspace.getConfiguration(SECTION).get<T>(name);
}

/** The languages Enigma has its messages in, by the language of the editor they are used for. */
const ENGINE_LANGUAGES: Record<string, string> = { en: 'en_us', de: 'de_de', fr: 'fr_fr', ja: 'ja_jp', 'zh-cn': 'zh_cn', zh: 'zh_cn' };

/**
 * @param locale the language of the editor, like "de" or "zh-cn"
 */
export function engineLanguage(locale: string): string {
    const wanted = locale.toLowerCase();
    return ENGINE_LANGUAGES[wanted] ?? ENGINE_LANGUAGES[wanted.split('-')[0]] ?? 'en_us';
}

export const settings = {
    /** Whether names are renamed by typing on them in the code. */
    get inlineRename(): boolean {
        return read<boolean>('editor.inlineRename') ?? true;
    },
    /** Whether typing on an obfuscated name replaces it instead of adding to it. */
    get replaceObfuscatedNames(): boolean {
        return read<boolean>('editor.replaceObfuscatedNames') ?? true;
    },
    get compactPackages(): boolean {
        return read<boolean>('classTree.compactPackages') ?? true;
    },
    /** Whether the classes are listed in one tree, rather than in one for the obfuscated and one for the others. */
    get oneClassTree(): boolean {
        return read<string>('classTree.mode') === 'all';
    },
    get revealPanes(): boolean {
        return read<boolean>('layout.revealPanes') ?? true;
    },
    /** Whether assistants outside the editor may connect, over MCP. */
    get mcpEnabled(): boolean {
        return read<boolean>('mcp.enabled') === true;
    },
    get mcpPort(): number {
        const port = Number(read<number>('mcp.port'));
        return Number.isInteger(port) && port > 0 && port < 65536 ? port : 34713;
    },
    /** What to do at startup with the project a window had open the last time. It was a switch once. */
    get reopenLastProject(): 'ask' | 'always' | 'never' {
        const value = read<string | boolean>('reopenLastProject');
        return value === 'always' || value === true ? 'always' : value === 'never' || value === false ? 'never' : 'ask';
    },
    get maxRecentProjects(): number {
        return read<number>('maxRecentProjects') ?? 10;
    },
    get maxReferenceClasses(): number {
        return read<number>('references.maxClasses') ?? 150;
    },
    /** How much of what happens in a shared session is announced while its pane is out of sight. */
    get serverNotifications(): 'none' | 'no_chat' | 'full' {
        const level = read<string>('notifications.server');
        return level === 'none' || level === 'no_chat' ? level : 'full';
    },
    get statistics(): { includeSynthetic: boolean; countFallback: boolean } {
        return { includeSynthetic: read<boolean>('stats.includeSynthetic') ?? false, countFallback: read<boolean>('stats.countFallback') ?? false };
    },


    get javaHome(): string | undefined {
        return read<string>('java.home');
    },
    get javaArguments(): string[] {
        return read<string[]>('java.vmArgs') ?? [];
    },
    get pluginJars(): string[] {
        return read<string[]>('pluginJars') ?? [];
    },
    get libraries(): string[] {
        return read<string[]>('libraries') ?? [];
    },

    get profile(): string | undefined {
        return read<string>('profile')?.trim() || undefined;
    },
    get decompiler(): string | undefined {
        return read<string>('decompiler');
    },

    get engine(): ConfigureParams {
        return {
            profile: read<string>('profile')?.trim() || null,
            language: engineLanguage(vscode.env.language),
            editable: read<Editable[]>('editable'),
            autoSave: read<boolean>('autoSaveMappings'),
            decompiler: read<string>('decompiler'),
            vineflower: read<Record<string, unknown>>('vineflower') ?? {},
        };
    },

    async update(name: string, value: unknown): Promise<void> {
        await vscode.workspace.getConfiguration(SECTION).update(name, value, vscode.ConfigurationTarget.Global);
    },

    async updateWhereSet(name: string, value: unknown): Promise<void> {
        const config = vscode.workspace.getConfiguration(SECTION);
        const inspected = config.inspect(name);
        const target = inspected?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
            : inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await config.update(name, value, target);
    },
};
