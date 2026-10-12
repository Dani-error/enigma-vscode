package dev.danibcastro.enigmavscode.backend.protocol.search;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.entry.SymbolKind;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:39
 * Created by: Dani-error
 */

/**
 * Something found by its name.
 *
 * @param entry
 * @param kind
 * @param obfName
 * @param name
 * @param deobfuscated whether it has a name of its own
 * @param fullName
 * @param container the package of a class, the class of a member
 * @param detail the type of field, the signature of a method
 * @param id identifies it to {@code search/hit}, which makes what is opened often rank higher
 */
public record SearchHit(
        EntryRef entry,
        SymbolKind kind,
        String obfName,
        String name,
        boolean deobfuscated,
        String fullName,
        @Nullable String container,
        @Nullable String detail,
        String id
) { }
