package dev.danibcastro.enigmavscode.backend.protocol.project;


import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.wire.OmitIfNull;
import org.jspecify.annotations.Nullable;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:44
 * Created by: Dani-error
 */
/**
 * Something to tell the user.
 */
public record Notification(
        Severity type,
        String text,
        @OmitIfNull @Nullable Problem key,
        @OmitIfNull @Nullable List<String> args,
        @Nullable String details
) { }
