package dev.danibcastro.enigmavscode.backend.protocol.source;


import com.google.gson.annotations.SerializedName;
import dev.danibcastro.enigmavscode.backend.protocol.wire.OmitIfNull;
import org.jspecify.annotations.Nullable;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:06
 * Created by: Dani-error
 */
/**
 * Where something is in the text of a class.
 *
 * @param className the class, by its name in the jar, and {@code deobfName} its current name
 * @param range the first of the places, where the answer is about one thing
 * @param ranges every place
 */
public record Location(
        @SerializedName("class") String className,
        View view,
        String deobfName,
        @OmitIfNull @Nullable Range range,
        List<Range> ranges
) {

    /**
     * Every use of something: the answer to {@code nav/references}.
     *
     * @param truncated whether there are more classes that use it than were looked at
     */
    public record Found(
            List<Location> locations,
            boolean truncated,
            int searchedClasses
    ) { }

}
