package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryInfo;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.project.Editable;
import dev.danibcastro.enigmavscode.backend.protocol.source.*;
import dev.danibcastro.enigmavscode.backend.rpc.Announcement;
import dev.danibcastro.enigmavscode.backend.rpc.EntryCodec;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.service.Service;
import dev.danibcastro.enigmavscode.backend.util.LineIndex;
import lombok.RequiredArgsConstructor;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.analysis.EntryReference;
import org.quiltmc.enigma.api.class_handle.ClassHandle;
import org.quiltmc.enigma.api.class_handle.ClassHandleError;
import org.quiltmc.enigma.api.class_handle.ClassHandleProvider;
import org.quiltmc.enigma.api.event.ClassHandleListener;
import org.quiltmc.enigma.api.service.DecompilerService;
import org.quiltmc.enigma.api.source.*;
import org.quiltmc.enigma.api.translation.mapping.EntryResolver;
import org.quiltmc.enigma.api.translation.mapping.ResolutionStrategy;
import org.quiltmc.enigma.api.translation.representation.entry.*;
import org.quiltmc.enigma.util.Result;

import org.tinylog.Logger;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:12
 * Created by: Dani-error
 */
@RequiredArgsConstructor
public final class SourceService implements Service {

    /** How many classes that are not shown in an editor are kept decompiled, to make navigation and reference searches fast. */
    private static final int MAX_UNPINNED = 48;
    private static final long SOURCE_TIMEOUT_SECONDS = 600;

    /** How often a source that could not be produced is asked for again before the failure is reported. */
    private static final int MAX_RETRIES = 3;

    private final Session session;
    private final EntryService entries;

    private final Map<Key, OpenClass> classes = new LinkedHashMap<>();

    @Nullable
    private ClassHandleProvider sourceProvider;
    @Nullable
    private ClassHandleProvider bytecodeProvider;
    private long useCounter;

    record Key(View view, ClassEntry entry) { }

    record Snapshot(DecompiledClassSource source, LineIndex lines) { }

    /**
     * A class that is currently decompiled. {@code pinned} classes are shown in an editor on the client.
     */
    final class OpenClass implements ClassHandleListener {
        final Key key;
        final ClassHandle handle;
        volatile boolean pinned;
        long lastUsed;
        /** Whether the engine has produced a source for this class at least once. */
        volatile boolean ready;
        @Nullable
        private CompletableFuture<Result<DecompiledClassSource, ClassHandleError>> pending;
        /** The exact source the client is displaying. Positions sent by the client refer to this text. */
        @Nullable
        volatile Snapshot served;
        /** Identifies the text the client was last given, whatever it was. */
        volatile long servedSerial;
        @Nullable
        volatile String servedText;
        @Nullable
        private Snapshot latest;

        OpenClass(Key key, ClassHandle handle) {
            this.key = key;
            this.handle = handle;
            handle.addListener(this);
        }

        /** What the source is being produced again for, as long as none has arrived. */
        @Nullable
        private InvalidationType underWay;
        /** How often in a row producing the source failed and was tried again. */
        private int retries;
        /** What has to be done once more: see {@link #onInvalidate}. */
        @Nullable
        private InvalidationType again;

        /**
         * Enigma produces a source in steps: decompile, insert javadoc, map names. A change of the mappings only
         * repeats the last step, on the source of the steps before it. When it comes while those are being repeated,
         * for a javadoc that changed a moment earlier, it works on what they produced the previous time, and their
         * new result is discarded as outdated: the class keeps a javadoc it no longer has, or lacks the one it got.
         * Nobody clicks that fast, but an assistant that documents and renames does. So the earlier steps are asked
         * for once more when that happened, and the source that came out of it is not passed on.
         */
        @Override
        public synchronized void onInvalidate(ClassHandle h, InvalidationType t) {
            if (this.pending == null || this.pending.isDone()) {
                this.pending = new CompletableFuture<>();
            }

            if (t == InvalidationType.MAPPINGS) {
                if (this.underWay != null && this.underWay != InvalidationType.MAPPINGS) {
                    this.again = this.underWay;
                } else if (this.underWay == null) {
                    this.underWay = t;
                }
            } else {
                // The other way round as well: a javadoc that changes while the names are being mapped again, as
                // when a javadoc is undone right after a rename. What is under way started before it, and is not
                // passed on: the source produced once more is the one that is waited for.
                if (this.underWay != null) {
                    this.again = this.again == InvalidationType.FULL || t == InvalidationType.FULL ? InvalidationType.FULL : t;
                }

                if (this.underWay != InvalidationType.FULL) {
                    this.underWay = t;
                }
            }
        }

