package dev.danibcastro.enigmavscode.backend.protocol.tree;


import com.google.gson.annotations.SerializedName;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:55
 * Created by: Dani-error
 */
/** A class, whatever is shown of it. */
public record ClassNameParams(
        @SerializedName("class") String className
) { }
