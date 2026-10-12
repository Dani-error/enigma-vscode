package dev.danibcastro.enigmavscode.backend.protocol.source;


import dev.danibcastro.enigmavscode.backend.protocol.wire.IntTuple;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:29
 * Created by: Dani-error
 */

/**
 * One name in the text of a class, for the editor that lets names be typed over. Sent as
 * {@code [line, character, length, group, flags, category]}.
 *
 * @param range
 * @param group the names that are renamed together have the same; an index into the groups of the text
 * @param declaration whether this is where the entry is declared
 * @param renamable whether the name may be typed over
 * @param category how it is marked, if it is
 */
public record NameRef(
        Range range,
        int group,
        boolean declaration,
        boolean renamable,
        @Nullable TokenCategory category
) implements IntTuple {

    private static final int DECLARATION = 1;
    private static final int RENAMABLE = 2;

    @Override
    public int[] toInts() {
        int flags = (this.declaration ? DECLARATION : 0) | (this.renamable ? RENAMABLE : 0);

        return new int[]{this.range.line(), this.range.character(), this.range.length(), this.group, flags, this.category == null ? 0 : this.category.number()};
    }

}
