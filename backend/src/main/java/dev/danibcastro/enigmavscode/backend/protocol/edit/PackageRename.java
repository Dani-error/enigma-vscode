package dev.danibcastro.enigmavscode.backend.protocol.edit;


import com.google.gson.annotations.SerializedName;
import dev.danibcastro.enigmavscode.backend.protocol.wire.OmitIfNull;
import org.jspecify.annotations.Nullable;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:31
 * Created by: Dani-error
 */
/**
 * What renaming or moving a package does, and what became of it if it was to be done: the answer to
 * {@code package/rename}.
 *
 * @param renames every class that gets another name
 */
public record PackageRename(
        List<Planned> renames,
        boolean applied,
        @OmitIfNull @Nullable Boolean needsConfirmation,
        List<ValidationMessage> messages,
        @OmitIfNull @Nullable Integer appliedCount
) {

    /**
     * @param className the class, by its name in the jar
     * @param from its current name
     */
    public record Planned(
            @SerializedName("class") String className,
            String from,
            String to
    ) { }

}
