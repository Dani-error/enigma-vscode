package dev.danibcastro.enigmavscode.backend.protocol.source;


import com.google.gson.annotations.SerializedName;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:04
 * Created by: Dani-error
 */
/**
 * {@code nav/references}: every use of an entry, or of what is at a position of a text.
 *
 * @param limit how many classes to look into at most
 */
public record ReferencesParams(
        @Nullable EntryRef entry,
        @SerializedName("class") @Nullable String className,
        @Nullable View view,
        @Nullable Long serial,
        @Nullable Integer line,
        @Nullable Integer character,
        @Nullable Boolean includeDeclaration,
        @Nullable Integer limit
) { }
