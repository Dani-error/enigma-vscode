package dev.danibcastro.enigmavscode.backend.protocol.entry;


import dev.danibcastro.enigmavscode.backend.protocol.wire.Flatten;
import dev.danibcastro.enigmavscode.backend.protocol.wire.OmitIfNull;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.source.TokenType;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:29
 * Created by: Dani-error
 */
/**
 * Everything the identifier panel and the entry tooltip of the Swing interface show about an entry. It is sent as
 * one object: the groups it is made of here only say what belongs together.
 *
 * @param inJar whether it is part of the jar rather than of a library
 * @param navigable whether its declaration can be gone to
 * @param renamableEntry whether Enigma could rename it, whatever the settings say
 * @param topLevelClass the class whose source shows it
 * @param type what only a class has, and {@code declaration} what only something declared in one has
 */
public record EntryInfo(
        EntryRef entry,
        SymbolKind kind,
        @Flatten Names names,
        @Flatten Mapping mapping,
        boolean inJar,
        boolean navigable,
        boolean renamableEntry,
        @Flatten Renaming renaming,
        String topLevelClass,
        List<String> modifiers,
        @Flatten @Nullable TypeDetails type,
        @Flatten @Nullable Declaration declaration
) {

    /**
     * @param obfName its name in the jar
     * @param name its current name
     * @param simpleName its current name without package; for a constructor, that of its class
     * @param fullName its current name with everything it is in
     */
    public record Names(
            String obfName,
            String name,
            String simpleName,
            String fullName
    ) { }

    /**
     * How it got the name it has.
     *
     * @param sourcePluginId the plugin that proposed its name
     * @param obfuscated whether it still has no name of its own
     */
    public record Mapping(
            TokenType tokenType,
            @Nullable String sourcePluginId,
            @Nullable String javadoc,
            boolean obfuscated
    ) { }

    /**
     * What renaming and documenting it means, and whether the user may.
     *
     * @param renameEntry what is renamed when this is: the class, for a constructor
     * @param renameName the name to edit: with the package, for a top-level class
     */
    public record Renaming(
            boolean renamable,
            boolean documentable,
            EntryRef renameEntry,
            String renameName
    ) { }

    /**
     * What a class has.
     *
     * @param outerClass the class it is in, if it is in one
     */
    public record TypeDetails(
            @OmitIfNull @Nullable String outerClass,
            @OmitIfNull @Nullable String superClass,
            @OmitIfNull @Nullable List<String> interfaces
    ) { }

    /**
     * Where a field, a method or a variable is declared, and as what.
     *
     * @param owner the current name of the class it is in, and {@code ownerEntry} that class
     * @param descriptor of a field or method, as in the jar
     * @param type the readable form: the type of a field or variable, the signature of a method
     * @param method the current name of the method of a variable, and {@code index} its index there
     */
    public record Declaration(
            String owner,
            @OmitIfNull @Nullable EntryRef ownerEntry,
            @OmitIfNull @Nullable String descriptor,
            @OmitIfNull @Nullable String type,
            @OmitIfNull @Nullable String method,
            @OmitIfNull @Nullable Integer index
    ) { }

    /** The same entry, seen where renaming it means something else: as a name in a text. */
    public EntryInfo withRenaming(Renaming renaming) {
        return new EntryInfo(this.entry, this.kind, this.names, this.mapping, this.inJar, this.navigable, this.renamableEntry, renaming,
                this.topLevelClass, this.modifiers, this.type, this.declaration);
    }

    /** The same entry, shown in the source of another class than its own top-level one. */
    public EntryInfo shownIn(String topLevelClass) {
        return new EntryInfo(this.entry, this.kind, this.names, this.mapping, this.inJar, this.navigable, this.renamableEntry, this.renaming,
                topLevelClass, this.modifiers, this.type, this.declaration);
    }

}
