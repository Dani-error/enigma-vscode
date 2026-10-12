package dev.danibcastro.enigmavscode.backend.protocol.project;


import org.jspecify.annotations.Nullable;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:03
 * Created by: Dani-error
 */
/** What is sent with a request. */
public record OpenJarParams(
        String jar,
        @Nullable List<String> libraries
) { }