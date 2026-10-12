package dev.danibcastro.enigmavscode.backend.protocol.entry;


import dev.danibcastro.enigmavscode.backend.protocol.wire.OmitIfNull;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:04
 * Created by: Dani-error
 */
public record EntryRef(
        EntryKind kind,
        @OmitIfNull @Nullable String owner,
        @OmitIfNull @Nullable String method,
        String name,
        @OmitIfNull @Nullable String desc,
        @OmitIfNull @Nullable Integer index,
        @OmitIfNull @Nullable Boolean parameter
) { }
