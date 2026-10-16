package dev.danibcastro.enigmavscode.backend.protocol.edit;


import dev.danibcastro.enigmavscode.backend.protocol.wire.OmitIfNull;
import org.jspecify.annotations.Nullable;

import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:28
 * Created by: Dani-error
 */
/**
 * What became of a change to the mappings.
 *
 * @param applied whether the mappings changed
 * @param needsConfirmation whether it was held back for warnings the user has to confirm first
 * @param messages what Enigma has to say about it: the errors that prevented it, the warnings
 * @param appliedCount how many of the changes asked for were made, where there can be several
 * @param label what was undone or redone
 */
public record EditResult(
        boolean applied,
        boolean needsConfirmation,
        List<ValidationMessage> messages,
        @OmitIfNull @Nullable Integer appliedCount,
        @OmitIfNull @Nullable Change label
) { }
