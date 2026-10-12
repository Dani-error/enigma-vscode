package dev.danibcastro.enigmavscode.backend.protocol.entry;


/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:03
 * Created by: Dani-error
 */

/** What an {@link EntryRef} names. */
public enum EntryKind {
    CLASS,
    FIELD,
    METHOD,
    /** A parameter or a local variable of a method. */
    LOCAL
}

