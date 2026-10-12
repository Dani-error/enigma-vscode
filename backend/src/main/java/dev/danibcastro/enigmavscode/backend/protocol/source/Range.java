package dev.danibcastro.enigmavscode.backend.protocol.source;


import dev.danibcastro.enigmavscode.backend.protocol.wire.IntTuple;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:16
 * Created by: Dani-error
 */
/**
 * Where a name stands in a text. Sent as {@code [line, character, length]}.
 *
 * @param line counted from 0, like {@code character}, the place in the line
 */
public record Range(
        int line,
        int character,
        int length
) implements IntTuple {

    @Override
    public int[] toInts() {
        return new int[] {this.line, this.character, this.length};
    }

}
