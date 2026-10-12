package dev.danibcastro.enigmavscode.backend.protocol.source;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:05
 * Created by: Dani-error
 */
public record DeclarationParams(
        EntryRef entry,
        @Nullable View view
) { }
