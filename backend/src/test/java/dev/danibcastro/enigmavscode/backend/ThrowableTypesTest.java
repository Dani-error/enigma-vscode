package dev.danibcastro.enigmavscode.backend;


import dev.danibcastro.enigmavscode.backend.util.ThrowableTypes;
import org.junit.jupiter.api.Test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:39
 * Created by: Dani-error
 */
class ThrowableTypesTest {

    @Test
    void asksTheClassesOfTheJavaRuntime() {
        assertThat(ThrowableTypes.isThrowableOutside("java/lang/Throwable"), is(true));
        assertThat(ThrowableTypes.isThrowableOutside("java/lang/RuntimeException"), is(true));
        assertThat(ThrowableTypes.isThrowableOutside("java/io/IOException"), is(true));
        assertThat(ThrowableTypes.isThrowableOutside("java/lang/ThreadDeath"), is(true));
        assertThat(ThrowableTypes.isThrowableOutside("java/lang/Object"), is(false));
        // called like one, but is none
        assertThat(ThrowableTypes.isThrowableOutside("java/lang/Thread$UncaughtExceptionHandler"), is(false));
    }

    @Test
    void goesByTheNameOfClassesItCannotSee() {
        assertThat(ThrowableTypes.isThrowableOutside("org/example/library/CommandException"), is(true));
        assertThat(ThrowableTypes.isThrowableOutside("org/example/library/LinkError"), is(true));
        assertThat(ThrowableTypes.isThrowableOutside("org/example/library/Command"), is(false));
    }

}
