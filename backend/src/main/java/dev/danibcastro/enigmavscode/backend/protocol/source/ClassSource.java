package dev.danibcastro.enigmavscode.backend.protocol.source;


import com.google.gson.annotations.SerializedName;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.entry.SymbolKind;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.class_handle.ClassHandleError;

import java.util.List;
import java.util.Map;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:26
 * Created by: Dani-error
 */
public record ClassSource(
        @SerializedName("class") String className,
        View view,
        String deobfName,
        long revision,
        long serial,
        String text,
        @Nullable Failure error,
        Map<TokenCategory, List<Range>> tokens,
        List<NameRef> refs,
        List<Group> groups
) {

    /**
     * @param type {@code decompile} or {@code remap}
     */
    public record Failure(
            ClassHandleError.Type type,
            @Nullable String message
    ) { }

    public record Group(
            EntryRef entry,
            SymbolKind kind,
            String name
    ) { }

}
