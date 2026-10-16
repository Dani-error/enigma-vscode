import type { CollabMessage, ConnectionState, EntryRef, Severity, StatType, StatsResult, SymbolKind } from '../engine/protocol';

/** Something to show next to a field: what is wrong with it, or that all went well. */
export interface Problem {
    severity: Severity;
    message: string;
}

export interface Fact {
    label: string;
    value: string;
    mono?: boolean;
    copy?: boolean;
}

export type EntryAction = 'declaration' | 'inheritance' | 'implementations' | 'calls';
export type EntryField = 'name' | 'javadoc';

/** What the identifier pane displays; built by the extension so that the page only has to render it. */
export interface PaneEntry {
    /** Tells entries apart: messages about one that is no longer on display are ignored. */
    key: string;
    kind: SymbolKind;
    kindLabel: string;
    icon: string;
    name: string;
    displayName: string;
    state: 'library' | 'deobfuscated' | 'proposed' | 'obfuscated';
    stateLabel: string;
    renamable: boolean;
    nameHint?: string;
    lockedReason?: string;
    documentable: boolean;
    javadoc: string;
    facts: Fact[];
    toggle: { label: string; title: string } | null;
    actions: { id: EntryAction; label: string; icon: string; title: string }[];
}

export interface EmptyMessage {
    title: string;
    detail: string;
}

export type ToEntryPage =
    | { type: 'entry'; entry: PaneEntry | null; empty: EmptyMessage }
    | { type: 'validation'; key: string; request: number; problem: Problem | null }
    | { type: 'renameResult'; key: string; problem: Problem | null }
    | { type: 'javadocResult'; key: string; problem: Problem | null }
    | { type: 'focus'; field: EntryField };

export type FromEntryPage =
    | { type: 'ready' }
    | { type: 'dirty'; dirty: boolean }
    | { type: 'copy'; text: string }
    | { type: 'validate'; key: string; name: string; request: number }
    | { type: 'rename'; key: string; name: string }
    | { type: 'saveJavadoc'; key: string; text: string }
    | { type: 'toggle'; key: string }
    | { type: 'action'; key: string; id: EntryAction };

export interface LoggedMessage extends CollabMessage {
    time: string;
    /** The text of a chat message without the name of its author. */
    body?: string;
}

export interface CollabPageState {
    projectOpen: boolean;
    connection: ConnectionState;
    users: string[];
    messages: LoggedMessage[];
    /** The name this side goes by in the session. */
    self?: string;
    port?: number;
    address?: string;
    /** What the forms start out with. */
    defaults: { username?: string; address?: string; port?: number };
}

export type ToCollabPage = { type: 'state'; state: CollabPageState } | { type: 'failed'; message: string };

export type FromCollabPage =
    | { type: 'ready' }
    | { type: 'connect'; username: string; address: string; password: string }
    | { type: 'host'; username: string; port: number; password: string }
    | { type: 'disconnect' }
    | { type: 'chat'; text: string }
    | { type: 'navigate'; entry: EntryRef };

export interface StatsOptions {
    types: StatType[];
    /** Only count what is in this package, written with dots. */
    package: string;
    includeSynthetic: boolean;
    countFallback: boolean;
}

export type ToStatsPage =
    | { type: 'state'; state: { jarName: string; options: StatsOptions; loading: boolean } }
    | { type: 'result'; stats?: StatsResult; error?: string }
    | { type: 'stale' };

export type FromStatsPage = { type: 'ready' } | { type: 'generate'; options: StatsOptions } | { type: 'open'; name: string };
