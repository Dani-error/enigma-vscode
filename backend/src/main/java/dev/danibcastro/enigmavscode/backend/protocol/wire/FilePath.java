package dev.danibcastro.enigmavscode.backend.protocol.wire;


import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a path of a file that is sent: it has to be absolute. The backend does not guess what a relative one is relative
 * to, and its working directory is nowhere the user chose. Checked when a request is read.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.RECORD_COMPONENT)
public @interface FilePath {
}
