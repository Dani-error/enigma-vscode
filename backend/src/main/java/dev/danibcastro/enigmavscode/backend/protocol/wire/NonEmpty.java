package dev.danibcastro.enigmavscode.backend.protocol.wire;


import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a text that has to have something in it, like the name of a class. Checked when a request is read.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.RECORD_COMPONENT)
public @interface NonEmpty {
}
