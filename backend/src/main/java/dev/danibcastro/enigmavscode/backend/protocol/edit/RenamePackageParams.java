package dev.danibcastro.enigmavscode.backend.protocol.edit;


import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:25
 * Created by: Dani-error
 */
/**
 * @param mode {@code refactor}, which is meant if nothing is said, or {@code move}
 * @param apply whether to do it, rather than say what it would do
 */
public record RenamePackageParams(
        String from,
        String to,
        @Nullable PackageMode mode,
        @Nullable Boolean apply
) { }
