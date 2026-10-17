// Types of the JSON-RPC protocol spoken with the Java backend.

export type EntryRef =
    | { kind: 'class'; name: string }
    | { kind: 'field'; owner: string; name: string; desc: string }
    | { kind: 'method'; owner: string; name: string; desc: string }
    | { kind: 'local'; owner: string; method: string; desc: string; index: number; parameter: boolean; name?: string };

/** A token position: zero-based line and character, and its length. */
export type TokenRange = [line: number, character: number, length: number];

export type View = 'source' | 'bytecode';
/** How a name in the code is drawn. */
export type TokenCategory = 'obfuscated' | 'deobfuscated' | 'proposed' | 'fallback' | 'debug';
export const TOKEN_CATEGORIES: TokenCategory[] = ['obfuscated', 'deobfuscated', 'proposed', 'fallback', 'debug'];
/** How an entry got its name, as Enigma tells it. */
export type TokenType = 'obfuscated' | 'deobfuscated' | 'jar_proposed' | 'dynamic_proposed' | 'debug';
/** What the user did to the mappings, as offered for undo and redo: named by the engine, worded in messages.ts. */
export type ChangeKind = 'rename' | 'edit-javadoc' | 'mark-deobfuscated' | 'reset-obfuscated' | 'rename-package' | 'move-package';

export interface Change {
    kind: ChangeKind;
    /** What it was done to: see ChangeKind in backend/. */
    args: string[];
}

export type ConnectionState = 'not_connected' | 'connected' | 'hosting';
export type EntryKind = EntryRef['kind'];
/** What an entry is to someone reading the code, which is finer than what it is to Enigma. */
export type SymbolKind =
    | 'class'
    | 'interface'
    | 'annotation'
    | 'enum'
    | 'record'
    | 'enumConstant'
    | 'field'
    | 'method'
    | 'constructor'
    | 'parameter'
    | 'local'
    | 'unknown';
export type ClassKind = Extract<SymbolKind, 'class' | 'interface' | 'annotation' | 'enum' | 'record'>;
export type Severity = 'info' | 'warning' | 'error';
export type SearchType = 'class' | 'method' | 'field';
export type StatType = 'classes' | 'methods' | 'fields' | 'parameters';
export type PackageMode = 'refactor' | 'move';
/** What may be renamed or documented: the "enigma.editable" setting. */
export type Editable = 'class' | 'method' | 'field' | 'parameter' | 'local' | 'javadoc';

export type Problem =
    | 'no-jar'
    | 'profile-not-found'
    | 'profile-invalid'
    | 'unknown-decompiler'
    | 'jar-not-found'
    | 'library-not-found'
    | 'already-connected'
    | 'not-connected'
    | 'connect-failed'
    | 'server-start-failed'
    | 'unknown-mapping-format'
    | 'mappings-not-found'
    | 'mappings-read-failed'
    | 'no-mappings-file-to-save'
    | 'no-mappings-file'
    | 'save-while-connected'
    | 'save-failed'
    | 'auto-save-failed'
    | 'snapshot-failed'
    | 'class-not-found'
    | 'export-source-failed'
    | 'export-jar-failed'
    | 'editing-disabled'
    | 'not-renamable'
    | 'nothing-to-undo'
    | 'nothing-to-redo';

/** What the engine reports progress on. */
export type Task =
    | 'opening-jar'
    | 'opening-mappings'
    | 'saving-mappings'
    | 'dropping-mappings'
    | 'exporting-source'
    | 'exporting-jar'
    | 'generating-statistics';

export interface BackendState {
    jarPath: string | null;
    jarChecksum: string | null;
    mappingsPath: string | null;
    mappingsFormat: string | null;
    dirty: boolean;
    decompiler: string;
    revision: number;
    canUndo: boolean;
    canRedo: boolean;
    /** What Undo would take back. */
    undoLabel: Change | null;
    redoLabel: Change | null;
    connection: ConnectionState;
    editable: Editable[];
}

/** The state while a jar is open. */
export type OpenState = BackendState & { jarPath: string };

export function isOpen(state: BackendState | undefined): state is OpenState {
    return !!state?.jarPath;
}

export interface MappingFormat {
    id: string;
    name: string;
    extensions: string[];
    directory: boolean;
    read: boolean;
    write: boolean;
}

