package dev.danibcastro.enigmavscode.backend.util;


import dev.danibcastro.enigmavscode.backend.protocol.source.Range;
import org.quiltmc.enigma.api.source.Token;

import java.util.Arrays;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:15
 * Created by: Dani-error
 */

/**
 * Converts between offsets into a source string and zero-based line/character positions.
 *
 * <p>Positions rather than offsets are exchanged with the client so that they stay valid
 * even if the editor normalises line endings.
 */
public final class LineIndex {

    private final int[] lineStarts;
    private final int length;

    public LineIndex(String text) {
        int[] starts = new int[Math.max(16, text.length() / 24)];
        int count = 1;
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                if (count == starts.length) {
                    starts = Arrays.copyOf(starts, starts.length * 2);
                }

                starts[count++] = i + 1;
            }
        }

        this.lineStarts = Arrays.copyOf(starts, count);
        this.length = text.length();
    }

    public int lineOf(int offset) {
        int index = Arrays.binarySearch(this.lineStarts, offset);
        return index >= 0 ? index : -index - 2;
    }

    public int columnOf(int offset) {
        return offset - this.lineStarts[this.lineOf(offset)];
    }

    public int offsetOf(int line, int character) {
        if (line < 0) {
            return 0;
        }

        if (line >= this.lineStarts.length) {
            return this.length;
        }

        return Math.min(this.lineStarts[line] + Math.max(character, 0), this.length);
    }

    /**
     * Encodes a token as {@code [line, character, length]}.
     */
    public Range range(Token token) {
        int line = this.lineOf(token.start);
        return new Range(line, token.start - this.lineStarts[line], token.end - token.start);
    }

}
