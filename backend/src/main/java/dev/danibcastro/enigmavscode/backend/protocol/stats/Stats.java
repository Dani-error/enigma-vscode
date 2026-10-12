package dev.danibcastro.enigmavscode.backend.protocol.stats;


import org.quiltmc.enigma.api.stats.StatType;
import org.quiltmc.enigma.api.stats.StatsTree;

import java.util.Map;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:01
 * Created by: Dani-error
 */
public record Stats(
        Map<StatType, Type> types,
        int mappable,
        int mapped,
        int unmapped,
        StatsTree.Node<Integer> tree
) {

    public record Type(
            String name,
            int mappable,
            int mapped,
            int unmapped
    ) { }

}