export interface EnvironmentInfo {
    enigmaVersion: string;
    vineflowerVersion: string;
    cfrVersion: string;
    procyonVersion: string;
    javaVersion: string;
    decompilers: { id: string; name: string }[];
    formats: MappingFormat[];
    vineflowerPreferences: { key: string; type: string; name: string; description: string; default: string }[];
    languages: string[];
    state: BackendState;
}

export interface ClassItem {
    obf: string;
    deobf: string;
    obfuscated: boolean;
    tokenType: TokenType;
    kind: ClassKind;
    /** Declared abstract, and not an interface. */
    abstract: boolean;
    /** Descends from Throwable, as far as the jar tells. */
    throwable: boolean;
}

export interface SourceResult {
    class: string;
    view: View;
    deobfName: string;
    revision: number;
    /** Identifies this text among all that the engine handed out. Sent back with positions, which only mean something for one text. */
    serial: number;
    text: string;
    error: { type: string; message: string | null } | null;
    tokens: Record<TokenCategory, TokenRange[]>;
    /** Every name in the text, in document order: [line, character, length, group, flags, category]. */
    refs: [number, number, number, number, number, number][];
    /** What the names of each group rename. */
    groups: { entry: EntryRef; kind: SymbolKind; name: string }[];
}

export interface EntryInfo {
    entry: EntryRef;
    kind: SymbolKind;
    obfName: string;
    name: string;
    simpleName: string;
    fullName: string;
    tokenType: TokenType;
    sourcePluginId: string | null;
    javadoc: string | null;
    inJar: boolean;
    navigable: boolean;
    obfuscated: boolean;
    modifiers: string[];
    owner?: string;
    ownerEntry?: EntryRef;
    outerClass?: string | null;
    superClass?: string | null;
    interfaces?: string[];
    descriptor?: string;
    type?: string | null;
    method?: string;
    index?: number;
    topLevelClass: string;
    renamable: boolean;
    documentable: boolean;
    /** The entry that is renamed when this one is; the class, for constructors. */
    renameEntry: EntryRef;
    /** The name to edit: with the package for top-level classes. */
    renameName: string;
}

/** What is under the cursor. */
export interface TokenInfo extends EntryInfo {
    range: TokenRange;
    text: string;
    declaration: boolean;
    context: EntryRef | null;
}

export interface LocationResult {
    class: string;
    view: View;
    deobfName: string;
    range: TokenRange | null;
    ranges: TokenRange[];
}

export interface ReferencesResult {
    locations: { class: string; view: View; deobfName: string; ranges: TokenRange[] }[];
    truncated: boolean;
    searchedClasses: number;
}

export interface SymbolResult {
    entry: EntryRef;
    kind: SymbolKind;
    name: string;
    detail: string | null;
    range: TokenRange;
    parent: number | null;
}

export interface ValidationMessage {
    type: Severity;
    text: string;
    details: string | null;
}

export interface EditResult {
    applied: boolean;
    needsConfirmation: boolean;
    messages: ValidationMessage[];
    appliedCount?: number;
    label?: Change;
}

export interface PackageRenameResult extends Omit<EditResult, 'needsConfirmation'> {
    needsConfirmation?: boolean;
    renames: { class: string; from: string; to: string }[];
}

export interface TreeNodeResult {
    label: string;
    entry?: EntryRef;
    kind?: SymbolKind;
    tokenType?: TokenType;
    modifiers?: string;
    selected?: boolean;
    navigable?: boolean;
    implemented?: boolean;
    context?: EntryRef | null;
    children: TreeNodeResult[];
}

export interface SearchResult {
    entry: EntryRef;
    kind: SymbolKind;
    obfName: string;
    name: string;
    deobfuscated: boolean;
    fullName: string;
    container: string | null;
    detail: string | null;
    id: string;
}

export interface CallItem extends EntryInfo {
    sites: { entry: EntryRef; context: EntryRef }[];
}

/** The answer of the requests for a tree: nothing, where there is nothing to tell about the entry. */
export interface TreeRoot {
    root: TreeNodeResult | null;
}

export interface StatsTreeNode {
    name: string;
    value: number | null;
    children: StatsTreeNode[];
}

