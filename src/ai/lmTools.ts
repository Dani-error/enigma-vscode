import * as vscode from 'vscode';
import { t } from '../l10n';
import { AiTool, toText } from './tools';

/**
 * Gives the tools to the chat of the editor, as "language model tools": whichever assistant the user has there, in
 * agent mode, can call them. They are declared in package.json ("languageModelTools"), from catalog.ts.
 */
export const registerLanguageModelTools = (tools: AiTool[]) => {
    // Assistants are an optional part of the editor, and so is this: without them there is nothing to register with.
    if (!vscode.lm?.registerTool) {
        return new vscode.Disposable(() => undefined);
    }

    return vscode.Disposable.from(...tools.map(tool => vscode.lm.registerTool<object>(tool.name, {
        prepareInvocation: ({ input }) => {
            const change = tool.describeChange?.(input);
            return change ? {
                invocationMessage: change.message.split('\n')[0].replace(/\?$/, ''),
                confirmationMessages: { title: change.title, message: `${change.message}\n\n${t('lmTools.thisChangesTheMappingsItCan')}` },
            } : undefined;
        },
        invoke: async ({ input }) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(toText(await tool.run(input ?? {})))]),
    })));
}
