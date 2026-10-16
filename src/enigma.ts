import * as vscode from 'vscode';
import { Backend } from './engine/backend';
import { ClassIndex } from './documents/classIndex';
import { ClassEditors } from './documents/classEditors';
import { EnigmaDocuments } from './documents/documents';
import { EditorController } from './editor/controller';
import { CollabPane } from './panes/collabPane';
import { EntryPane } from './panes/entryPane';
import { StatsPanel } from './panes/statsPanel';
import { JarOpener } from './project/jarOpener';
import { Editing } from './project/editing';
import { ErrorReporter } from './project/errors';
import { Project } from './project/project';
import { AnalysisView } from './views/analysis';
import { ClassProgress } from './views/classProgress';
import { ClassViews } from './views/classViews';
import { StructureProvider } from './views/structure';

export interface Enigma {
    context: vscode.ExtensionContext;
    output: vscode.LogOutputChannel;
    backend: Backend;
    index: ClassIndex;
    reporter: ErrorReporter;
    project: Project;
    documents: EnigmaDocuments;
    editors: ClassEditors;
    editor: EditorController;
    editing: Editing;
    classes: ClassViews;
    classProgress: ClassProgress;
    structure: StructureProvider;
    analysis: AnalysisView;
    entryPane: EntryPane;
    collabPane: CollabPane;
    statsPanel: StatsPanel;
    jarOpener: JarOpener;
}