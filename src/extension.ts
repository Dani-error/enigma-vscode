import * as path from 'node:path';
import * as vscode from 'vscode';
import { registerLanguageModelTools } from './ai/lmTools';
import { McpServer } from './ai/mcpServer';
import { createAiTools } from './ai/tools';
import { registerAnalysisCommands } from './commands/analysisCommands';
import { registerClassCommands } from './commands/classCommands';
import { registerEditCommands } from './commands/editCommands';
import { registerEngineCommands } from './commands/engineCommands';
import { registerProjectCommands } from './commands/projectCommands';
import { Targets, commandRegistry } from './commands/registry';
import { registerSearchCommands } from './commands/searchCommands';
import { registerStatsCommands } from './commands/statsCommands';
import { registerToolCommands } from './commands/toolCommands';
import { ClassIndex } from './documents/classIndex';
import { SCHEME } from './documents/classUri';
import { ClassEditors } from './documents/classEditors';
import { EnigmaDocuments } from './documents/documents';
import { EditorController } from './editor/controller';
import { Backend } from './engine/backend';
import { JavaRuntime, MINIMUM_JAVA, discoverInstallations } from './engine/java';
import { TreeNodeResult } from './engine/protocol';
import { Enigma } from './enigma';
import { registerLanguageFeatures } from './language/features';
import { useIcons } from './kinds';
import { Layout } from './layout';
import { JarOpener } from './project/jarOpener';
import { CollabPane } from './panes/collabPane';
import { EntryPane } from './panes/entryPane';
import { StatsPanel } from './panes/statsPanel';
import { Editing } from './project/editing';
import { ErrorReporter } from './project/errors';
import { ProjectMemory } from './project/memory';
import { Project } from './project/project';
import { AnalysisProvider, AnalysisView } from './views/analysis';
import { ClassDecorations } from './views/classDecorations';
import { ClassTreeMode, ClassTreeNode, ClassTreeProvider } from './views/classTree';
import { ClassProgress } from './views/classProgress';
import { ClassViews } from './views/classViews';
import { StructureProvider } from './views/structure';

/** What the extension exposes to its integration tests. */
export interface EnigmaApi {
    backend: Backend;
    project: Project;
    index: ClassIndex;
    documents: EnigmaDocuments;
    editing: Editing;
    editor: EditorController;
    analysis: AnalysisProvider;
    structure: StructureProvider;
    structureView: vscode.TreeView<TreeNodeResult>;
    classTrees: Record<ClassTreeMode, ClassTreeProvider>;
    classViews: Record<ClassTreeMode, vscode.TreeView<ClassTreeNode>>;
    classDecorations: ClassDecorations;
    mcp: McpServer;
    jarOpener: JarOpener;
    entryPane: EntryPane;
    collabPane: CollabPane;
    statsPanel: StatsPanel;
    /** Installed Java runtimes that can run the engine. */
    javaInstallations(): JavaRuntime[];
}

let shutdown: (() => Promise<void>) | undefined;

/** Puts the extension together: nothing here decides anything, it only says what works with what. */
export async function activate(context: vscode.ExtensionContext): Promise<EnigmaApi> {
    const output = vscode.window.createOutputChannel('Enigma', { log: true });
    useIcons(vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons'));
    const backend = new Backend(context, output);
    const index = new ClassIndex(backend);
    const reporter = new ErrorReporter(output);
    const memory = new ProjectMemory(context);
    const project = new Project(context, backend, index, memory, reporter);
    const documents = new EnigmaDocuments(backend, () => project.whenReady());
    const editors = new ClassEditors(backend, index, documents);
    project.attach(documents, editors);
    const editor = new EditorController(backend, documents, editors);
    const editing = new Editing(backend);
    const entryPane = new EntryPane(context.extensionUri, backend, documents, editing, () => project.isOpen);
    const collabPane = new CollabPane(context, backend, () => project.isOpen, action => project.confirmDiscard(action));
    const statsPanel = new StatsPanel(context, backend, index, editors, () => project.state);
    const jarOpener = new JarOpener(project);
    const classes = new ClassViews(context.extensionUri, index, () => project.isOpen);
    const classProgress = new ClassProgress(backend, classes);
    const structure = new StructureProvider(backend, () => project.isOpen);
    const analysis = new AnalysisView(backend);
    // one set of tools for every assistant, however it is connected
    const aiTools = createAiTools(backend, index, () => project.state);
    const mcp = new McpServer(context, aiTools, output);
    const layout = new Layout(project, index, classes, structure, entryPane, output);

    context.subscriptions.push(
        output, backend, index, reporter, project, documents, editors, editor, structure, analysis, entryPane, collabPane, statsPanel, jarOpener,
        classes, classProgress, layout, mcp, registerLanguageModelTools(aiTools),
        registerLanguageFeatures(backend, index, documents, editing, () => project.isOpen),
        project.onDidChange(state => {
            index.jarName = state?.jarPath ? path.basename(state.jarPath) : 'jar';
            classes.updateCounts();
            if (!state) {
                analysis.clear();
            }
        }),
        // picking a class in a tree shows it in the identifier pane, like placing the cursor on its name
        classes.onDidSelectClass(name => void entryPane.showEntry({ kind: 'class', name }).catch(() => undefined)),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('enigma.editor') || event.affectsConfiguration('enigma.editable')) {
                // whether names can be typed over is part of how each class is served
                documents.refreshAll();
            }
        }),
        vscode.window.onDidChangeActiveTextEditor(active => {
            void vscode.commands.executeCommand('setContext', 'enigma.classEditorActive', active?.document.uri.scheme === SCHEME);
        }),
    );

    const enigma: Enigma = {
        context, output, backend, index, reporter, project, documents, editors, editor, editing, classes, classProgress, structure, analysis,
        entryPane, collabPane, statsPanel, jarOpener,
    };
    const register = commandRegistry(context, error => reporter.report(error));
    const targets = new Targets(backend, documents, project);
    registerProjectCommands(register, targets, enigma);
    registerEngineCommands(register, enigma);
    registerEditCommands(register, targets, enigma);
    registerClassCommands(register, targets, enigma);
    registerAnalysisCommands(register, targets, enigma);
    registerSearchCommands(register, targets, enigma);
    registerStatsCommands(register, targets, enigma);
    registerToolCommands(register, enigma);
    register('enigma.mcp.connect', () => mcp.connect());

    // reopen what this window had open; documents restored by the editor wait for this
    void project.restore();

    shutdown = async () => {
        // the editor does not ask before closing: keep unsaved work recoverable
        await project.writeSnapshot();
        await backend.stop();
    };

    return {
        backend, project, index, documents, editing, editor, jarOpener, entryPane, collabPane, statsPanel,
        analysis: analysis.provider, structure, structureView: structure.view, classTrees: classes.trees, classViews: classes.views, classDecorations: classes.decorations, mcp,
        javaInstallations: () => discoverInstallations().filter(installation => installation.version >= MINIMUM_JAVA),
    };
}

export async function deactivate(): Promise<void> {
    await shutdown?.();
}
