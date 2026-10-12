package dev.danibcastro.enigmavscode.backend.protocol.edit;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:25
 * Created by: Dani-error
 */
/** What is sent with a request. */
public record ToggleMappingParams(
        EntryRef entry,
        @Nullable Boolean confirmWarnings
) { }
