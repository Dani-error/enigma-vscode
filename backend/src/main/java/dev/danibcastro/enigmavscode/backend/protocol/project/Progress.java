package dev.danibcastro.enigmavscode.backend.protocol.project;


import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:09
 * Created by: Dani-error
 */
public record Progress(
        long id,
        Phase phase,
        Task task,
        String[] taskArgs,
        @Nullable String title,
        @Nullable String message,
        int done,
        int total
) { }
