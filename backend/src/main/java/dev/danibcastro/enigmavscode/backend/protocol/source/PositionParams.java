package dev.danibcastro.enigmavscode.backend.protocol.source;


import com.google.gson.annotations.SerializedName;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:20
 * Created by: Dani-error
 */
/** A position in a text of a class. */
public record PositionParams(
        @SerializedName("class") String className,
        @Nullable View view,
        @Nullable Long serial,
        Integer line,
        Integer character
) { }
