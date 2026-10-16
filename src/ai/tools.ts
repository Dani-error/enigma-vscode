import * as path from 'node:path';
import { ClassIndex } from '../documents/classIndex';
import { Backend } from '../engine/backend';
import { OpenState, ClassItem, EditResult, EntryInfo, EntryRef, SearchType, TreeNodeResult } from '../engine/protocol';
import { t } from '../l10n';
import { INSTRUCTIONS, TOOLS, ToolDescription } from './catalog';

// What the tools of catalog.ts do. This is all an assistant can do with the jar, whichever way it is connected: the
// chat of the editor (lmTools.ts) and the MCP server (mcpServer.ts) both end up here, and neither adds anything.

/** The most lines of a class handed out in one answer; the rest is asked for with "fromLine". */
const MAX_LINES = 600;
const MAX_CLASSES = 400;
const MAX_LISTED = 80;

export interface AiTool extends ToolDescription {
    /** What an assistant is about to change, for asking the user. Only for tools that change something. */
    describeChange?(input: any): { title: string; message: string };
    /** @returns the answer for the model: text, or something to be shown as JSON */
    run(input: any): Promise<unknown>;
}

export const describeEntry = (entry: EntryRef) => {
    return entry.kind === 'class' ? `class ${entry.name}`
        : entry.kind === 'local' ? `${entry.parameter ? 'parameter' : 'local variable'} ${entry.index} of ${entry.owner}.${entry.method}${entry.desc}`
            : `${entry.kind} ${entry.owner}.${entry.name}${entry.kind === 'method' ? entry.desc : ''}`;
}

/** Turns an answer into the text a model gets. */
export const toText = (answer: unknown) => {
    return typeof answer === 'string' ? answer : JSON.stringify(answer, undefined, 1);
}

