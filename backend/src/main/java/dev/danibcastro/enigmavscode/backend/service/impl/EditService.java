package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.EditHistory;
import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.edit.*;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.project.Editable;
import dev.danibcastro.enigmavscode.backend.protocol.wire.EnumAdapterFactory;
import dev.danibcastro.enigmavscode.backend.rpc.EntryCodec;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.service.Service;
import dev.danibcastro.enigmavscode.backend.util.PackageRenamePlanner;
import lombok.RequiredArgsConstructor;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.analysis.index.jar.InheritanceIndex;
import org.quiltmc.enigma.api.source.TokenType;
import org.quiltmc.enigma.api.translation.mapping.EntryChange;
import org.quiltmc.enigma.api.translation.mapping.EntryMapping;
import org.quiltmc.enigma.api.translation.mapping.EntryRemapper;
import org.quiltmc.enigma.api.translation.mapping.ResolutionStrategy;
import org.quiltmc.enigma.api.translation.representation.entry.ClassEntry;
import org.quiltmc.enigma.api.translation.representation.entry.Entry;
import org.quiltmc.enigma.api.translation.representation.entry.LocalVariableEntry;
import org.quiltmc.enigma.api.translation.representation.entry.MethodEntry;
import org.quiltmc.enigma.util.EntryUtil;
import org.quiltmc.enigma.util.I18n;
import org.quiltmc.enigma.util.TristateChange;
import org.quiltmc.enigma.util.validation.Message;
import org.quiltmc.enigma.util.validation.ParameterizedMessage;
import org.quiltmc.enigma.util.validation.ValidationContext;

import java.util.*;
import java.util.function.Consumer;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:21
 * Created by: Dani-error
 */
@RequiredArgsConstructor
public final class EditService implements Service {

    private final Session session;
    private final EntryService entries;
    private final SourceService sources;
    private final MappingsService mappings;

    /** Told about every change made here, so that those working on the same mappings get it too. */
    private final List<Consumer<EntryChange<?>>> changeListeners = new ArrayList<>();

    /**
     * Collects validation messages instead of showing them, so that they can be returned to the client.
     */
    private static final class CollectingNotifier implements ValidationContext.Notifier {
        final List<ParameterizedMessage> messages = new ArrayList<>();

        @Override
        public void notify(ParameterizedMessage message) {
            this.messages.add(message);
        }

        @Override
        public boolean verifyWarning(ParameterizedMessage message) {
            // warnings are confirmed by the user before the change is applied for real
            return true;
        }

        boolean has(Message.Type type) {
            return this.messages.stream().anyMatch(m -> m.getType() == type);
        }

        List<ValidationMessage> toMessages() {
            List<ValidationMessage> json = new ArrayList<>();
            // the engine reports the same problem once per entry that shares the name: an override and what it overrides
            Set<String> seen = new HashSet<>();
            for (ParameterizedMessage message : this.messages) {
                if (!seen.add(message.getType() + "\n" + message.getText() + "\n" + message.getLongText())) {
                    continue;
                }

                String details = message.getLongText();
                json.add(new ValidationMessage(message.getType(), message.getText(), details.isEmpty() ? null : details));
            }

            return json;
        }
    }

    @Override
    public void register() {
        JsonRpcConnection rpc = this.session.rpc();
        rpc.register("entry/rename", RenameParams.class, this::rename);
        rpc.register("entry/setJavadoc", SetJavadocParams.class, this::setJavadoc);
        rpc.register("entry/toggleMapping", ToggleMappingParams.class, this::toggleMapping);
        rpc.register("edit/undo", () -> this.undoOrRedo(true));
        rpc.register("edit/redo", () -> this.undoOrRedo(false));
        rpc.register("package/rename", RenamePackageParams.class, this::renamePackage);
    }

    /** Has every change that is made here told to someone: whoever passes them on to the others in a session. */
    public void onChange(Consumer<EntryChange<?>> listener) {
        this.changeListeners.add(listener);
    }

    private void changed(EntryChange<?> change) {
        this.changeListeners.forEach(listener -> listener.accept(change));
    }

    private void requireEditable(Editable type) {
        if (!this.session.isEditable(type)) {
            throw RpcException.said(Problem.EDITING_DISABLED, EnumAdapterFactory.wireName(type));
        }
    }

