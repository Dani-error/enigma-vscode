import * as vscode from 'vscode';
import { ParsedText, ZoneModel } from './zones';

export interface Problem {
    severity: 'error' | 'warning';
    message: string;
}

/** A name that is being typed. */
export interface Session {
    group: number;
    /** The occurrence that has the cursor. Its text is the new name. */
    primary: number;
    /** Set while the engine is asked to apply the name; further edits are refused until it answered. */
    busy: boolean;
    /**
     * The name was obfuscated and what is typed replaces it, but the original is still in the text next to what was
     * typed: removing it is an edit of its own, which the editor only takes when nothing else changed meanwhile.
     */
    replacing: boolean;
    /** An edit removing the original name is on its way. */
    stripping: boolean;
    /** The engine's opinion on the name typed so far. */
    problem?: Problem;
    validation?: NodeJS.Timeout;
    validationRequest: number;
    /** An edit bringing the other occurrences of the name in line is on its way. */
    mirroring: boolean;
    mirrorFailures: number;
}

export interface State {
    uri: vscode.Uri;
    model: ZoneModel;
    /** Where the names are in the document as it is now. */
    parsed: ParsedText;
    /** The text the document is supposed to have: the engine's, plus the name being typed. */
    expected: string;
    session?: Session;
    settling: Promise<void>;
    /**
     * Whether the document was last seen with the text it is supposed to have. Only then does a change of its text
     * mean that someone typed. Otherwise it is the editor catching up (reloading the class after a rename, or
     * mirroring a keystroke onto other occurrences after the name was given up), which must never be taken for a
     * new name.
     */
    synced: boolean;
    /** The engine applied a name and its new text is on the way. Until it arrives the document is left alone. */
    awaitingSource: boolean;
}

export type CommitReason = 'enter' | 'leave';
