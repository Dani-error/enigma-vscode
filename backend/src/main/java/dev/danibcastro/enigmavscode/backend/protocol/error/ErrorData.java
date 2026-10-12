package dev.danibcastro.enigmavscode.backend.protocol.error;


import dev.danibcastro.enigmavscode.backend.protocol.wire.OmitIfNull;
import dev.danibcastro.enigmavscode.backend.protocol.wire.WireName;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.experimental.Accessors;
import org.jspecify.annotations.Nullable;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:12
 * Created by: Dani-error
 */
public sealed interface ErrorData {

    record Said(Problem key, List<String> args) implements ErrorData { }

    /**
     * Mappings that could not be read, and where: the client marks the place in the file.
     *
     * @param kind always {@code mappingParse}, which is what the client tells this by
     * @param line counted from 1
     */
    record MappingParse(Kind kind, @OmitIfNull @Nullable Integer line, @OmitIfNull @Nullable String reason, @OmitIfNull @Nullable String file) implements ErrorData { }

    @AllArgsConstructor
    @Getter @Accessors(fluent = true)
    enum Kind implements WireName {
        MAPPING_PARSE("mappingParse");

        private final String wireName;
    }

    /** A failure of the engine itself, for the log. */
    record Internal(String stackTrace) implements ErrorData { }

}
