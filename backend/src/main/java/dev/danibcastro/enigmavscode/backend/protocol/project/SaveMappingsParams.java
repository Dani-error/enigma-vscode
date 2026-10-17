package dev.danibcastro.enigmavscode.backend.protocol.project;


import org.jspecify.annotations.Nullable;
import dev.danibcastro.enigmavscode.backend.protocol.wire.FilePath;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:49
 * Created by: Dani-error
 */
/**
 * @param path where to save, if not where the mappings were opened from or saved last
 */
public record SaveMappingsParams(
        @FilePath @Nullable String path,
        @Nullable String format
) { }
