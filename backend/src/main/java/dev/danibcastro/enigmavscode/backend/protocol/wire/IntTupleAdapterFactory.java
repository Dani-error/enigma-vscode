package dev.danibcastro.enigmavscode.backend.protocol.wire;


import com.google.gson.Gson;
import com.google.gson.TypeAdapter;
import com.google.gson.TypeAdapterFactory;
import com.google.gson.reflect.TypeToken;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonWriter;

import java.io.IOException;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:18
 * Created by: Dani-error
 */
public final class IntTupleAdapterFactory implements TypeAdapterFactory {

    @Override
    public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> type) {
        if (!IntTuple.class.isAssignableFrom(type.getRawType())) {
            return null;
        }

        return new TypeAdapter<>() {
            @Override
            public void write(JsonWriter out, T value) throws IOException {
                if (value == null) {
                    out.nullValue();
                    return;
                }

                out.beginArray();
                for (int number : ((IntTuple) value).toInts()) {
                    out.value(number);
                }

                out.endArray();
            }

            @Override
            public T read(JsonReader in) {
                throw new UnsupportedOperationException(type.getRawType().getSimpleName() + " is only sent");
            }
        };
    }

}
