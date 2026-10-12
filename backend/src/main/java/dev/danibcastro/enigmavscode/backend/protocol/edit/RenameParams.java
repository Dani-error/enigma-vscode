package dev.danibcastro.enigmavscode.backend.protocol.edit;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:24
 * Created by: Dani-error
 */
/**
 * @param confirmWarnings whether the user was shown the warnings and wants it done anyway
 * @param validateOnly whether only to say what would come of it
 */
public record RenameParams(
        EntryRef entry,
        String newName,
        @Nullable Boolean confirmWarnings,
        @Nullable Boolean validateOnly
) { }
