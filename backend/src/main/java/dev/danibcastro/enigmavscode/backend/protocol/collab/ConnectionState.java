package dev.danibcastro.enigmavscode.backend.protocol.collab;


/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:37
 * Created by: Dani-error
 */
public enum ConnectionState {
    NOT_CONNECTED,
    /** Joined the server of someone else. */
    CONNECTED,
    /** Running the server others join. */
    HOSTING
}
