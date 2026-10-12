package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.source.*;
import dev.danibcastro.enigmavscode.backend.rpc.EntryCodec;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.service.Service;
import dev.danibcastro.enigmavscode.backend.util.LineIndex;
import lombok.AllArgsConstructor;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.analysis.EntryReference;
import org.quiltmc.enigma.api.analysis.index.jar.EntryIndex;
import org.quiltmc.enigma.api.analysis.index.jar.ReferenceIndex;
import org.quiltmc.enigma.api.class_handle.ClassHandle;
import org.quiltmc.enigma.api.class_handle.ClassHandleError;
import org.quiltmc.enigma.api.service.JarIndexerService;
import org.quiltmc.enigma.api.source.DecompiledClassSource;
import org.quiltmc.enigma.api.source.SourceIndex;
import org.quiltmc.enigma.api.source.Token;
import org.quiltmc.enigma.api.translation.mapping.EntryResolver;
import org.quiltmc.enigma.api.translation.mapping.ResolutionStrategy;
import org.quiltmc.enigma.api.translation.representation.entry.ClassEntry;
import org.quiltmc.enigma.api.translation.representation.entry.Entry;
import org.quiltmc.enigma.api.translation.representation.entry.FieldEntry;
import org.quiltmc.enigma.api.translation.representation.entry.MethodEntry;
import org.quiltmc.enigma.impl.plugin.RecordIndexingService;
import org.quiltmc.enigma.util.Result;

import java.util.*;
import java.util.concurrent.CompletableFuture;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:03
 * Created by: Dani-error
 */
@AllArgsConstructor
public final class NavigationService implements Service {

    private final Session session;
    private final SourceService sources;

    @Override
    public void register() {
        JsonRpcConnection rpc = this.session.rpc();
        rpc.registerLater("nav/definition", PositionParams.class, this::definition);
        rpc.registerLater("nav/declaration", DeclarationParams.class, params -> this.locateDeclaration(EntryCodec.fromRef(params.entry()), SourceService.view(params.view())));
        rpc.registerLater("nav/reference", ReferenceParams.class, this::locateReference);
        rpc.registerLater("nav/references", ReferencesParams.class, this::references);
    }

    private Location location(View view, ClassEntry classEntry, SourceService.@Nullable Snapshot snapshot, List<Token> tokens) {
        EnigmaProject project = this.session.requireProject();
        List<Range> ranges = new ArrayList<>();
        if (snapshot != null) {
            for (Token token : tokens) {
                ranges.add(snapshot.lines().range(token));
            }
        }

        return new Location(classEntry.getFullName(), view, project.getRemapper().deobfuscate(classEntry).getFullName(), ranges.isEmpty() ? null : ranges.get(0), ranges);
    }

    /**
     * Mirrors {@code GuiController#getTokensForReference}, including the record component fallback of {@code BaseEditorPanel}.
     */
    private List<Token> tokensForReference(DecompiledClassSource source, EntryReference<Entry<?>, Entry<?>> reference) {
        EnigmaProject project = this.session.requireProject();
        EntryResolver resolver = project.getRemapper().getObfResolver();
        SourceIndex index = source.getIndex();

        List<Token> tokens = resolver.resolveReference(reference, ResolutionStrategy.RESOLVE_CLOSEST)
                .stream()
                .flatMap(r -> index.getReferenceTokens(r).stream())
                .sorted()
                .toList();

        if (tokens.isEmpty() && reference.entry instanceof MethodEntry method) {
            // record component getters often don't have a declaration token: try the field declaration instead
            FieldEntry field = project.getEnigma().getService(JarIndexerService.TYPE, RecordIndexingService.ID)
                    .map(service -> ((RecordIndexingService) service).getComponentField(method))
                    .orElse(null);
            if (field != null) {
                EntryReference<Entry<?>, Entry<?>> fieldReference = EntryReference.declaration(field, field.getName());
                tokens = resolver.resolveReference(fieldReference, ResolutionStrategy.RESOLVE_CLOSEST)
                        .stream()
                        .flatMap(r -> index.getReferenceTokens(r).stream())
                        .sorted()
                        .toList();
            }
        }

        return tokens;
    }

