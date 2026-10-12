package dev.danibcastro.enigmavscode.backend.protocol.edit;


import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.util.validation.Message;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:23
 * Created by: Dani-error
 */
/**
 * Something Enigma has to say about a change: why it cannot be made, or what to be aware of.
 *
 * @param text in the language of the user
 */
public record ValidationMessage(
        Message.Type type,
        String text,
        @Nullable String details
) { }
