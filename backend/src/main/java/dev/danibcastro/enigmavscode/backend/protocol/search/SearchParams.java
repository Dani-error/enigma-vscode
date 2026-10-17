package dev.danibcastro.enigmavscode.backend.protocol.search;


import org.jspecify.annotations.Nullable;

import java.util.List;
import dev.danibcastro.enigmavscode.backend.protocol.wire.NonNegative;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:38
 * Created by: Dani-error
 */
public record SearchParams(
        String query,
        @NonNegative @Nullable Integer limit,
        @Nullable Boolean exact,
        @Nullable List<SearchType> types
) { }
