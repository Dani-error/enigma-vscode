package dev.danibcastro.enigmavscode.backend.util;


import lombok.experimental.UtilityClass;
import org.quiltmc.enigma.api.analysis.index.jar.EntryIndex;
import org.quiltmc.enigma.api.translation.representation.entry.ClassDefEntry;
import org.quiltmc.enigma.api.translation.representation.entry.ClassEntry;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:33
 * Created by: Dani-error
 */
@UtilityClass
public class ThrowableTypes {

    private final Map<String, Boolean> OUTSIDE = new ConcurrentHashMap<>();

    /**
     * Whether a class descends from {@link Throwable}. Its superclasses are followed for as long as they are part of
     * what was indexed; the first one that is not decides.
     */
    public boolean isThrowable(ClassEntry entry, EntryIndex index) {
        Set<String> seen = new HashSet<>();
        ClassDefEntry definition = index.getDefinition(entry);
        while (definition != null && seen.add(definition.getFullName())) {
            ClassEntry parent = definition.getSuperClass();
            if (parent == null) {
                return false;
            }

            ClassDefEntry parentDefinition = index.getDefinition(parent);
            if (parentDefinition == null) {
                return isThrowableOutside(parent.getFullName());
            }

            definition = parentDefinition;
        }

        return false;
    }

    /**
     * Whether a class that is not in the jar can be thrown. A class of the Java runtime is asked itself. Any other
     * belongs to a library that was not given: all there is to go by is its name, and the convention that exceptions
     * and errors are called that.
     *
     * @param name the internal name of the class, such as {@code java/lang/RuntimeException}
     */
    public boolean isThrowableOutside(String name) {
        return OUTSIDE.computeIfAbsent(name, key -> {
            try {
                return Throwable.class.isAssignableFrom(Class.forName(key.replace('/', '.'), false, ClassLoader.getPlatformClassLoader()));
            } catch (ClassNotFoundException | LinkageError e) {
                return key.endsWith("Exception") || key.endsWith("Error");
            }
        });
    }

}
