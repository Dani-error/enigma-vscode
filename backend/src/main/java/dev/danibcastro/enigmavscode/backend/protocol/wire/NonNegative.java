package dev.danibcastro.enigmavscode.backend.protocol.wire;


import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a number that cannot be below zero, like how many results to give. Checked when a request is read.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.RECORD_COMPONENT)
public @interface NonNegative {
}