export interface StatsResult {
    types: Partial<Record<StatType, { name: string; mappable: number; mapped: number; unmapped: number }>>;
    mappable: number;
    mapped: number;
    unmapped: number;
    tree: StatsTreeNode;
}

export interface ProgressParams {
    id: number;
    phase: 'begin' | 'report' | 'end';
    /** What is being done, as a key. */
    task: Task;
    taskArgs?: string[];
    title: string | null;
    message: string | null;
    done: number;
    total: number;
}

export interface MappingsChangedParams {
    revision: number;
    /** Whether everything has to be reloaded, as opposed to only the listed classes. */
    full: boolean;
    classes: ClassItem[];
}

export interface UserNotification {
    type: Severity;
    /** A message of Enigma, in the user's language; or, with a key, only what to fall back on. */
    text: string;
    /** What happened, when the engine layer names it instead of wording it. */
    key?: Problem;
    args?: string[];
    details: string | null;
}

export interface CollabState {
    state: ConnectionState;
    users: string[];
}

export interface CollabMessage {
    type: 'chat' | 'connect' | 'disconnect' | 'edit_docs' | 'mark_deobf' | 'remove_mapping' | 'rename';
    user: string | null;
    text: string;
    entry: EntryRef | null;
}

/** What comes with an error of the engine, next to its message. */
export type ErrorData =
    /** The engine layer named what happened. */
    | { key: Problem; args: string[] }
    /** Mappings could not be read, and this is where. */
    | { kind: 'mappingParse'; line?: number; reason?: string; file?: string }
    /** The engine itself failed; for the log. */
    | { stackTrace: string };

interface ClassParams {
    class: string;
    view?: View;
}

/** A place in the text of a class. The serial says which text: positions mean nothing for another. */
interface PositionParams extends ClassParams {
    serial?: number;
    line: number;
    character: number;
}

interface Confirmable {
    /** Go ahead although Enigma has warnings. */
    confirmWarnings?: boolean;
}

export interface ConfigureParams {
    language?: string;
    editable?: Editable[];
    autoSave?: boolean;
    vineflower?: Record<string, unknown>;
    profile?: string | null;
    decompiler?: string;
}

export interface StatsParams {
    types?: StatType[];
    includeSynthetic?: boolean;
    countFallback?: boolean;
    topLevelPackage?: string;
    classes?: string[];
}

export interface StructureOptions {
    obfuscation?: 'all' | 'obfuscated' | 'deobfuscated';
    documentation?: 'all' | 'documented' | 'non_documented';
    sorting?: 'default' | 'a_z' | 'z_a';
    search?: string;
}

/** How far each class is mapped, by its obfuscated name: [mapped, mappable]. */
export type ClassProgress = Record<string, [mapped: number, mappable: number]>;

/**
 * Every request the engine answers: what it takes and what it answers with. The other end of this is the register()
 * of each service in backend/. Requests that take nothing are sent without parameters.
 */
export interface Requests {
    'initialize': { params: ConfigureParams; result: EnvironmentInfo };
    'configure': { params: ConfigureParams; result: void };
    'shutdown': { params: undefined; result: void };
    'project/openJar': { params: { jar: string; libraries?: string[] }; result: BackendState };
    'project/closeJar': { params: undefined; result: unknown };
    'project/reload': { params: { libraries?: string[] }; result: BackendState };
    'project/state': { params: undefined; result: BackendState };
    'decompiler/set': { params: { id: string }; result: BackendState };

    'mappings/open': { params: { path: string; format?: string }; result: BackendState };
    'mappings/save': { params: { path?: string; format?: string } | undefined; result: BackendState };
    'mappings/close': { params: undefined; result: BackendState };
    'mappings/reload': { params: undefined; result: BackendState };
    'mappings/drop': { params: undefined; result: { dropped: EntryRef[] } };
    'mappings/snapshot': { params: { path: string }; result: void };
    'mappings/restoreSnapshot': { params: { path: string }; result: BackendState };
    'export/source': { params: { path: string }; result: void };
    'export/jar': { params: { path: string }; result: void };

    'classes/list': { params: undefined; result: ClassItem[] };
    'class/source': { params: ClassParams; result: SourceResult };
    'class/close': { params: ClassParams; result: void };
    'class/reload': { params: ClassParams; result: void };
    'class/entryAt': { params: PositionParams; result: TokenInfo | null };
    'class/symbols': { params: ClassParams & { serial?: number }; result: SymbolResult[] | null };
    'entry/info': { params: { entry: EntryRef }; result: EntryInfo };

