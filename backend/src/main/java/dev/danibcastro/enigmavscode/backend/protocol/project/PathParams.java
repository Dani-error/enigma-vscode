package dev.danibcastro.enigmavscode.backend.protocol.project;

import dev.danibcastro.enigmavscode.backend.protocol.wire.FilePath;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:52
 * Created by: Dani-error
 */

/** A file or folder to read from or write to. */
public record PathParams(
        @FilePath String path
) { }
