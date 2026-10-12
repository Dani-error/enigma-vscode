package dev.danibcastro.enigmavscode.backend.protocol.source;


/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:28
 * Created by: Dani-error
 */
/**
 * How a name in a text is marked: by how it got its name, like the highlighting of Enigma's editor.
 */
public enum TokenCategory {
    OBFUSCATED,
    DEOBFUSCATED,
    PROPOSED,
    FALLBACK,
    DEBUG;

    /** Its number in the list of the names of a text, where 0 stands for none. */
    public int number() {
        return this.ordinal() + 1;
    }

}
