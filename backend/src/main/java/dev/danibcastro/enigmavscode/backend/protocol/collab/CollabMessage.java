package dev.danibcastro.enigmavscode.backend.protocol.collab;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.network.ServerMessage;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:49
 * Created by: Dani-error
 */

/**
 * Something that happened in the session: someone joined, wrote, renamed.
 *
 * @param type the kind of event, as Enigma names it, in lower case
 * @param text what the Swing interface shows for it
 * @param entry what was changed
 */
public record CollabMessage(
        ServerMessage.Type type,
        @Nullable String user,
        String text,
        @Nullable EntryRef entry
) { }
