package dev.danibcastro.enigmavscode.backend.protocol.source;


import com.google.gson.annotations.SerializedName;
import org.jspecify.annotations.Nullable;
import dev.danibcastro.enigmavscode.backend.protocol.wire.NonEmpty;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:20
 * Created by: Dani-error
 */
/**
 * A class as it is shown.
 *
 * @param className the class, by its name in the jar
 * @param view {@code source}, which is meant if nothing is said, or {@code bytecode}
 */
public record ClassParams(
        @NonEmpty @SerializedName("class") String className,
        @Nullable View view
) { }
