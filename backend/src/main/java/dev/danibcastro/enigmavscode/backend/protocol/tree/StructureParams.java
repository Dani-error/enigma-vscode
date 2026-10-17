package dev.danibcastro.enigmavscode.backend.protocol.tree;


import com.google.gson.annotations.SerializedName;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.analysis.tree.StructureTreeOptions;
import dev.danibcastro.enigmavscode.backend.protocol.wire.NonEmpty;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:55
 * Created by: Dani-error
 */
public record StructureParams(
        @NonEmpty @SerializedName("class") String className,
        StructureTreeOptions.@Nullable ObfuscationVisibility obfuscation,
        StructureTreeOptions.@Nullable DocumentationVisibility documentation,
        StructureTreeOptions.@Nullable SortingOrder sorting,
        @Nullable String search
) { }
