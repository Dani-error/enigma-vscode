package dev.danibcastro.enigmavscode.backend.protocol.collab;


/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:48
 * Created by: Dani-error
 */

import java.util.List;

/**
 * Working on a jar with other people.
 *
 * @param state {@code not_connected}, {@code connected} or {@code hosting}
 * @param users who is there
 */
public record CollabState(
        ConnectionState state,
        List<String> users
) { }