    /**
     * Finds where a reference is located, decompiling the class that contains it if needed.
     * This is what {@code Gui#showReference} does when it opens an editor and jumps to a token.
     */
    private CompletableFuture<Location> locate(EntryReference<Entry<?>, Entry<?>> reference, View view) {
        EnigmaProject project = this.session.requireProject();
        ClassEntry classEntry = reference.getLocationClassEntry().getOutermostClass();
        if (!project.getJarIndex().getIndex(EntryIndex.class).hasClass(classEntry)) {
            return CompletableFuture.completedFuture(null);
        }

        SourceService.Key key = new SourceService.Key(view, classEntry);
        return this.sources.withFresh(key, snapshot -> this.location(view, classEntry, snapshot, this.tokensForReference(snapshot.source(), reference)),
                this.location(view, classEntry, null, List.of()));
    }

    CompletableFuture<Location> locateDeclaration(Entry<?> entry, View view) {
        EnigmaProject project = this.session.requireProject();
        if (!project.isNavigable(entry)) {
            // entry is not in the jar, ignore it
            return CompletableFuture.completedFuture(null);
        }

        return this.locate(EntryReference.declaration(entry, entry.getName()), view);
    }

    private CompletableFuture<Location> locateReference(ReferenceParams params) {
        EnigmaProject project = this.session.requireProject();
        Entry<?> entry = EntryCodec.fromRef(params.entry());
        View view = SourceService.view(params.view());
        if (params.context() == null) {
            return this.locateDeclaration(entry, view);
        }

        Entry<?> context = EntryCodec.fromRef(params.context());
        EntryReference<Entry<?>, Entry<?>> reference = new EntryReference<>(entry, entry.getName(), context);
        if (!project.isNavigable(reference.getNameableEntry())) {
            return CompletableFuture.completedFuture(null);
        }

        return this.locate(reference, view);
    }

    private CompletableFuture<Location> definition(PositionParams params) {
        EnigmaProject project = this.session.requireProject();
        SourceService.Key key = this.sources.key(params.className(), params.view());
        return this.sources.<CompletableFuture<Location>>withServed(key, params.serial(), snapshot -> {
            Token token = SourceService.tokenAt(snapshot, params.line(), params.character());
            EntryReference<Entry<?>, Entry<?>> reference = snapshot.source().getIndex().getReference(token);
            if (token == null || reference == null) {
                return null;
            }

            // same as BaseEditorPanel#resolveReference: from a declaration, go to the root declaration
            Entry<?> target = reference.context == null
                    ? project.getRemapper().getObfResolver().resolveFirstEntry(reference.entry, ResolutionStrategy.RESOLVE_ROOT)
                    : reference.entry;

            if (!project.isNavigable(target)) {
                // local variables are not part of the jar index, but their declaration may be in this very source
                Token declaration = snapshot.source().getIndex().getDeclarationToken(reference.entry);
                if (declaration != null) {
                    return CompletableFuture.completedFuture(this.location(key.view(), key.entry(), snapshot, List.of(declaration)));
                }

                return CompletableFuture.completedFuture(null);
            }

            return this.locateDeclaration(target, key.view());
        }).thenCompose(future -> future == null ? CompletableFuture.completedFuture(null) : future);
    }

    private CompletableFuture<Location.Found> references(ReferencesParams params) {
        View view = SourceService.view(params.view());
        boolean includeDeclaration = Objects.requireNonNullElse(params.includeDeclaration(), true);
        int limit = Objects.requireNonNullElse(params.limit(), 150);

        if (params.entry() != null) {
            return this.findReferences(EntryCodec.fromRef(params.entry()), null, view, includeDeclaration, limit);
        }

        // otherwise it is about what is at a position of a text
        if (params.className() == null || params.line() == null || params.character() == null) {
            throw RpcException.invalidParams("Missing parameter: " + (params.className() == null ? "class" : params.line() == null ? "line" : "character"));
        }

        SourceService.Key key = this.sources.key(params.className(), params.view());
        return this.sources.withServed(key, params.serial(), snapshot -> {
            Token token = SourceService.tokenAt(snapshot, params.line(), params.character());
            EntryReference<Entry<?>, Entry<?>> reference = snapshot.source().getIndex().getReference(token);
            if (token == null || reference == null) {
                return null;
            }

            return this.findReferences(reference.entry, key.entry(), key.view(), includeDeclaration, limit);
        }).thenCompose(future -> future == null ? CompletableFuture.completedFuture(null) : future);
    }

