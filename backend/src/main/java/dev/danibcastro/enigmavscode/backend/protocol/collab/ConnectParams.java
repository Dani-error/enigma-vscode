package dev.danibcastro.enigmavscode.backend.protocol.collab;


import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:47
 * Created by: Dani-error
 */
/** What is sent with a request. */
public record ConnectParams(
        String username,
        String address,
        @Nullable String password
) { }