    private EditResult rename(RenameParams params) {
        EnigmaProject project = this.session.requireProject();
        Entry<?> entry = EntryCodec.fromRef(params.entry());
        String newName = params.newName();
        if (entry instanceof MethodEntry method && method.isConstructor()) {
            // renaming a constructor really means renaming the class
            entry = method.getContainingClass();
        }

        this.requireEditable(SourceService.editableType(entry));
        if (!project.isRenamable(entry)) {
            throw RpcException.said(Problem.NOT_RENAMABLE);
        }

        String oldName = this.entries.editableName(entry, entry.getName());
        EntryChange<?> change = EntryChange.modify(entry).withDeobfName(newName);
        return this.applyUserChange(List.of(change), Change.of(ChangeKind.RENAME, oldName, newName),
                Objects.requireNonNullElse(params.confirmWarnings(), false), Objects.requireNonNullElse(params.validateOnly(), false));
    }

    private EditResult setJavadoc(SetJavadocParams params) {
        this.session.requireProject();
        Entry<?> entry = EntryCodec.fromRef(params.entry());
        String javadoc = params.javadoc();
        this.requireEditable(Editable.JAVADOC);

        // the entry itself is used rather than the nameable entry, as constructors can be documented
        EntryChange<?> change = javadoc == null || javadoc.isBlank()
                ? EntryChange.modify(entry).clearJavadoc()
                : EntryChange.modify(entry).withJavadoc(javadoc);
        return this.applyUserChange(List.of(change), Change.of(ChangeKind.EDIT_JAVADOC, this.entries.editableName(entry, entry.getName())),
                Objects.requireNonNullElse(params.confirmWarnings(), false), false);
    }

    /**
     * Mirrors {@code Gui#toggleMappingFromEntry}: marks an entry as deobfuscated, or resets it to its proposed or obfuscated name.
     */
    private EditResult toggleMapping(ToggleMappingParams params) {
        EnigmaProject project = this.session.requireProject();
        Entry<?> obfEntry = EntryCodec.fromRef(params.entry());
        if (obfEntry instanceof MethodEntry method && method.isConstructor()) {
            obfEntry = method.getContainingClass();
        }

        this.requireEditable(SourceService.editableType(obfEntry));
        if (!project.isRenamable(obfEntry)) {
            throw RpcException.said(Problem.NOT_RENAMABLE);
        }

        EntryRemapper remapper = project.getRemapper();
        Entry<?> resolvedEntry = remapper.getObfResolver().resolveFirstEntry(obfEntry, ResolutionStrategy.RESOLVE_ROOT);
        EntryMapping mapping = remapper.getMapping(resolvedEntry);

        EntryChange<?> change = EntryChange.modify(resolvedEntry);
        Change label;
        if (mapping.targetName() != null) {
            if (mapping.tokenType().isProposed()) {
                change = change.withTokenType(TokenType.DEOBFUSCATED).clearSourcePluginId();
                label = Change.of(ChangeKind.MARK_DEOBFUSCATED, mapping.targetName());
            } else {
                EntryMapping proposedMapping = remapper.getProposedMappings().get(resolvedEntry);
                if (proposedMapping != null) {
                    change = change.withDeobfName(proposedMapping.targetName()).withTokenType(proposedMapping.tokenType()).withSourcePluginId(proposedMapping.sourcePluginId());
                } else {
                    change = change.clearDeobfName();
                }

                label = Change.of(ChangeKind.RESET_OBFUSCATED, mapping.targetName());
            }
        } else {
            change = change.withDeobfName(obfEntry.getName());
            label = Change.of(ChangeKind.MARK_DEOBFUSCATED, obfEntry.getName());
        }

        return this.applyUserChange(List.of(change), label, Objects.requireNonNullElse(params.confirmWarnings(), false), false);
    }

    private static EditResult result(boolean applied, boolean needsConfirmation, CollectingNotifier notifier) {
        return new EditResult(applied, needsConfirmation, notifier.toMessages(), null, null);
    }