        @Override
        public void onMappedSourceChanged(ClassHandle h, Result<DecompiledClassSource, ClassHandleError> res) {
            InvalidationType repeat;
            synchronized (this) {
                repeat = this.again;
                this.again = null;
                this.underWay = null;
            }

            if (repeat != null) {
                // comes back here with the source that is right
                if (repeat == InvalidationType.FULL) {
                    this.handle.invalidate();
                } else {
                    this.handle.invalidateJavadoc();
                }

                return;
            }

            // Enigma produces sources on threads of its own, from mappings that are changed on ours and from classes
            // it may be decompiling a second time just then, and it is not made for either: now and then it trips,
            // over a collection modified while it is read, or over something missing that was there a moment before.
            // What it then reports as a class that cannot be shown is a matter of trying again, a moment later. A
            // class that really cannot be decompiled fails the same way each time, and is reported after that.
            if (res.isErr() && this.retries < MAX_RETRIES) {
                int attempt = ++this.retries;
                CompletableFuture.delayedExecutor(120L * attempt, TimeUnit.MILLISECONDS).execute(this::retry);
                return;
            }

            if (res.isOk()) {
                this.retries = 0;
            }

            CompletableFuture<Result<DecompiledClassSource, ClassHandleError>> waiting;
            synchronized (this) {
                this.ready = true;
                waiting = this.pending;
                this.pending = null;
            }

            if (waiting != null) {
                waiting.complete(res);
            }

            if (this.pinned) {
                SourceService.this.session.rpc().notify(Announcement.SOURCE_CHANGED, new SourceChanged(this.key.entry().getFullName(), this.key.view()));
            }
        }

        /** Decompiles the class again, unless it is gone in the meantime: closed, or its jar reloaded. */
        private void retry() {
            try {
                this.handle.invalidate();
            } catch (IllegalStateException e) {
                // nothing is waiting for a class that is no longer there
                Logger.debug("Not trying {} again: {}", this.key.entry().getFullName(), e.getMessage());
            }
        }

        /**
         * Waits for the up-to-date source of this class, taking pending invalidations into account.
         */
        CompletableFuture<Result<DecompiledClassSource, ClassHandleError>> await() {
            CompletableFuture<Result<DecompiledClassSource, ClassHandleError>> future;
            synchronized (this) {
                future = this.pending != null && !this.pending.isDone() ? this.pending : null;
            }

            if (future == null) {
                future = this.handle.getSource();
            }

            return future.thenApply(result -> {
                this.ready = true;
                return result;
            }).orTimeout(SOURCE_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }

        Snapshot snapshot(DecompiledClassSource source) {
            Snapshot cached = this.latest;
            if (cached == null || cached.source() != source) {
                cached = new Snapshot(source, new LineIndex(source.toString()));
                this.latest = cached;
            }

            return cached;
        }
    }


    @Override
    public void register() {
        JsonRpcConnection rpc = this.session.rpc();
        rpc.registerLater("class/source", ClassParams.class, this::source);
        rpc.registerAction("class/close", ClassParams.class, this::close);
        rpc.registerAction("class/reload", ClassParams.class, this::reload);
        rpc.registerLater("class/entryAt", PositionParams.class, this::entryAt);
        rpc.registerLater("class/symbols", TextParams.class, this::symbols);
    }

    public void onProjectOpened(EnigmaProject project, DecompilerService decompiler) {
        this.sourceProvider = new ClassHandleProvider(project, new IsolatedDecompilerService(decompiler));
        this.bytecodeProvider = new ClassHandleProvider(project, Decompilers.BYTECODE);
    }

    public void onProjectClosed() {
        for (OpenClass open : this.classes.values()) {
            open.handle.removeListener(open);
        }

        this.classes.clear();
        if (this.sourceProvider != null) {
            this.sourceProvider.destroy();
            this.sourceProvider = null;
        }

        if (this.bytecodeProvider != null) {
            this.bytecodeProvider.destroy();
            this.bytecodeProvider = null;
        }
    }

    public void setDecompiler(DecompilerService decompiler) {
        if (this.sourceProvider != null) {
            // invalidates every open class
            this.sourceProvider.setDecompilerService(new IsolatedDecompilerService(decompiler));
        }
    }

    // A handle must never be partially invalidated before its first source arrived: the engine would drop both the
    // running decompilation and the new request, and the class would never finish loading. Fall back to a full
    // invalidation in that case.

