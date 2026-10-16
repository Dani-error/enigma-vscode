package dev.danibcastro.enigmavscode.backend.protocol.project;

import dev.danibcastro.enigmavscode.backend.protocol.edit.Change;


import dev.danibcastro.enigmavscode.backend.protocol.collab.ConnectionState;
import org.jspecify.annotations.Nullable;

import java.util.Collection;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:36
 * Created by: Dani-error
 */
public record State(
        @Nullable String jarPath,
        @Nullable String jarChecksum,
        @Nullable String mappingsPath,
        @Nullable String mappingsFormat,
        boolean dirty,
        String decompiler,
        long revision,
        boolean canUndo,
        boolean canRedo,
        @Nullable Change undoLabel,
        @Nullable Change redoLabel,
        ConnectionState connection,
        Collection<Editable> editable
) { }