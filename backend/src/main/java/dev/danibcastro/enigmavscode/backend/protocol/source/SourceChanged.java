package dev.danibcastro.enigmavscode.backend.protocol.source;


import com.google.gson.annotations.SerializedName;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:19
 * Created by: Dani-error
 */
/**
 * Announces that the text of a class the client has open is another now.
 *
 * @param className the class, by its name in the jar
 * @param view {@code source} or {@code bytecode}
 */
public record SourceChanged(
        @SerializedName("class") String className,
        View view
) { }
