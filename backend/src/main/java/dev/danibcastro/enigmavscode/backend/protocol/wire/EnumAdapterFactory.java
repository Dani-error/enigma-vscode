package dev.danibcastro.enigmavscode.backend.protocol.wire;


import com.google.gson.Gson;
import com.google.gson.JsonParseException;
import com.google.gson.TypeAdapter;
import com.google.gson.TypeAdapterFactory;
import com.google.gson.reflect.TypeToken;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import com.google.gson.stream.JsonWriter;

import java.io.IOException;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:16
 * Created by: Dani-error
 */
public final class EnumAdapterFactory implements TypeAdapterFactory {

    /** How a constant is spelled when it is sent. */
    public static String wireName(Enum<?> constant) {
        return constant instanceof WireName named ? named.wireName() : constant.name().toLowerCase(Locale.ROOT);
    }

    @Override
    @SuppressWarnings({"unchecked", "rawtypes"})
    public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> type) {
        Class<? super T> raw = type.getRawType();
        // a constant with a body is a class of its own, whose enum is its superclass
        Class<?> declaring = raw.isEnum() ? raw : raw.getSuperclass() != null && raw.getSuperclass().isEnum() ? raw.getSuperclass() : null;
        if (declaring == null) {
            return null;
        }

        return (TypeAdapter<T>) new EnumAdapter((Class<? extends Enum>) declaring);
    }

    private static final class EnumAdapter<E extends Enum<E>> extends TypeAdapter<E> {

        private final Class<E> type;
        private final Map<String, E> byName = new HashMap<>();

        EnumAdapter(Class<E> type) {
            this.type = type;
            for (E constant : type.getEnumConstants()) {
                this.byName.put(wireName(constant).toLowerCase(Locale.ROOT), constant);
            }
        }

        @Override
        public void write(JsonWriter out, E value) throws IOException {
            if (value == null) {
                out.nullValue();
            } else {
                out.value(wireName(value));
            }
        }

        @Override
        public E read(JsonReader in) throws IOException {
            if (in.peek() == JsonToken.NULL) {
                in.nextNull();
                return null;
            }

            String sent = in.nextString();
            E constant = this.byName.get(sent.toLowerCase(Locale.ROOT));
            if (constant == null) {
                throw new JsonParseException("\"" + sent + "\" is not one of " + this.byName.keySet() + " (" + this.type.getSimpleName() + ")");
            }

            return constant;
        }

    }
}
