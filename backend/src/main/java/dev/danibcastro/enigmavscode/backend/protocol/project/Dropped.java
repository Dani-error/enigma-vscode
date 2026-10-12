package dev.danibcastro.enigmavscode.backend.protocol.project;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:51
 * Created by: Dani-error
 */
/** The mappings that were removed because they match nothing in the jar: the answer to {@code mappings/drop}. */
public record Dropped(
        List<EntryRef> dropped
) { }
