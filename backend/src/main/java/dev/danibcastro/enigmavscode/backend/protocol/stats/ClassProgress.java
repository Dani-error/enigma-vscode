package dev.danibcastro.enigmavscode.backend.protocol.stats;


import dev.danibcastro.enigmavscode.backend.protocol.wire.IntTuple;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:00
 * Created by: Dani-error
 */

/**
 * How far one class is mapped. Sent as {@code [mapped, mappable]}.
 */
public record ClassProgress(
        int mapped,
        int mappable
) implements IntTuple {

    @Override
    public int[] toInts() {
        return new int[]{this.mapped, this.mappable};
    }

}