export const createAiTools = (backend: Backend, index: ClassIndex, state: () => OpenState | undefined): AiTool[] => {
    const requireProject = (): OpenState => {
        const open = state();
        if (!open?.jarPath) {
            throw new Error('No jar is open in Enigma. Ask the user to open one in VS Code with "Enigma: Open Jar...".');
        }

        return open;
    };

    /** A class by the name the model was given, which is the one it has now or the one it had in the jar. */
    const classOf = (name: unknown): ClassItem => {
        requireProject();
        const wanted = String(name ?? '').replace(/\.java$/, '').replace(/\./g, '/');
        const found = index.get(wanted) ?? index.byName(wanted);
        if (!found) {
            throw new Error(`There is no class "${name}" in the jar. Names are written with their package and slashes, like com/example/Thing; enigma_list_classes lists them. Inner classes are part of their outer class: read that one.`);
        }

        return found;
    };

    const entryOf = (entry: unknown): EntryRef => {
        requireProject();
        if (!entry || typeof entry !== 'object' || !('kind' in entry)) {
            throw new Error('An "entry" is needed, as given in the results of enigma_list_members, enigma_search and the other tools.');
        }

        return entry as EntryRef;
    };

    const classSummary = (item: ClassItem) => ({ obfuscatedName: item.obf, name: item.deobf, kind: item.kind, named: !item.obfuscated });
    const entrySummary = (info: EntryInfo) => ({
        name: info.fullName, kind: info.kind, named: !info.obfuscated, ...(info.inJar ? {} : { library: true }), entry: info.entry,
    });
    /** What an edit came to, for the model. */
    const outcome = (result: EditResult) => {
        return { applied: result.applied, messages: result.messages.map(message => `${message.type}: ${message.text}`) };
    };

    const run: Record<string, AiTool['run']> = {
        enigma_overview: async () => {
            const open = requireProject();
            const classes = [...index.all];
            const packages = new Map<string, { classes: number; named: number }>();
            for (const item of classes) {
                const name = item.deobf.includes('/') ? item.deobf.substring(0, item.deobf.lastIndexOf('/')) : '(no package)';
                const counted = packages.get(name) ?? { classes: 0, named: 0 };
                counted.classes++;
                counted.named += item.obfuscated ? 0 : 1;
                packages.set(name, counted);
            }

            const listed = [...packages].sort((a, b) => b[1].classes - a[1].classes);
            return {
                jar: path.basename(open.jarPath),
                mappings: open.mappingsPath ? path.basename(open.mappingsPath) : 'none loaded: names given now are new',
                unsavedChanges: open.dirty,
                classes: classes.length,
                namedClasses: classes.filter(item => !item.obfuscated).length,
                packages: listed.slice(0, 150).map(([name, counted]) => ({ package: name, ...counted })),
                ...(listed.length > 150 ? { morePackages: listed.length - 150 } : {}),
                guide: INSTRUCTIONS,
            };
        },
        enigma_list_classes: async (input: { package?: string; onlyUnnamed?: boolean; limit?: number }) => {
            requireProject();
            const prefix = input.package ? `${input.package.replace(/\./g, '/').replace(/\/$/, '')}/` : '';
            const all = [...index.all].filter(item => item.deobf.startsWith(prefix) && (!input.onlyUnnamed || item.obfuscated));
            const limit = Math.min(Math.max(1, input.limit ?? MAX_CLASSES), MAX_CLASSES);
            return {
                total: all.length,
                ...(all.length > limit ? { note: `Only the first ${limit} are listed. Ask for one package at a time to see the rest.` } : {}),
                classes: all.slice(0, limit).map(classSummary),
            };
        },
        enigma_read_class: async (input: { class: string; fromLine?: number }) => {
            const item = classOf(input.class);
            const source = await backend.request('class/source', { class: item.obf, view: 'source' });
            const lines = source.text.split('\n');
            const from = Math.min(Math.max(1, Math.floor(input.fromLine ?? 1)), lines.length);
            const to = Math.min(lines.length, from + MAX_LINES - 1);
            const header = [
                `// ${item.deobf}${item.deobf === item.obf ? '' : ` (in the jar: ${item.obf})`}`,
                ...(from > 1 || to < lines.length ? [`// Lines ${from} to ${to} of ${lines.length}.${to < lines.length ? ` Continue with fromLine ${to + 1}.` : ''}`] : []),
            ];
            return `${header.join('\n')}\n${lines.slice(from - 1, to).join('\n')}`;
        },
        enigma_list_members: async (input: { class: string }) => {
            const item = classOf(input.class);
            const root = await backend.request('structure', { class: item.obf, obfuscation: 'all', documentation: 'all', sorting: 'default' });
            const members: object[] = [];
            const walk = (node: TreeNodeResult) => {
                if (node.entry) {
                    members.push({ shown: node.label, kind: node.kind, named: node.tokenType !== 'obfuscated', modifiers: node.modifiers || undefined, entry: node.entry });
                }

                node.children.forEach(walk);
            };
            root.children.forEach(walk);
            return { class: classSummary(item), entry: { kind: 'class', name: item.obf }, members };
        },
        enigma_search: async (input: { query: string; kinds?: SearchType[] }) => {
            requireProject();
            const results = await backend.request('search', { query: String(input.query ?? ''), types: input.kinds ?? [], limit: 60 });
            return results.map(result => ({ name: result.fullName, kind: result.kind, named: result.deobfuscated, in: result.container ?? undefined, entry: result.entry }));
        },
        enigma_describe: async (input: { entry: EntryRef }) => {
            const info = await backend.request('entry/info', { entry: entryOf(input.entry) });
            return {
                name: info.fullName, obfuscatedName: info.obfName, kind: info.kind, named: !info.obfuscated,
                modifiers: info.modifiers.join(' ') || undefined,
                signature: info.descriptor, type: info.type ?? undefined,
                declaredIn: info.owner, extends: info.superClass ?? undefined, implements: info.interfaces?.length ? info.interfaces : undefined,
                javadoc: info.javadoc ?? undefined,
                ...(info.inJar ? {} : { library: 'Not part of the jar: it cannot be renamed.' }),
                ...(info.renamable ? {} : { renamable: false }),
                entry: info.entry,
            };
        },
        enigma_references: async (input: { entry: EntryRef }) => {
            const result = await backend.request('calls', { entry: entryOf(input.entry), recursive: false });
            const found = result.root?.children ?? [];
            return {
                total: found.length,
                ...(found.length > MAX_LISTED ? { note: `Only the first ${MAX_LISTED} are listed.` } : {}),
                usedIn: found.slice(0, MAX_LISTED).map(node => ({ where: node.label, kind: node.kind, entry: node.entry })),
            };
        },
        enigma_callers: async (input: { entry: EntryRef }) => {
            const callers = await backend.request('calls/incoming', { entry: entryOf(input.entry) });
            return { total: callers.length, callers: callers.slice(0, MAX_LISTED).map(caller => ({ ...entrySummary(caller), times: caller.sites.length })) };
        },
        enigma_callees: async (input: { entry: EntryRef }) => {
            const callees = await backend.request('calls/outgoing', { entry: entryOf(input.entry) });
            return { total: callees.length, uses: callees.slice(0, MAX_LISTED).map(callee => ({ ...entrySummary(callee), times: callee.sites.length })) };
        },
        enigma_hierarchy: async (input: { class: string }) => {
            const item = classOf(input.class);
            const [supertypes, subtypes] = await Promise.all([
                backend.request('hierarchy/supertypes', { class: item.obf }),
                backend.request('hierarchy/subtypes', { class: item.obf }),
            ]);
            return { class: classSummary(item), extendsOrImplements: supertypes.map(entrySummary), extendedOrImplementedBy: subtypes.slice(0, MAX_LISTED).map(entrySummary) };
        },
        enigma_rename: async (input: { entry: EntryRef; newName: string }) => {
            // the user was asked already; what the engine warns about is told to the model with the result
            const result = outcome(await backend.request('entry/rename', { entry: entryOf(input.entry), newName: String(input.newName ?? ''), confirmWarnings: true }));
            return result.applied
                ? { renamed: true, to: input.newName, ...(result.messages.length > 0 ? { messages: result.messages } : {}) }
                : { renamed: false, messages: result.messages.length > 0 ? result.messages : ['The engine did not accept this name.'] };
        },
        enigma_set_javadoc: async (input: { entry: EntryRef; javadoc: string }) => {
            const result = outcome(await backend.request('entry/setJavadoc', { entry: entryOf(input.entry), javadoc: String(input.javadoc ?? ''), confirmWarnings: true }));
            return { written: result.applied, ...(result.messages.length > 0 ? { messages: result.messages } : {}) };
        },
    };

    const describeChange: Record<string, NonNullable<AiTool['describeChange']>> = {
        enigma_rename: (input: { entry: EntryRef; newName: string }) => ({
            title: t('tools.renameInEnigma'),
            message: t('tools.renameTo', describeEntry(input.entry), input.newName),
        }),
        enigma_set_javadoc: (input: { entry: EntryRef; javadoc: string }) => ({
            title: t('tools.writeJavadocInEnigma'),
            message: input.javadoc?.trim() ? `${t('tools.setTheJavadocOfTo', describeEntry(input.entry))}\n\n${input.javadoc}` : t('tools.removeTheJavadocOf', describeEntry(input.entry)),
        }),
    };

    return TOOLS.map(tool => ({ ...tool, run: run[tool.name], describeChange: describeChange[tool.name] }));
}
