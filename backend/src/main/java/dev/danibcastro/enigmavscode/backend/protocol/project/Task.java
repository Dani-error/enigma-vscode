package dev.danibcastro.enigmavscode.backend.protocol.project;


import dev.danibcastro.enigmavscode.backend.protocol.wire.WireName;

import java.util.Locale;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:08
 * Created by: Dani-error
 */
public enum Task implements WireName {
    OPENING_JAR,
    OPENING_MAPPINGS,
    SAVING_MAPPINGS,
    DROPPING_MAPPINGS,
    EXPORTING_SOURCE,
    EXPORTING_JAR,
    GENERATING_STATISTICS;

    @Override
    public String wireName() {
        return this.name().toLowerCase(Locale.ROOT).replace('_', '-');
    }
}