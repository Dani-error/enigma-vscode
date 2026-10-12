package dev.danibcastro.enigmavscode.backend.protocol.source;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.entry.SymbolKind;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:34
 * Created by: Dani-error
 */

/**
 * Something declared in a class, for the outline of the editor.
 *
 * @param entry
 * @param kind
 * @param name
 * @param detail its type or signature
 * @param range where its name stands
 * @param parent the place, in the list this is part of, of what it is declared in
 */
public record Symbol(
        EntryRef entry,
        SymbolKind kind,
        String name,
        @Nullable String detail,
        Range range,
        @Nullable Integer parent
) { }
