package dev.danibcastro.enigmavscode.backend.rpc;


import com.google.gson.*;
import lombok.experimental.UtilityClass;
import org.jspecify.annotations.Nullable;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 14:20
 * Created by: Dani-error
 *
 * Helpers for reading request parameters.
 */
@UtilityClass
public class Params {

    public boolean has(JsonObject params, String key) {
        return params.has(key) && !params.get(key).isJsonNull();
    }

    public String string(JsonObject params, String key) {
        if (!has(params, key)) {
            throw RpcException.invalidParams("Missing parameter: " + key);
        }

        return params.get(key).getAsString();
    }

    @Nullable
    public String optString(JsonObject params, String key) {
        return has(params, key) ? params.get(key).getAsString() : null;
    }

    public String string(JsonObject params, String key, String fallback) {
        return has(params, key) ? params.get(key).getAsString() : fallback;
    }

    public int integer(JsonObject params, String key) {
        if (!has(params, key)) {
            throw RpcException.invalidParams("Missing parameter: " + key);
        }

        return params.get(key).getAsInt();
    }

    public int integer(JsonObject params, String key, int fallback) {
        return has(params, key) ? params.get(key).getAsInt() : fallback;
    }

    public boolean bool(JsonObject params, String key, boolean fallback) {
        return has(params, key) ? params.get(key).getAsBoolean() : fallback;
    }

    public Path path(JsonObject params, String key) {
        return Path.of(string(params, key));
    }

    @Nullable
    public Path optPath(JsonObject params, String key) {
        String value = optString(params, key);
        return value == null || value.isEmpty() ? null : Path.of(value);
    }

    public List<String> strings(JsonObject params, String key) {
        List<String> values = new ArrayList<>();
        if (has(params, key) && params.get(key).isJsonArray()) {
            for (JsonElement element : params.getAsJsonArray(key)) {
                values.add(element.getAsString());
            }
        }

        return values;
    }

}
