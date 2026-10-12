package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.search.*;
import dev.danibcastro.enigmavscode.backend.rpc.EntryCodec;
import dev.danibcastro.enigmavscode.backend.search.SearchEntry;
import dev.danibcastro.enigmavscode.backend.search.SearchUtil;
import dev.danibcastro.enigmavscode.backend.service.Service;
import lombok.RequiredArgsConstructor;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.analysis.index.jar.EntryIndex;
import org.quiltmc.enigma.api.translation.mapping.EntryRemapper;
import org.quiltmc.enigma.api.translation.representation.entry.ClassEntry;
import org.quiltmc.enigma.api.translation.representation.entry.Entry;
import org.quiltmc.enigma.api.translation.representation.entry.MethodEntry;
import org.quiltmc.enigma.api.translation.representation.entry.ParentedEntry;

import java.util.*;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:36
 * Created by: Dani-error
 */
@RequiredArgsConstructor
public final class SearchService implements Service {

    /** Kept between searches, like the search dialog does, so that entries the user picked before rank higher. */
    private final Map<String, Integer> searchHits = new HashMap<>();

    private final Session session;
    private final EntryService entries;

    @Override
    public void register() {
        this.session.rpc().register("search", SearchParams.class, this::search);
        this.session.rpc().registerAction("search/hit", SearchHitParams.class, this::searchHit);
    }

    private static SearchType typeOf(Entry<?> entry) {
        if (entry instanceof ClassEntry) {
            return SearchType.CLASS;
        } else if (entry instanceof MethodEntry) {
            return SearchType.METHOD;
        }

        return SearchType.FIELD;
    }

    /** Same shape as the search dialog's entries, so that scoring is identical. */
    private record SearchEntryImpl(ParentedEntry<?> obf, @Nullable ParentedEntry<?> deobf) implements SearchEntry {
        @Override
        public List<String> getSearchableNames() {
            if (this.deobf != null) {
                return List.of(this.obf.getSimpleName(), this.deobf.getSimpleName());
            } else {
                return Collections.singletonList(this.obf.getSimpleName());
            }
        }

        @Override
        public String getIdentifier() {
            return this.obf.getFullName();
        }

        @Override
        public int getTypePriority() {
            return SearchType.values().length - typeOf(this.obf).ordinal();
        }

        static SearchEntryImpl from(ParentedEntry<?> e, EntryRemapper remapper) {
            ParentedEntry<?> deobf = remapper.deobfuscate(e);
            if (deobf.equals(e)) {
                deobf = null;
            }

            return new SearchEntryImpl(e, deobf);
        }
    }

    private List<SearchHit> search(SearchParams params) {
        EnigmaProject project = this.session.requireProject();
        String term = params.query().trim();
        int limit = Objects.requireNonNullElse(params.limit(), 200);
        boolean exact = Objects.requireNonNullElse(params.exact(), false);
        // all of them, if none is said
        Set<SearchType> types = params.types() == null || params.types().isEmpty() ? EnumSet.allOf(SearchType.class) : EnumSet.copyOf(params.types());

        if (term.isEmpty()) {
            return List.of();
        }

        EntryIndex entryIndex = project.getJarIndex().getIndex(EntryIndex.class);
        EntryRemapper remapper = project.getRemapper();
        List<SearchEntryImpl> candidates = new ArrayList<>();
        if (types.contains(SearchType.CLASS)) {
            entryIndex.getClasses().stream().filter(e -> !e.isInnerClass()).forEach(e -> candidates.add(SearchEntryImpl.from(e, remapper)));
        }

        if (types.contains(SearchType.METHOD)) {
            entryIndex.getMethods().stream()
                    .filter(e -> !e.isConstructor() && !entryIndex.getMethodAccess(e).isSynthetic())
                    .forEach(e -> candidates.add(SearchEntryImpl.from(e, remapper)));
        }

        if (types.contains(SearchType.FIELD)) {
            entryIndex.getFields().forEach(e -> candidates.add(SearchEntryImpl.from(e, remapper)));
        }

        Map<String, Integer> hits = this.searchHits;
        record Scored(SearchEntryImpl entry, float score) {
        }

        List<Scored> scored = candidates.parallelStream()
                .filter(e -> !exact || e.getSearchableNames().stream().anyMatch(name -> name.equalsIgnoreCase(term)))
                .map(e -> new Scored(e, SearchUtil.Entry.from(e).getScore(term, hits.getOrDefault(e.getIdentifier(), 0))))
                .filter(s -> s.score() > 0)
                .sorted((a, b) -> Float.compare(b.score(), a.score()))
                .limit(limit)
                .toList();

        List<SearchHit> results = new ArrayList<>(scored.size());
        for (Scored s : scored) {
            ParentedEntry<?> obf = s.entry().obf();
            results.add(new SearchHit(EntryCodec.toRef(obf), this.entries.symbolKind(obf), obf.getSimpleName(),
                    s.entry().deobf() == null ? obf.getSimpleName() : s.entry().deobf().getSimpleName(), s.entry().deobf() != null,
                    remapper.deobfuscate(obf).getFullName(),
                    obf instanceof ClassEntry classEntry ? remapper.deobfuscate(classEntry).getPackageName() : remapper.deobfuscate(obf.getContainingClass()).getFullName(),
                    this.entries.symbolDetail(obf), s.entry().getIdentifier()));
        }

        return results;
    }

    /** Records that a search result was opened, which makes it rank higher next time. */
    private void searchHit(SearchHitParams params) {
        this.searchHits.merge(params.id(), 1, Integer::sum);
    }

}
