package dev.danibcastro.enigmavscode.backend.protocol.stats;


import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.stats.StatType;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:59
 * Created by: Dani-error
 */

/**
 * @param topLevelPackage only count what is in this package
 * @param classes for {@code stats/classes}: only these classes
 */
public record StatsParams(
        @Nullable List<StatType> types,
        @Nullable Boolean includeSynthetic,
        @Nullable Boolean countFallback,
        @Nullable String topLevelPackage,
        @Nullable List<String> classes
) { }
