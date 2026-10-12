package dev.danibcastro.enigmavscode.backend.protocol.edit;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:24
 * Created by: Dani-error
 */
/**
 * @param javadoc the text; none or an empty one removes it
 */
public record SetJavadocParams(
        EntryRef entry,
        @Nullable String javadoc,
        @Nullable Boolean confirmWarnings
) { }
