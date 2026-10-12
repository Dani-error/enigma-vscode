package dev.danibcastro.enigmavscode.backend.protocol.wire;


import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:04
 * Created by: Dani-error
 */

/**
 * Marks a part of an answer that is left out when it has no value, rather than sent as {@code null}: something that
 * only some answers of that kind have, which the client declares as optional.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.RECORD_COMPONENT)
public @interface OmitIfNull {
}
