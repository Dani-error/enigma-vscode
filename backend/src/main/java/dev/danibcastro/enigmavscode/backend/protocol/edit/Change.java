package dev.danibcastro.enigmavscode.backend.protocol.edit;


import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 16/10/2026 21:40
 * Created by: Dani-error
 */
/**
 * One thing the user did to the mappings, as it is offered for undo and redo.
 *
 * @param kind what was done
 * @param args what it was done to, in the order the client expects them (see {@link ChangeKind})
 */
public record Change(ChangeKind kind, List<String> args) {
    public static Change of(ChangeKind kind, String... args) {
        return new Change(kind, List.of(args));
    }
}
