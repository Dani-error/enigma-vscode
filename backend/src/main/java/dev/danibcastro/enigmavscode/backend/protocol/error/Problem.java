package dev.danibcastro.enigmavscode.backend.protocol.error;


import dev.danibcastro.enigmavscode.backend.protocol.wire.WireName;

import java.util.Locale;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:12
 * Created by: Dani-error
 */
public enum Problem implements WireName {
    NO_JAR,
    PROFILE_NOT_FOUND,
    PROFILE_INVALID,
    UNKNOWN_DECOMPILER,
    JAR_NOT_FOUND,
    LIBRARY_NOT_FOUND,
    ALREADY_CONNECTED,
    NOT_CONNECTED,
    CONNECT_FAILED,
    SERVER_START_FAILED,
    UNKNOWN_MAPPING_FORMAT,
    MAPPINGS_NOT_FOUND,
    MAPPINGS_READ_FAILED,
    MAPPINGS_FROM_SERVER,
    NO_MAPPINGS_FILE_TO_SAVE,
    NO_MAPPINGS_FILE,
    SAVE_WHILE_CONNECTED,
    SAVE_FAILED,
    AUTO_SAVE_FAILED,
    SNAPSHOT_FAILED,
    CLASS_NOT_FOUND,
    EXPORT_SOURCE_FAILED,
    EXPORT_JAR_FAILED,
    EDITING_DISABLED,
    NOT_RENAMABLE,
    NOTHING_TO_UNDO,
    NOTHING_TO_REDO;

    @Override
    public String wireName() {
        return this.name().toLowerCase(Locale.ROOT).replace('_', '-');
    }
}
