package dev.danibcastro.enigmavscode.backend.protocol.tree;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:54
 * Created by: Dani-error
 */
/**
 * @param recursive for a method, whether calls of what it overrides count too, as they do unless said otherwise
 */
public record CallsParams(
        EntryRef entry,
        @Nullable Boolean recursive
) { }