    public void invalidateAll() {
        for (OpenClass open : this.classes.values()) {
            open.handle.invalidate();
        }
    }

    void invalidateMapped() {
        for (OpenClass open : this.classes.values()) {
            if (open.ready) {
                open.handle.invalidateMapped();
            } else {
                open.handle.invalidate();
            }
        }
    }

    void invalidateJavadoc() {
        for (OpenClass open : this.classes.values()) {
            invalidateJavadoc(open);
        }
    }

    void invalidateJavadoc(ClassEntry classEntry) {
        ClassEntry outermost = classEntry.getOutermostClass();
        for (OpenClass open : this.classes.values()) {
            if (open.key.entry().equals(outermost)) {
                invalidateJavadoc(open);
            }
        }
    }

    private static void invalidateJavadoc(OpenClass open) {
        if (open.ready) {
            open.handle.invalidateJavadoc();
        } else {
            open.handle.invalidate();
        }
    }

    /** The view that is meant: the source, if none is said. */
    static View view(@Nullable View sent) {
        return sent == null ? View.SOURCE : sent;
    }

    Key key(String className, @Nullable View view) {
        return new Key(view(view), new ClassEntry(className).getOutermostClass());
    }

    private OpenClass open(Key key) {
        this.session.requireProject();
        OpenClass open = this.classes.get(key);
        if (open == null) {
            ClassHandleProvider provider = key.view() == View.BYTECODE ? this.bytecodeProvider : this.sourceProvider;
            ClassHandle handle = provider == null ? null : provider.openClass(key.entry());
            if (handle == null) {
                throw RpcException.said(Problem.CLASS_NOT_FOUND, key.entry().getFullName());
            }

            open = new OpenClass(key, handle);
            this.classes.put(key, open);
        }

        open.lastUsed = ++this.useCounter;
        this.evict();
        return open;
    }

    private void evict() {
        int unpinned = 0;
        for (OpenClass open : this.classes.values()) {
            if (!open.pinned) {
                unpinned++;
            }
        }

        while (unpinned > MAX_UNPINNED) {
            OpenClass oldest = null;
            for (OpenClass open : this.classes.values()) {
                if (!open.pinned && (oldest == null || open.lastUsed < oldest.lastUsed)) {
                    oldest = open;
                }
            }

            if (oldest == null) {
                return;
            }

            this.release(oldest);
            unpinned--;
        }
    }

    private void release(OpenClass open) {
        this.classes.remove(open.key);
        open.handle.removeListener(open);
        open.handle.close();
    }

    Executor session() {
        return this.session.rpc().getSessionExecutor();
    }

    /**
     * Runs {@code action} against the up-to-date source of a class.
     */
    <T> CompletableFuture<T> withFresh(Key key, Function<Snapshot, T> action, @Nullable T onError) {
        OpenClass open = this.open(key);
        return open.await().thenApplyAsync(result -> {
            if (result.isErr()) {
                return onError;
            }

            return action.apply(open.snapshot(result.unwrap()));
        }, this.session());
    }

    /**
     * Runs {@code action} against the source the client is looking at, so that the positions it sent are meaningful.
     */
    <T> CompletableFuture<T> withServed(Key key, @Nullable Long serial, Function<Snapshot, T> action) {
        OpenClass open = this.open(key);
        // A client that says which text its positions are for gets told when that is no longer the one it was given
        // last: another one is on its way to it then, and it asks again once it shows that.
        if (serial != null && serial != open.servedSerial) {
            throw new RpcException(RpcException.STALE, "The class changed since this position was read.");
        }

        Snapshot served = open.served;
        if (served != null) {
            return CompletableFuture.completedFuture(action.apply(served));
        }

        return this.withFresh(key, action, null);
    }

