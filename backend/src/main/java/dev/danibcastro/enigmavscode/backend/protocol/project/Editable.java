package dev.danibcastro.enigmavscode.backend.protocol.project;


import dev.danibcastro.enigmavscode.backend.protocol.wire.EnumAdapterFactory;

import java.util.Arrays;
import java.util.Optional;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:38
 * Created by: Dani-error
 */

/** What the user may be allowed to change: the values of the {@code enigma.editable} setting. */
public enum Editable {
    CLASS,
    METHOD,
    FIELD,
    PARAMETER,
    LOCAL,
    JAVADOC;

    /** The constant a setting names, if it names one: settings are written by hand. */
    public static Optional<Editable> named(String name) {
        return Arrays.stream(values()).filter(value -> EnumAdapterFactory.wireName(value).equals(name)).findFirst();
    }

}
