package dev.danibcastro.enigmavscode.backend.protocol.entry;


import com.google.gson.annotations.SerializedName;
import org.quiltmc.enigma.api.source.TokenType;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:46
 * Created by: Dani-error
 */

/**
 * A top-level class as the class trees list it.
 *
 * @param obf its name in the jar
 * @param deobf its current name
 * @param obfuscated whether it still counts as unnamed
 * @param tokenType how it got its name: {@code obfuscated}, {@code deobfuscated}, {@code jar_proposed}, ...
 * @param kind class, interface, enum, record or annotation
 * @param isAbstract declared abstract, and not an interface
 * @param throwable descends from Throwable, as far as the jar tells
 */
public record ClassItem(
        String obf,
        String deobf,
        boolean obfuscated,
        TokenType tokenType,
        SymbolKind kind,
        @SerializedName("abstract") boolean isAbstract,
        boolean throwable
) { }
