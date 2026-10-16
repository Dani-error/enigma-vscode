package dev.danibcastro.enigmavscode.backend.protocol.edit;


import dev.danibcastro.enigmavscode.backend.protocol.wire.WireName;

import java.util.Locale;

/*
 * Project: enigma-vscode
 * Created at: 16/10/2026 21:40
 * Created by: Dani-error
 */
/**
 * What the user did to the mappings, for undo and redo. Named, not worded: the client has the words.
 */
public enum ChangeKind implements WireName {
    /** Arguments: the old name, the new name. */
    RENAME,
    /** Arguments: the name of what was documented. */
    EDIT_JAVADOC,
    /** Arguments: the name that was kept. */
    MARK_DEOBFUSCATED,
    /** Arguments: the name that was dropped. */
    RESET_OBFUSCATED,
    /** Arguments: the old package, the new package. */
    RENAME_PACKAGE,
    /** Arguments: the old package, the new package. */
    MOVE_PACKAGE;

    @Override
    public String wireName() {
        return this.name().toLowerCase(Locale.ROOT).replace('_', '-');
    }
}
