package dev.danibcastro.enigmavscode.backend.protocol.collab;


/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:49
 * Created by: Dani-error
 */
/** What is sent with a request. */
public record SendMessageParams(
        String text
) { }
