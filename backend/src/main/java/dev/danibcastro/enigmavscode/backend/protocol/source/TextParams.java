package dev.danibcastro.enigmavscode.backend.protocol.source;


import com.google.gson.annotations.SerializedName;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:21
 * Created by: Dani-error
 */
/**
 * A text of a class.
 *
 * @param serial the text this is about, as given with it; another one may have been given out since
 */
public record TextParams(
        @SerializedName("class") String className,
        @Nullable View view,
        @Nullable Long serial
) { }
