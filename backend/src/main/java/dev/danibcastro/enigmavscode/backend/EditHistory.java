package dev.danibcastro.enigmavscode.backend;

import dev.danibcastro.enigmavscode.backend.protocol.edit.Change;

import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.translation.mapping.EntryMapping;
import org.quiltmc.enigma.api.translation.representation.entry.Entry;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:31
 * Created by: Dani-error
 */
/**
 * What was changed in the mappings, so that it can be taken back and made again.
 */
public final class EditHistory {

    private static final int MAX_STEPS = 1000;

    /** The mapping of one entry before and after a change. */
    public record Snap(Entry<?> entry, EntryMapping before, EntryMapping after) { }

    /**
     * One thing the user did, which may have changed several entries.
     *
     * @param change what the user did, for "Undo ..."
     */
    public record Step(Change change, List<Snap> snaps) { }

    private final Deque<Step> done = new ArrayDeque<>();
    private final Deque<Step> undone = new ArrayDeque<>();

    /** Forgets everything. */
    public void clear() {
        this.done.clear();
        this.undone.clear();
    }

    /** Remembers something the user did. What was undone before it cannot be made again. */
    public void record(Step step) {
        this.done.push(step);
        while (this.done.size() > MAX_STEPS) {
            this.done.removeLast();
        }

        this.undone.clear();
    }

    /** The last thing done, to be taken back; it is no longer part of the history until it is put back. */
    @Nullable
    public Step takeUndo() {
        return this.done.poll();
    }

    /** The last thing taken back, to be made again. */
    @Nullable
    public Step takeRedo() {
        return this.undone.poll();
    }

    /** Puts back what {@link #takeUndo} gave, now that it was taken back. */
    public void undone(Step step) {
        this.undone.push(step);
    }

    /** Puts back what {@link #takeRedo} gave, now that it was made again. */
    public void redone(Step step) {
        this.done.push(step);
    }

    public boolean canUndo() {
        return !this.done.isEmpty();
    }

    public boolean canRedo() {
        return !this.undone.isEmpty();
    }

    @Nullable
    public Change undoLabel() {
        Step step = this.done.peek();
        return step == null ? null : step.change();
    }

    @Nullable
    public Change redoLabel() {
        Step step = this.undone.peek();
        return step == null ? null : step.change();
    }

}
