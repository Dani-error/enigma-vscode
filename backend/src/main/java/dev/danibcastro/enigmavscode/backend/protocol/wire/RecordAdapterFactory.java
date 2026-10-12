package dev.danibcastro.enigmavscode.backend.protocol.wire;


import com.google.gson.*;
import com.google.gson.annotations.SerializedName;
import com.google.gson.reflect.TypeToken;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonWriter;

import java.io.IOException;
import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:19
 * Created by: Dani-error
 */
public final class RecordAdapterFactory implements TypeAdapterFactory {

    /** The name a component is written under: its own, unless it was given another. */
    private static String nameOf(Class<?> record, RecordComponent component) {
        try {
            SerializedName name = record.getDeclaredField(component.getName()).getAnnotation(SerializedName.class);
            return name == null ? component.getName() : name.value();
        } catch (NoSuchFieldException e) {
            return component.getName();
        }
    }

    @Override
    public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> type) {
        Class<? super T> raw = type.getRawType();
        if (!raw.isRecord()) {
            return null;
        }

        List<String> optional = new ArrayList<>();
        List<String> flattened = new ArrayList<>();
        for (RecordComponent component : raw.getRecordComponents()) {
            if (component.isAnnotationPresent(OmitIfNull.class)) {
                optional.add(nameOf(raw, component));
            }

            if (component.isAnnotationPresent(Flatten.class)) {
                flattened.add(nameOf(raw, component));
            }
        }

        if (optional.isEmpty() && flattened.isEmpty()) {
            return null;
        }

        TypeAdapter<T> delegate = gson.getDelegateAdapter(this, type);
        TypeAdapter<JsonElement> elements = gson.getAdapter(JsonElement.class);
        return new TypeAdapter<>() {
            @Override
            public void write(JsonWriter out, T value) throws IOException {
                JsonElement tree = delegate.toJsonTree(value);
                if (tree.isJsonObject()) {
                    JsonObject object = tree.getAsJsonObject();
                    for (String name : optional) {
                        if (object.has(name) && object.get(name).isJsonNull()) {
                            object.remove(name);
                        }
                    }

                    for (String name : flattened) {
                        JsonElement part = object.remove(name);
                        if (part != null && part.isJsonObject()) {
                            // what the answer says itself wins over what it is made of
                            JsonObject merged = new JsonObject();
                            part.getAsJsonObject().entrySet().forEach(entry -> merged.add(entry.getKey(), entry.getValue()));
                            object.entrySet().forEach(entry -> merged.add(entry.getKey(), entry.getValue()));
                            tree = merged;
                            object = merged;
                        }
                    }
                }

                elements.write(out, tree);
            }

            @Override
            public T read(JsonReader in) throws IOException {
                return delegate.read(in);
            }
        };
    }
}
