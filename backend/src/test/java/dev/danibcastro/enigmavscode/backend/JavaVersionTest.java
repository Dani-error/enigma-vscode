package dev.danibcastro.enigmavscode.backend;


import org.junit.jupiter.api.Test;
import org.objectweb.asm.ClassReader;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/*
 * The newest Java the extension runs the engine on (MAXIMUM_JAVA in src/engine/java.ts) is the newest whose classes
 * the ASM of the engine reads: Enigma reads those of the runtime it runs on. When ASM is upgraded, this fails until
 * the extension is told.
 */
class JavaVersionTest {

    private static final Path EXTENSION_JAVA = Path.of("../src/engine/java.ts");
    /** The class file version of Java 1.0 is 45; that of Java n is 44 + n. */
    private static final int VERSION_OFFSET = 44;

    @Test
    void theNewestJavaOfTheExtensionIsTheNewestTheEngineReads() throws IOException {
        Matcher declared = Pattern.compile("export const MAXIMUM_JAVA = (\\d+);").matcher(Files.readString(EXTENSION_JAVA));
        assertTrue(declared.find(), "MAXIMUM_JAVA is declared in " + EXTENSION_JAVA);
        int maximum = Integer.parseInt(declared.group(1));

        assertDoesNotThrow(() -> new ClassReader(classOfJava(maximum)), "Java " + maximum + " is read");
        assertThrows(IllegalArgumentException.class, () -> new ClassReader(classOfJava(maximum + 1)),
                "Java " + (maximum + 1) + " is read too: raise MAXIMUM_JAVA in " + EXTENSION_JAVA);
    }

    /** A class of these tests, as if it had been compiled for another Java. */
    private static byte[] classOfJava(int version) throws IOException {
        byte[] bytes;
        try (InputStream in = JavaVersionTest.class.getResourceAsStream("JavaVersionTest.class")) {
            bytes = in.readAllBytes();
        }

        int major = VERSION_OFFSET + version;
        bytes[6] = (byte) (major >> 8);
        bytes[7] = (byte) major;
        return bytes;
    }
}
