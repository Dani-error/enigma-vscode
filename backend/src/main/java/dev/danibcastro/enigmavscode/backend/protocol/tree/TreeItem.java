package dev.danibcastro.enigmavscode.backend.protocol.tree;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.entry.SymbolKind;
import dev.danibcastro.enigmavscode.backend.protocol.wire.OmitIfNull;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.source.TokenType;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:57
 * Created by: Dani-error
 */

/**
 * A node of one of the trees of Enigma: the structure of a class, an inheritance, the references to something.
 *
 * @param label what the Swing interface shows for it
 * @param modifiers of a member, in the structure
 * @param entry
 * @param kind
 * @param tokenType
 * @param selected whether it is what the tree was asked for, in a hierarchy
 * @param navigable
 * @param implemented whether a method is declared in that class of an inheritance, rather than inherited
 * @param context what refers to the entry, in a tree of references
 * @param children
 */
public record TreeItem(
        String label,
        @OmitIfNull @Nullable String modifiers,
        @OmitIfNull @Nullable EntryRef entry,
        @OmitIfNull @Nullable SymbolKind kind,
        @OmitIfNull @Nullable TokenType tokenType,
        @OmitIfNull @Nullable Boolean selected,
        @OmitIfNull @Nullable Boolean navigable,
        @OmitIfNull @Nullable Boolean implemented,
        @OmitIfNull @Nullable EntryRef context,
        List<TreeItem> children
) {

    public record Root(
            @Nullable TreeItem root
    ) { }

}
