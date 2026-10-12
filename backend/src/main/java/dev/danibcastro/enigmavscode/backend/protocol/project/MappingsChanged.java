package dev.danibcastro.enigmavscode.backend.protocol.project;


import dev.danibcastro.enigmavscode.backend.protocol.entry.ClassItem;

import java.util.Collection;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:48
 * Created by: Dani-error
 */
/**
 * Announces that the mappings changed.
 *
 * @param full everything has to be read again
 * @param classes otherwise, the top-level classes whose names changed
 */
public record MappingsChanged(
        long revision,
        boolean full,
        Collection<ClassItem> classes
) { }
