package dev.danibcastro.enigmavscode.backend.protocol.collab;


import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:48
 * Created by: Dani-error
 */
/** What is sent with a request. */
public record HostParams(
        String username,
        @Nullable Integer port,
        @Nullable String password
) { }
