package dev.danibcastro.enigmavscode.backend.protocol.entry;


import dev.danibcastro.enigmavscode.backend.protocol.wire.WireName;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.experimental.Accessors;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:06
 * Created by: Dani-error
 */
@AllArgsConstructor
@Getter @Accessors(fluent = true)
public enum SymbolKind implements WireName {
    CLASS("class"),
    INTERFACE("interface"),
    ANNOTATION("annotation"),
    ENUM("enum"),
    RECORD("record"),
    ENUM_CONSTANT("enumConstant"),
    FIELD("field"),
    METHOD("method"),
    CONSTRUCTOR("constructor"),
    PARAMETER("parameter"),
    LOCAL("local"),
    UNKNOWN("unknown");

    private final String wireName;

}
