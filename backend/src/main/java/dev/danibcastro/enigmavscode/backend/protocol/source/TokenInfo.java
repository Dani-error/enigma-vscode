package dev.danibcastro.enigmavscode.backend.protocol.source;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryInfo;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.wire.Flatten;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:33
 * Created by: Dani-error
 */

/**
 * What is at a position of a text: the entry, and the name that stands for it there.
 *
 * @param info
 * @param range where the name stands
 * @param text
 * @param declaration whether this is where the entry is declared
 * @param context otherwise, what refers to it here
 */
public record TokenInfo(
        @Flatten EntryInfo info,
        Range range,
        String text,
        boolean declaration,
        @Nullable EntryRef context
) { }