    /**
     * Validates, then applies changes requested by the user as a single undoable step.
     *
     * <p>A single change is not applied if it has errors, or warnings the user did not confirm yet.
     * Batches (package renames) behave like upstream: every change is attempted on its own and failures are reported.
     */
    private EditResult applyUserChange(List<? extends EntryChange<?>> changes, Change label, boolean confirmWarnings, boolean validateOnly) {
        EnigmaProject project = this.session.requireProject();
        EntryRemapper remapper = project.getRemapper();
        boolean single = changes.size() == 1;

        CollectingNotifier dryNotifier = new CollectingNotifier();
        if (single) {
            // dry run: collect errors and warnings without touching anything
            EntryChange<?> change = changes.get(0);
            ValidationContext dry = new ValidationContext(dryNotifier);
            validateJavadocChange(dry, change);
            EntryMapping next = EntryUtil.applyChange(remapper.getMapping(change.getTarget()), change);
            remapper.validatePutMapping(dry, change.getTarget(), next);

            if (dryNotifier.has(Message.Type.ERROR)) {
                return result(false, false, dryNotifier);
            }

            if (validateOnly || (dryNotifier.has(Message.Type.WARNING) && !confirmWarnings)) {
                return result(false, dryNotifier.has(Message.Type.WARNING), dryNotifier);
            }
        }

        List<EditHistory.Snap> snaps = new ArrayList<>();
        Set<ClassEntry> renamedClasses = new LinkedHashSet<>();
        CollectingNotifier notifier = new CollectingNotifier();
        int appliedCount = 0;
        for (EntryChange<?> change : changes) {
            ValidationContext vc = new ValidationContext(notifier, false);
            validateJavadocChange(vc, change);
            if (!vc.canProceed()) {
                continue;
            }

            Map<Entry<?>, EntryMapping> before = this.capture(remapper, change.getTarget());
            if (!this.applyChange(vc, change, renamedClasses)) {
                continue;
            }

            appliedCount++;
            before.forEach((entry, mapping) -> {
                EntryMapping after = remapper.getMapping(entry);
                if (!mapping.equals(after)) {
                    snaps.add(new EditHistory.Snap(entry, mapping, after));
                }
            });

            this.changed(change);
        }

        if (!snaps.isEmpty()) {
            this.session.history().record(new EditHistory.Step(label, snaps));
        }

        if (appliedCount > 0) {
            this.session.notifyMappingsChanged(this.entries.classItems(renamedClasses));
            this.mappings.autoSaveIfEnabled();
        }

        // surface the warnings the user confirmed alongside anything raised while applying
        notifier.messages.addAll(0, dryNotifier.messages);
        return new EditResult(single ? appliedCount == 1 : appliedCount > 0, false, notifier.toMessages(), appliedCount, null);
    }

    /**
     * Remembers the mappings an edit of {@code target} can touch: the entry itself and the roots renames propagate to.
     */
    private Map<Entry<?>, EntryMapping> capture(EntryRemapper remapper, Entry<?> target) {
        Map<Entry<?>, EntryMapping> state = new LinkedHashMap<>();
        state.put(target, remapper.getMapping(target));
        for (Entry<?> root : remapper.getObfResolver().resolveEntry(target, ResolutionStrategy.RESOLVE_ROOT)) {
            state.putIfAbsent(root, remapper.getMapping(root));
        }

        for (Entry<?> equivalent : remapper.getObfResolver().resolveEquivalentEntries(target)) {
            state.putIfAbsent(equivalent, remapper.getMapping(equivalent));
        }

        return state;
    }

    private static void validateJavadocChange(ValidationContext vc, EntryChange<?> change) {
        TristateChange<String> javadoc = change.getJavadoc();
        if (javadoc.isSet() && javadoc.getNewValue().contains("*/")) {
            vc.raise(Message.ILLEGAL_DOC_COMMENT_END);
        }
    }

    /**
     * The equivalent of {@code GuiController#applyChange0}.
     * @return whether the change was applied
     */
    boolean applyChange(ValidationContext vc, EntryChange<?> change, @Nullable Set<ClassEntry> renamedClasses) {
        EnigmaProject project = this.session.requireProject();
        EntryRemapper remapper = project.getRemapper();
        Entry<?> target = change.getTarget();
        EntryMapping prev = remapper.getMapping(target);
        EntryMapping mapping = EntryUtil.applyChange(vc, remapper, change);
        if (!vc.canProceed()) {
            return false;
        }

        this.afterMappingChanged(target, prev, mapping, renamedClasses);
        return true;
    }

    private void afterMappingChanged(Entry<?> target, EntryMapping prev, EntryMapping mapping, @Nullable Set<ClassEntry> renamedClasses) {
        EnigmaProject project = this.session.requireProject();
        if (!Objects.equals(prev.targetName(), mapping.targetName()) || !Objects.equals(prev.tokenType(), mapping.tokenType())) {
            this.sources.invalidateMapped();

            // local variable entries need to be propagated up the tree to update param names in javadoc
            if (target instanceof LocalVariableEntry) {
                this.sources.invalidateJavadoc(target.getTopLevelClass());

                Collection<ClassEntry> children = project.getJarIndex().getIndex(InheritanceIndex.class).getChildren(target.getContainingClass());
                for (ClassEntry child : children) {
                    this.sources.invalidateJavadoc(child.getTopLevelClass());
                }
            }

            if (target instanceof ClassEntry classEntry && !classEntry.isInnerClass() && renamedClasses != null) {
                renamedClasses.add(classEntry);
            }
        }

        if (!Objects.equals(prev.javadoc(), mapping.javadoc())) {
            this.sources.invalidateJavadoc(target.getTopLevelClass());
        }
    }

