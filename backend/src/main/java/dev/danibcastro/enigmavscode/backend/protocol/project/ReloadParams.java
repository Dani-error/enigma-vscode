package dev.danibcastro.enigmavscode.backend.protocol.project;

import org.jspecify.annotations.Nullable;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:04
 * Created by: Dani-error
 */
/** What is sent with a request. */
public record ReloadParams(
        @Nullable List<String> libraries
) { }
