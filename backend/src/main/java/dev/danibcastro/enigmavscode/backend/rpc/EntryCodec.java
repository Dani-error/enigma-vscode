package dev.danibcastro.enigmavscode.backend.rpc;


import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryKind;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.entry.SymbolKind;
import lombok.experimental.UtilityClass;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.translation.representation.MethodDescriptor;
import org.quiltmc.enigma.api.translation.representation.TypeDescriptor;
import org.quiltmc.enigma.api.translation.representation.entry.*;

import java.util.Objects;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 14:21
 * Created by: Dani-error
 *
 * Enigma's Entry (de)serialization
 */
@UtilityClass
public class EntryCodec {

    public EntryRef toRef(Entry<?> entry) {
        if (entry instanceof ClassEntry classEntry) {
            return new EntryRef(EntryKind.CLASS, null, null, classEntry.getFullName(), null, null, null);
        } else if (entry instanceof FieldEntry field) {
            return new EntryRef(EntryKind.FIELD, field.getParent().getFullName(), null, field.getName(), field.getDesc().toString(), null, null);
        } else if (entry instanceof MethodEntry method) {
            return new EntryRef(EntryKind.METHOD, method.getParent().getFullName(), null, method.getName(), method.getDesc().toString(), null, null);
        } else if (entry instanceof LocalVariableEntry local) {
            MethodEntry method = local.getParent();
            return new EntryRef(EntryKind.LOCAL, method.getParent().getFullName(), method.getName(), local.getName(), method.getDesc().toString(), local.getIndex(), local.isArgument());
        }

        throw new IllegalArgumentException("Cannot serialize entry of type " + entry.getClass().getName());
    }

    /**
     * The entry the client names.
     * @throws RpcException if what it sent names nothing
     */
    public Entry<?> fromRef(@Nullable EntryRef ref) {
        if (ref == null) {
            throw RpcException.invalidParams("Expected an entry");
        }

        if (ref.kind() == null) {
            throw RpcException.invalidParams("Entry is missing \"kind\"");
        }

        try {
            return switch (ref.kind()) {
                case CLASS -> new ClassEntry(part(ref.name(), "name"));
                case FIELD -> new FieldEntry(ownerOf(ref), part(ref.name(), "name"), new TypeDescriptor(part(ref.desc(), "desc")));
                case METHOD -> new MethodEntry(ownerOf(ref), part(ref.name(), "name"), new MethodDescriptor(part(ref.desc(), "desc")));
                case LOCAL -> {
                    MethodEntry method = new MethodEntry(ownerOf(ref), part(ref.method(), "method"), new MethodDescriptor(part(ref.desc(), "desc")));
                    // a variable is a parameter unless it says otherwise, and may have no name in the jar
                    boolean parameter = ref.parameter() == null || ref.parameter();
                    yield new LocalVariableEntry(method, part(ref.index(), "index"), Objects.requireNonNullElse(ref.name(), ""), parameter, null);
                }
            };
        } catch (RpcException e) {
            throw e;
        } catch (RuntimeException e) {
            // a descriptor that is none, for example
            throw RpcException.invalidParams("Malformed entry: " + e.getMessage());
        }
    }

    private ClassEntry ownerOf(EntryRef ref) {
        return new ClassEntry(part(ref.owner(), "owner"));
    }

    private <T> T part(@Nullable T value, String name) {
        if (value == null) {
            throw RpcException.invalidParams("Entry is missing \"" + name + "\"");
        }

        return value;
    }

    public SymbolKind kindOf(Entry<?> entry) {
        if (entry instanceof ClassEntry) {
            return SymbolKind.CLASS;
        } else if (entry instanceof FieldEntry) {
            return SymbolKind.FIELD;
        } else if (entry instanceof MethodEntry method) {
            return method.isConstructor() ? SymbolKind.CONSTRUCTOR : SymbolKind.METHOD;
        } else if (entry instanceof LocalVariableEntry local) {
            return local.isArgument() ? SymbolKind.PARAMETER : SymbolKind.LOCAL;
        }

        return SymbolKind.UNKNOWN;
    }

}
