package dev.danibcastro.enigmavscode.backend.protocol.tree;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryInfo;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.wire.Flatten;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:00
 * Created by: Dani-error
 */
/**
 * A method that calls another or is called by it, for the call hierarchy of the editor.
 *
 * @param sites where the calls are
 */
public record CallItem(@Flatten EntryInfo info, List<Site> sites) {

    /** One call: what is called, and the method it is called in. */
    public record Site(EntryRef entry, EntryRef context) { }

}
