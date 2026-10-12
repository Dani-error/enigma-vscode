package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.project.Task;
import dev.danibcastro.enigmavscode.backend.protocol.stats.ClassProgress;
import dev.danibcastro.enigmavscode.backend.protocol.stats.Stats;
import dev.danibcastro.enigmavscode.backend.protocol.stats.StatsParams;
import dev.danibcastro.enigmavscode.backend.rpc.RpcProgress;
import dev.danibcastro.enigmavscode.backend.service.Service;
import lombok.AllArgsConstructor;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.analysis.index.jar.EntryIndex;
import org.quiltmc.enigma.api.stats.*;
import org.quiltmc.enigma.api.translation.representation.entry.ClassEntry;

import java.util.*;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:58
 * Created by: Dani-error
 */
@AllArgsConstructor
public final class StatsService implements Service {

    private final Session session;

    @Override
    public void register() {
        this.session.rpc().register("stats/generate", StatsParams.class, this::stats);
        this.session.rpc().register("stats/classes", StatsParams.class, this::classStats);
    }

    private static Set<StatType> statTypes(StatsParams params) {
        // all of them, if none is said
        return params.types() == null || params.types().isEmpty() ? EnumSet.allOf(StatType.class) : EnumSet.copyOf(params.types());
    }

    private Stats stats(StatsParams params) {
        this.session.requireProject();
        StatsGenerator generator = this.session.requireStatsGenerator();

        Set<StatType> types = statTypes(params);
        GenerationParameters parameters = new GenerationParameters(types, Objects.requireNonNullElse(params.includeSynthetic(), false), Objects.requireNonNullElse(params.countFallback(), false));
        String topLevelPackage = Objects.requireNonNullElse(params.topLevelPackage(), "").replace('.', '/');

        RpcProgress progress = this.session.progress(Task.GENERATING_STATISTICS);
        ProjectStatsResult projectResult;
        try {
            projectResult = generator.generate(progress, parameters);
        } finally {
            progress.end();
        }

        ProjectStatsResult filtered = topLevelPackage.isEmpty() ? projectResult : projectResult.filter(topLevelPackage);
        StatsResult overall = filtered.getOverall();
        StatsTree<Integer> tree = overall.buildTree(topLevelPackage, types);

        Map<StatType, Stats.Type> byType = new EnumMap<>(StatType.class);
        for (StatType type : types) {
            byType.put(type, new Stats.Type(type.getName(), overall.getMappable(type), overall.getMapped(type), overall.getUnmapped(type)));
        }

        StatType[] array = types.toArray(StatType[]::new);
        return new Stats(byType, overall.getMappable(array), overall.getMapped(array), overall.getUnmapped(array), tree.root);
    }

    /**
     * Per-class statistics for the class tree icons, generated for every class when {@code classes} is omitted.
     */
    private Map<String, ClassProgress> classStats(StatsParams params) {
        EnigmaProject project = this.session.requireProject();
        StatsGenerator generator = this.session.requireStatsGenerator();

        Set<StatType> types = statTypes(params);
        GenerationParameters parameters = new GenerationParameters(types, Objects.requireNonNullElse(params.includeSynthetic(), false), Objects.requireNonNullElse(params.countFallback(), false));
        List<String> requested = Objects.requireNonNullElse(params.classes(), List.of());

        Map<String, ClassProgress> result = new LinkedHashMap<>();
        StatType[] array = types.toArray(StatType[]::new);
        if (requested.isEmpty()) {
            RpcProgress progress = this.session.progress(Task.GENERATING_STATISTICS);
            ProjectStatsResult projectResult;
            try {
                projectResult = generator.generate(progress, parameters);
            } finally {
                progress.end();
            }

            projectResult.getStats().forEach((classEntry, stats) -> {
                if (!classEntry.isInnerClass()) {
                    result.put(classEntry.getFullName(), new ClassProgress(stats.getMapped(array), stats.getMappable(array)));
                }
            });
        } else {
            EntryIndex entryIndex = project.getJarIndex().getIndex(EntryIndex.class);
            for (String name : requested) {
                ClassEntry classEntry = new ClassEntry(name);
                if (entryIndex.hasClass(classEntry)) {
                    StatsResult stats = generator.generate(classEntry, parameters);
                    result.put(name, new ClassProgress(stats.getMapped(array), stats.getMappable(array)));
                }
            }
        }

        return result;
    }
}