    /**
     * Applies a change that came from the collaboration server. Such changes are not undoable locally.
     */
    boolean applyRemoteChange(EntryChange<?> change) {
        CollectingNotifier notifier = new CollectingNotifier();
        ValidationContext vc = new ValidationContext(notifier, false);
        Set<ClassEntry> renamedClasses = new LinkedHashSet<>();
        boolean applied = this.applyChange(vc, change, renamedClasses);
        if (applied) {
            this.session.notifyMappingsChanged(this.entries.classItems(renamedClasses));
        }

        return applied;
    }

    private EditResult undoOrRedo(boolean undo) {
        EnigmaProject project = this.session.requireProject();
        EntryRemapper remapper = project.getRemapper();
        EditHistory history = this.session.history();
        EditHistory.Step step = undo ? history.takeUndo() : history.takeRedo();
        if (step == null) {
            throw RpcException.said(undo ? Problem.NOTHING_TO_UNDO : Problem.NOTHING_TO_REDO);
        }

        List<EditHistory.Snap> snaps = new ArrayList<>(step.snaps());
        if (undo) {
            Collections.reverse(snaps);
        }

        CollectingNotifier notifier = new CollectingNotifier();
        Set<ClassEntry> renamedClasses = new LinkedHashSet<>();
        boolean failed = false;
        for (EditHistory.Snap snap : snaps) {
            EntryMapping wanted = undo ? snap.before() : snap.after();
            EntryMapping current = remapper.getMapping(snap.entry());
            if (current.equals(wanted)) {
                continue;
            }

            ValidationContext vc = new ValidationContext(notifier, false);
            remapper.putMapping(vc, snap.entry(), wanted);
            if (!vc.canProceed()) {
                failed = true;
                break;
            }

            this.afterMappingChanged(snap.entry(), current, wanted, renamedClasses);
            this.changed(EntryUtil.changeFromMapping(snap.entry(), wanted));
        }

        // what could not be done all the way is not offered again
        if (!failed) {
            if (undo) {
                history.undone(step);
            } else {
                history.redone(step);
            }
        }

        this.session.notifyMappingsChanged(this.entries.classItems(renamedClasses));
        this.mappings.autoSaveIfEnabled();

        return new EditResult(!failed, false, notifier.toMessages(), null, step.change());
    }

    private PackageRename renamePackage(RenamePackageParams params) {
        EnigmaProject project = this.session.requireProject();
        this.requireEditable(Editable.CLASS);
        String from = params.from();
        String to = params.to();
        PackageMode mode = params.mode();
        boolean apply = Objects.requireNonNullElse(params.apply(), false);

        if (!PackageRenamePlanner.isValidPackageName(to)) {
            throw RpcException.user(I18n.translate("validation.message.invalid_package_name"));
        }

        Map<ClassEntry, String> renames = from.equals(to)
                ? Map.of()
                : new PackageRenamePlanner(mode).plan(this.entries.topLevelClasses(), project.getRemapper(), from, to);

        List<PackageRename.Planned> plan = new ArrayList<>();
        renames.forEach((obf, newName) -> plan.add(new PackageRename.Planned(obf.getFullName(), project.getRemapper().deobfuscate(obf).getFullName(), newName)));
        if (!apply || renames.isEmpty()) {
            return new PackageRename(plan, false, null, List.of(), null);
        }

        List<EntryChange<?>> changes = new ArrayList<>();
        renames.forEach((obf, newName) -> changes.add(EntryChange.modify(obf).withDeobfName(newName)));
        // warnings are ignored, like upstream: the user should not be bothered with every individual package created
        EditResult applied = this.applyUserChange(changes, Change.of(mode == PackageMode.MOVE ? ChangeKind.MOVE_PACKAGE : ChangeKind.RENAME_PACKAGE, from, to), true, false);
        return new PackageRename(plan, applied.applied(), applied.needsConfirmation(), applied.messages(), applied.appliedCount());
    }

}