    'nav/definition': { params: PositionParams; result: LocationResult | null };
    'nav/declaration': { params: { entry: EntryRef; view?: View }; result: LocationResult | null };
    'nav/reference': { params: { entry: EntryRef; context?: EntryRef; view?: View }; result: LocationResult | null };
    'nav/references': {
        params: (PositionParams | { entry: EntryRef; view?: View }) & { includeDeclaration?: boolean; limit?: number };
        result: ReferencesResult | null;
    };

    'entry/rename': { params: { entry: EntryRef; newName: string; validateOnly?: boolean } & Confirmable; result: EditResult };
    'entry/setJavadoc': { params: { entry: EntryRef; javadoc: string | null } & Confirmable; result: EditResult };
    'entry/toggleMapping': { params: { entry: EntryRef } & Confirmable; result: EditResult };
    'edit/undo': { params: undefined; result: EditResult };
    'edit/redo': { params: undefined; result: EditResult };
    'package/rename': { params: { from: string; to: string; mode?: PackageMode; apply?: boolean }; result: PackageRenameResult };

    'structure': { params: { class: string } & StructureOptions; result: TreeNodeResult };
    'hierarchy/inheritance': { params: { entry: EntryRef }; result: TreeRoot };
    'hierarchy/implementations': { params: { entry: EntryRef }; result: TreeRoot };
    'hierarchy/supertypes': { params: { class: string }; result: EntryInfo[] };
    'hierarchy/subtypes': { params: { class: string }; result: EntryInfo[] };
    'calls': { params: { entry: EntryRef; recursive?: boolean }; result: TreeRoot };
    'calls/incoming': { params: { entry: EntryRef }; result: CallItem[] };
    'calls/outgoing': { params: { entry: EntryRef }; result: CallItem[] };

    'search': { params: { query: string; limit?: number; exact?: boolean; types?: SearchType[] }; result: SearchResult[] };
    'search/hit': { params: { id: string }; result: void };
    'stats/generate': { params: StatsParams; result: StatsResult };
    'stats/classes': { params: StatsParams; result: ClassProgress };

    'collab/connect': { params: { username: string; address: string; password?: string }; result: BackendState };
    'collab/host': { params: { username: string; port?: number; password?: string }; result: BackendState };
    'collab/disconnect': { params: undefined; result: unknown };
    'collab/sendMessage': { params: { text: string }; result: void };
    'collab/state': { params: undefined; result: CollabState };
}

export type Method = keyof Requests;
export type ParamsOf<M extends Method> = Requests[M]['params'];
export type ResultOf<M extends Method> = Requests[M]['result'];
/** The parameters as an argument list: none where the request takes nothing. */
export type ArgumentsOf<M extends Method> = undefined extends ParamsOf<M> ? [params?: ParamsOf<M>] : [params: ParamsOf<M>];
/** The requests about a place in the text of a class. */
export type PositionMethod = 'class/entryAt' | 'nav/definition' | 'nav/references';
/** What such a request takes besides the place. */
export type PositionOptions<M extends PositionMethod> = Omit<ParamsOf<M>, keyof PositionParams | 'entry'>;

/** What the engine tells without being asked. */
export interface Notifications {
    'stateChanged': BackendState;
    'projectChanged': BackendState;
    'mappingsChanged': MappingsChangedParams;
    'sourceChanged': { class: string; view: View };
    'notification': UserNotification;
    'progress': ProgressParams;
    'collab/stateChanged': CollabState;
    'collab/message': CollabMessage;
}

/** Error codes of the backend, next to the standard JSON-RPC ones. */
export const ErrorCode = {
    NoProject: 1,
    UserError: 2,
    /** A position was sent for a text that is not the one the engine handed out last. */
    Stale: 3,
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Whether an error code is one of those above, which the extension knows what to do with. */
export const isErrorCode = (code: number): code is ErrorCode => (Object.values(ErrorCode) as number[]).includes(code);

export function topLevelClassOf(entry: EntryRef): string {
    const name = entry.kind === 'class' ? entry.name : entry.owner;
    const inner = name.indexOf('$');
    return inner < 0 ? name : name.substring(0, inner);
}