    /**
     * The source of a class for a search through many classes: that of the class the client has open, or one that is
     * decompiled for the occasion. The latter gets a handle of its own, added to {@code temporary} for the caller to
     * close, so that a large search cannot evict the classes of the editor.
     * @return null if there is no such class
     */
    @Nullable
    CompletableFuture<Result<DecompiledClassSource, ClassHandleError>> sourceFor(View view, ClassEntry classEntry, List<ClassHandle> temporary) {
        OpenClass open = this.classes.get(new Key(view, classEntry));
        if (open != null) {
            return open.await();
        }

        ClassHandleProvider provider = view == View.BYTECODE ? this.bytecodeProvider : this.sourceProvider;
        ClassHandle handle = provider == null ? null : provider.openClass(classEntry);
        if (handle == null) {
            return null;
        }

        temporary.add(handle);
        return handle.getSource().orTimeout(SOURCE_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private CompletableFuture<ClassSource> source(ClassParams params) {
        Key key = this.key(params.className(), params.view());
        OpenClass open = this.open(key);
        open.pinned = true;
        return open.await().thenApplyAsync(result -> this.buildSource(open, result), this.session());
    }

    /** Counts the texts given to the client. */
    private long serial;

    /**
     * Numbers the text that is about to be given out. The number is what positions are checked against, so it only
     * changes with the text: a class can be shown by several documents, as after it was renamed, when the editor
     * still has the one of its previous name. Each of them asks for the text, and none must invalidate what the
     * others were told about the very same text.
     */
    private long number(OpenClass open, String text) {
        if (open.servedSerial == 0 || !text.equals(open.servedText)) {
            open.servedSerial = ++this.serial;
            open.servedText = text;
        }

        return open.servedSerial;
    }

    private ClassSource buildSource(OpenClass open, Result<DecompiledClassSource, ClassHandleError> result) {
        EnigmaProject project = this.session.requireProject();
        String className = open.key.entry().getFullName();
        String deobfName = project.getRemapper().deobfuscate(open.key.entry()).getFullName();

        Map<TokenCategory, List<Range>> tokens = new EnumMap<>(TokenCategory.class);
        for (TokenCategory category : TokenCategory.values()) {
            tokens.put(category, new ArrayList<>());
        }

        if (result.isErr()) {
            ClassHandleError error = result.unwrapErr();
            open.served = null;
            String trace = error.getStackTrace();
            String text = "// Enigma failed to " + (error.type == ClassHandleError.Type.DECOMPILE ? "decompile" : "remap") + " this class.\n\n"
                    + (trace == null ? "" : "/*\n" + trace.replace("*/", "* /") + "\n*/\n");
            return new ClassSource(className, open.key.view(), deobfName, this.session.revision(), this.number(open, text), text,
                    new ClassSource.Failure(error.type, error.cause == null ? null : String.valueOf(error.cause)), tokens, List.of(), List.of());
        }

        DecompiledClassSource source = result.unwrap();
        Snapshot snapshot = open.snapshot(source);
        open.served = snapshot;

        TokenStore store = source.getTokenStore();
        SourceIndex index = source.getIndex();
        Map<Token, TokenCategory> categories = new HashMap<>();
        for (Map.Entry<TokenType, NavigableSet<Token>> entry : store.getByType().entrySet()) {
            TokenCategory base = switch (entry.getKey()) {
                case OBFUSCATED -> TokenCategory.OBFUSCATED;
                case DEOBFUSCATED -> TokenCategory.DEOBFUSCATED;
                case DEBUG -> TokenCategory.DEBUG;
                case JAR_PROPOSED, DYNAMIC_PROPOSED -> TokenCategory.PROPOSED;
            };

            for (Token token : entry.getValue()) {
                TokenCategory category = base;
                EntryReference<Entry<?>, Entry<?>> reference = index.getReference(token);
                if (reference != null) {
                    // same rule as BaseEditorPanel#setHighlightedTokens
                    boolean editable = this.session.isEditable(editableType(reference.entry));
                    category = editable ? (store.isFallback(token) ? TokenCategory.FALLBACK : base) : TokenCategory.PROPOSED;
                }

                tokens.get(category).add(snapshot.lines().range(token));
                categories.put(token, category);
            }
        }

        List<ClassSource.Group> groups = new ArrayList<>();
        List<NameRef> refs = new ArrayList<>();
        this.describeZones(groups, refs, snapshot, categories, open.key.view() == View.SOURCE);
        String text = source.toString();
        return new ClassSource(className, open.key.view(), deobfName, this.session.revision(), this.number(open, text), text, null, tokens, refs, groups);
    }

    /**
     * Describes every name in the source for the editor, which lets names be edited in place.
     *
     * <p>{@code refs} lists all tokens in document order as {@code [line, character, length, group, flags, category]}.
     * Tokens of the same group are occurrences of one name: they are renamed together, so the editor changes them
     * together while the user types. {@code groups} says what each group renames.
     */
    private void describeZones(List<ClassSource.Group> groups, List<NameRef> refs, Snapshot snapshot, Map<Token, TokenCategory> categories, boolean editable) {
        EnigmaProject project = this.session.requireProject();
        EntryResolver resolver = project.getRemapper().getObfResolver();
        SourceIndex index = snapshot.source().getIndex();

        Map<Entry<?>, Integer> groupIndices = new HashMap<>();
        Map<Entry<?>, Entry<?>> canonical = new HashMap<>();

        for (Token token : index.referenceTokens()) {
            EntryReference<Entry<?>, Entry<?>> reference = index.getReference(token);
            if (reference == null) {
                continue;
            }

            Entry<?> nameable = reference.getNameableEntry();
            // overrides share the name of the method they override: they belong to the group of its root declaration
            Entry<?> key = canonical.computeIfAbsent(nameable, entry -> {
                try {
                    return resolver.resolveFirstEntry(entry, ResolutionStrategy.RESOLVE_ROOT);
                } catch (RuntimeException e) {
                    return entry;
                }
            });

            Integer group = groupIndices.get(key);
            if (group == null) {
                group = groups.size();
                groupIndices.put(key, group);
                groups.add(new ClassSource.Group(EntryCodec.toRef(nameable), this.entries.symbolKind(nameable), this.entries.editableName(nameable, token.text)));
            }

            boolean renamable = editable && project.isRenamable(reference) && this.session.isEditable(editableType(reference.entry));
            refs.add(new NameRef(snapshot.lines().range(token), group, reference.context == null, renamable, categories.get(token)));
        }
    }

    private void close(ClassParams params) {
        OpenClass open = this.classes.get(this.key(params.className(), params.view()));
        if (open != null) {
            open.pinned = false;
            open.served = null;
            this.evict();
        }
    }

    private void reload(ClassParams params) {
        OpenClass open = this.classes.get(this.key(params.className(), params.view()));
        if (open != null) {
            open.handle.invalidate();
        }
    }

    /** What has to be allowed for the name of an entry to be changed. */
    static Editable editableType(Entry<?> entry) {
        if (entry instanceof MethodEntry method) {
            // renaming a constructor renames the class
            return method.isConstructor() ? Editable.CLASS : Editable.METHOD;
        } else if (entry instanceof FieldEntry) {
            return Editable.FIELD;
        } else if (entry instanceof LocalVariableEntry local) {
            return local.isArgument() ? Editable.PARAMETER : Editable.LOCAL;
        }

        return Editable.CLASS;
    }

    @Nullable
    static Token tokenAt(Snapshot snapshot, int line, int character) {
        int offset = snapshot.lines().offsetOf(line, character);
        return snapshot.source().getIndex().getReferenceToken(offset);
    }

    private CompletableFuture<TokenInfo> entryAt(PositionParams params) {
        return this.withServed(this.key(params.className(), params.view()), params.serial(), snapshot -> {
            Token token = tokenAt(snapshot, params.line(), params.character());
            EntryReference<Entry<?>, Entry<?>> reference = snapshot.source().getIndex().getReference(token);
            if (token == null || reference == null) {
                return null;
            }

            return this.describeReference(snapshot, token, reference);
        });
    }

    private TokenInfo describeReference(Snapshot snapshot, Token token, EntryReference<Entry<?>, Entry<?>> reference) {
        EnigmaProject project = this.session.requireProject();
        // in a text, what a name renames depends on where it stands: a constructor is named like its class
        Entry<?> nameable = reference.getNameableEntry();
        boolean renamable = project.isRenamable(reference);
        EntryInfo info = this.entries.describe(reference.entry).withRenaming(new EntryInfo.Renaming(
                renamable && this.session.isEditable(editableType(reference.entry)), renamable && this.session.isEditable(Editable.JAVADOC),
                EntryCodec.toRef(nameable), this.entries.editableName(nameable, token.text)));
        return new TokenInfo(info, snapshot.lines().range(token), token.text, reference.context == null, reference.context == null ? null : EntryCodec.toRef(reference.context));
    }

    private CompletableFuture<List<Symbol>> symbols(TextParams params) {
        return this.withServed(this.key(params.className(), params.view()), params.serial(), snapshot -> {
            SourceIndex index = snapshot.source().getIndex();
            List<Symbol> symbols = new ArrayList<>();
            Map<Entry<?>, Integer> indices = new HashMap<>();
            for (Entry<?> entry : index.declarations()) {
                Token token = index.getDeclarationToken(entry);
                if (token == null) {
                    continue;
                }

                Integer parent = entry.getParent() == null ? null : indices.get(entry.getParent());
                indices.put(entry, symbols.size());
                symbols.add(new Symbol(EntryCodec.toRef(entry), this.entries.symbolKind(entry), token.text, this.entries.symbolDetail(entry), snapshot.lines().range(token), parent));
            }

            return symbols;
        });
    }
}