    /**
     * Finds every occurrence of an entry in the decompiled source of the classes that the jar index says reference it.
     * @param origin the class the request was made from, always searched as it holds local variables and declarations
     */
    private CompletableFuture<Location.Found> findReferences(Entry<?> entry, @Nullable ClassEntry origin, View view, boolean includeDeclaration, int limit) {
        EnigmaProject project = this.session.requireProject();
        EntryResolver resolver = project.getJarIndex().getEntryResolver();
        ReferenceIndex referenceIndex = project.getJarIndex().getIndex(ReferenceIndex.class);
        EntryIndex entryIndex = project.getJarIndex().getIndex(EntryIndex.class);

        // the entries that count as "the same thing" in source, and the classes that may mention them
        Set<Entry<?>> targets = new HashSet<>();
        Set<ClassEntry> candidates = new LinkedHashSet<>();
        if (origin != null) {
            candidates.add(origin);
        }

        if (entry instanceof MethodEntry method && !method.isConstructor() && entryIndex.hasMethod(method)) {
            for (MethodEntry equivalent : resolver.resolveEquivalentMethods(method)) {
                targets.add(equivalent);
                candidates.add(equivalent.getParent().getOutermostClass());
                referenceIndex.getReferencesToMethod(equivalent).forEach(r -> candidates.add(r.getLocationClassEntry().getOutermostClass()));
            }

            targets.add(method);
        } else if (entry instanceof MethodEntry constructor) {
            // constructors, and methods that are declared outside the jar
            targets.add(constructor);
            candidates.add(constructor.getParent().getOutermostClass());
            referenceIndex.getReferencesToMethod(constructor).forEach(r -> candidates.add(r.getLocationClassEntry().getOutermostClass()));
        } else if (entry instanceof FieldEntry field) {
            targets.add(field);
            candidates.add(field.getParent().getOutermostClass());
            referenceIndex.getReferencesToField(field).forEach(r -> candidates.add(r.getLocationClassEntry().getOutermostClass()));
        } else if (entry instanceof ClassEntry classEntry) {
            targets.add(classEntry);
            candidates.add(classEntry.getOutermostClass());
            referenceIndex.getReferencesToClass(classEntry).forEach(r -> candidates.add(r.getLocationClassEntry().getOutermostClass()));
            referenceIndex.getFieldTypeReferencesToClass(classEntry).forEach(r -> candidates.add(r.getLocationClassEntry().getOutermostClass()));
            referenceIndex.getMethodTypeReferencesToClass(classEntry).forEach(r -> candidates.add(r.getLocationClassEntry().getOutermostClass()));
        } else {
            // local variables and parameters only exist inside their own class
            targets.add(entry);
            candidates.add(entry.getTopLevelClass());
        }

        List<ClassEntry> searched = new ArrayList<>();
        for (ClassEntry candidate : candidates) {
            if (entryIndex.hasClass(candidate)) {
                if (searched.size() >= limit) {
                    break;
                }

                searched.add(candidate);
            }
        }

        boolean truncated = searched.size() < candidates.stream().filter(entryIndex::hasClass).count();

        List<ClassHandle> temporary = new ArrayList<>();
        // the places in each class; the current name of the class is looked up at the end, on the thread that may
        List<CompletableFuture<List<Range>>> futures = new ArrayList<>();
        List<ClassEntry> inClass = new ArrayList<>();
        for (ClassEntry classEntry : searched) {
            CompletableFuture<Result<DecompiledClassSource, ClassHandleError>> sourceFuture = this.sources.sourceFor(view, classEntry, temporary);
            if (sourceFuture == null) {
                continue;
            }

            inClass.add(classEntry);
            futures.add(sourceFuture.handle((result, error) -> {
                if (error != null || result == null || result.isErr()) {
                    return null;
                }

                DecompiledClassSource source = result.unwrap();
                SourceIndex index = source.getIndex();
                LineIndex lines = new LineIndex(source.toString());
                List<Range> ranges = new ArrayList<>();
                for (Token token : index.referenceTokens()) {
                    EntryReference<Entry<?>, Entry<?>> reference = index.getReference(token);
                    if (reference == null || !targets.contains(reference.entry)) {
                        continue;
                    }

                    if (!includeDeclaration && reference.context == null) {
                        continue;
                    }

                    ranges.add(lines.range(token));
                }

                return ranges.isEmpty() ? null : ranges;
            }));
        }

        return CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).handleAsync((ignored, error) -> {
            temporary.forEach(ClassHandle::close);

            List<Location> locations = new ArrayList<>();
            for (int index = 0; index < futures.size(); index++) {
                List<Range> ranges = futures.get(index).getNow(null);
                if (ranges != null) {
                    ClassEntry classEntry = inClass.get(index);
                    locations.add(new Location(classEntry.getFullName(), view, project.getRemapper().deobfuscate(classEntry).getFullName(), null, ranges));
                }
            }

            return new Location.Found(locations, truncated, searched.size());
        }, this.sources.session());
    }

}
