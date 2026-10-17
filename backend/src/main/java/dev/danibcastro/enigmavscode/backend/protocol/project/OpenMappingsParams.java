package dev.danibcastro.enigmavscode.backend.protocol.project;


import org.jspecify.annotations.Nullable;
import dev.danibcastro.enigmavscode.backend.protocol.wire.FilePath;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:49
 * Created by: Dani-error
 */
/**
 * @param format the format, where the name of the file does not say it
 */
public record OpenMappingsParams(
        @FilePath String path,
        @Nullable String format
) { }
