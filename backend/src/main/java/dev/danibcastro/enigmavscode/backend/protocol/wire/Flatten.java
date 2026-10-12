package dev.danibcastro.enigmavscode.backend.protocol.wire;


import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:20
 * Created by: Dani-error
 */

/**
 * Marks an answer part with explicit components.
 * A token is a positioned entry.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.RECORD_COMPONENT)
public @interface Flatten { }
