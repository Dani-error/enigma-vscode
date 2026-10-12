package dev.danibcastro.enigmavscode.backend.protocol.source;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:04
 * Created by: Dani-error
 */
/**
 * @param context what refers to the entry; without it, the declaration is meant
 */
public record ReferenceParams(
        EntryRef entry,
        @Nullable EntryRef context,
        @Nullable View view
) { }
