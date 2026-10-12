package dev.danibcastro.enigmavscode.backend.protocol.project;


import com.google.gson.annotations.SerializedName;
import org.quiltmc.enigma.api.source.Decompiler;
import org.quiltmc.enigma.impl.source.vineflower.VineflowerPreferences;

import java.util.Collection;
import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:05
 * Created by: Dani-error
 */
/** What the engine is and what it offers: the answer to {@code initialize}. */
public record Environment(
        String enigmaVersion,
        String vineflowerVersion,
        String cfrVersion,
        String procyonVersion,
        String javaVersion,
        List<Decompiler> decompilers,
        List<Format> formats,
        List<Preference> vineflowerPreferences,
        Collection<String> languages,
        State state
) {

    public record Decompiler(
            String id,
            String name
    ) { }

    /** A format mappings can be read from or written in. */
    public record Format(
            String id,
            String name,
            List<String> extensions,
            boolean directory,
            boolean read,
            boolean write
    ) { }

    /** An option of the Vineflower decompiler. */
    public record Preference(
            String key,
            VineflowerPreferences.Type type,
            String name,
            String description,
            @SerializedName("default") String defaultValue
    ) { }

}
