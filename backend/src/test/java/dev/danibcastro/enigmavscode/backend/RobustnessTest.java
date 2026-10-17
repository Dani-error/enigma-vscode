package dev.danibcastro.enigmavscode.backend;


import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.annotations.SerializedName;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.wire.EnumAdapterFactory;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.ParameterizedType;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.is;

/*
 * Every request the backend answers, sent what it should be and what it should not: nothing may make it fail inside.
 * What is wrong with a request is answered as such, as invalid parameters or as something the user did, and the
 * backend goes on answering.
 */
@Timeout(900)
class RobustnessTest {

    /** Ends the session; closing every client sends it. */
    private static final Set<String> NOT_SENT = Set.of("shutdown");

    @TempDir
    Path temp;

    /** What went wrong, by request and what it was sent. */
    private final List<String> failures = new ArrayList<>();

    @Test
    void everyRequestWithoutAJar() {
        this.sendEverything(false);
    }

    @Test
    void everyRequestWithAJarOpen() {
        this.sendEverything(true);
    }

    @Test
    void messagesThatCannotBeReadAreAnsweredAndTheNextOneIsRead() {
        try (TestClient client = new TestClient()) {
            client.sendBody("{ not json");
            assertThat(code(client.awaitUnmatched()), is(RpcException.PARSE_ERROR));
            client.sendBody("[1, 2]");
            assertThat(code(client.awaitUnmatched()), is(RpcException.INVALID_REQUEST));
            client.sendBody("42");
            assertThat(code(client.awaitUnmatched()), is(RpcException.INVALID_REQUEST));
            // a method that is not a string, for which there is an id to answer
            client.sendBody("{\"jsonrpc\": \"2.0\", \"id\": null, \"method\": 7}");
            assertThat(code(client.awaitUnmatched()), is(RpcException.INVALID_REQUEST));

            assertThat(client.callRaw("project/state").isJsonObject(), is(true));
        }
    }

    private void sendEverything(boolean withJar) {
        Map<String, Optional<Class<? extends Record>>> requests;
        try (TestClient client = new TestClient()) {
            requests = client.requests();
        }

        for (Map.Entry<String, Optional<Class<? extends Record>>> request : requests.entrySet()) {
            String method = request.getKey();
            if (NOT_SENT.contains(method)) {
                continue;
            }

            // a client of its own for each: requests change what the next one finds
            try (TestClient client = new TestClient()) {
                for (Map.Entry<String, JsonElement> variant : this.variants(request.getValue().orElse(null)).entrySet()) {
                    if (withJar) {
                        this.openJar(client);
                    }

                    this.send(client, method, variant.getKey(), variant.getValue());
                }
            }
        }

        assertThat(String.join("\n", this.failures), this.failures, is(empty()));
    }

    private void openJar(TestClient client) {
        JsonObject state = client.call("project/state");
        if (!state.has("jarPath") || state.get("jarPath").isJsonNull()) {
            client.openJar("inheritance_tree");
            client.source("a");
        }
    }

    private void send(TestClient client, String method, String what, JsonElement params) {
        String request = method + " with " + what + " " + params;
        JsonObject answer;
        try {
            answer = client.exchange(method, params);
        } catch (RuntimeException e) {
            this.failures.add(request + ": no answer");
            return;
        }

        if (answer.has("error") && code(answer) == RpcException.INTERNAL_ERROR) {
            String trace = answer.getAsJsonObject("error").has("data")
                    ? answer.getAsJsonObject("error").get("data").toString().replace("\\n", "\n").lines().limit(6).reduce("", (a, b) -> a + "\n    " + b)
                    : "";
            this.failures.add(request + ": " + answer.getAsJsonObject("error").get("message").getAsString() + trace);
        }

        // and it is still there for the next
        try {
            client.callRaw("project/state");
        } catch (RuntimeException e) {
            this.failures.add(request + ": the backend stopped answering");
        }
    }

    private static int code(JsonObject answer) {
        return answer.getAsJsonObject("error").get("code").getAsInt();
    }

    /** What a request is sent, by what it is: one that fits, and every way it can be wrong. */
    private Map<String, JsonElement> variants(Class<? extends Record> type) {
        Map<String, JsonElement> variants = new LinkedHashMap<>();
        variants.put("nothing", null);
        variants.put("a number", new JsonPrimitive(42));
        variants.put("a string", new JsonPrimitive("x"));
        variants.put("a list", new JsonArray());
        variants.put("an empty object", new JsonObject());
        if (type == null) {
            return variants;
        }

        JsonObject valid = this.sample(type).getAsJsonObject();
        variants.put("what fits", valid);
        this.broken(valid, "", variants, valid);
        return variants;
    }

    /** Every part of an object left out, empty, or of another kind; and so for the objects inside it. */
    private void broken(JsonObject object, String path, Map<String, JsonElement> variants, JsonObject whole) {
        for (String key : List.copyOf(object.keySet())) {
            JsonElement value = object.get(key);
            String name = path + key;
            for (Map.Entry<String, JsonElement> replacement : replacements(value).entrySet()) {
                JsonObject copy = whole.deepCopy();
                JsonObject at = locate(copy, path);
                if (replacement.getValue() == null) {
                    at.remove(key);
                } else {
                    at.add(key, replacement.getValue());
                }

                variants.put(name + " " + replacement.getKey(), copy);
            }

            if (value.isJsonObject()) {
                this.broken(value.getAsJsonObject(), name + ".", variants, whole);
            } else if (value.isJsonArray() && !value.getAsJsonArray().isEmpty()) {
                JsonObject copy = whole.deepCopy();
                JsonArray withHole = new JsonArray();
                withHole.add(JsonNull.INSTANCE);
                locate(copy, path).add(key, withHole);
                variants.put(name + " with a hole", copy);
            }
        }
    }

    private static JsonObject locate(JsonObject root, String path) {
        JsonObject at = root;
        for (String part : path.isEmpty() ? new String[0] : path.substring(0, path.length() - 1).split("\\.")) {
            at = at.getAsJsonObject(part);
        }

        return at;
    }

    /** What a value is replaced with to be wrong, by what that is; nothing for leaving it out. */
    private static Map<String, JsonElement> replacements(JsonElement value) {
        Map<String, JsonElement> replacements = new LinkedHashMap<>();
        replacements.put("left out", null);
        replacements.put("null", JsonNull.INSTANCE);
        if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()) {
            replacements.put("empty", new JsonPrimitive(""));
            replacements.put("naming nothing", new JsonPrimitive("no/such/Thing$9 ()"));
            replacements.put("an object", new JsonObject());
            replacements.put("a list", new JsonArray());
        } else if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber()) {
            replacements.put("negative", new JsonPrimitive(-1));
            replacements.put("huge", new JsonPrimitive(Long.MAX_VALUE));
            replacements.put("a fraction", new JsonPrimitive(0.5));
            replacements.put("a string", new JsonPrimitive("x"));
        } else if (value.isJsonPrimitive()) {
            replacements.put("a string", new JsonPrimitive("x"));
            replacements.put("an object", new JsonObject());
        } else {
            replacements.put("a string", new JsonPrimitive("x"));
            replacements.put("a number", new JsonPrimitive(3));
        }

        return replacements;
    }

    /** A value of a type that fits it: names of the test jar, paths in a folder of the test, and so on. */
    private JsonElement sample(Type type) {
        return this.sample(type, "");
    }

    private JsonElement sample(Type type, String name) {
        Class<?> raw = type instanceof ParameterizedType parameterized ? (Class<?>) parameterized.getRawType() : (Class<?>) type;
        if (raw == EntryRef.class) {
            return TestClient.method("a", "a", "()V");
        }

        if (raw == String.class) {
            return new JsonPrimitive(this.text(name.toLowerCase(Locale.ROOT)));
        }

        if (raw == int.class || raw == Integer.class || raw == long.class || raw == Long.class) {
            return new JsonPrimitive(name.toLowerCase(Locale.ROOT).contains("limit") ? 10 : 0);
        }

        if (raw == boolean.class || raw == Boolean.class) {
            return new JsonPrimitive(false);
        }

        if (raw.isEnum()) {
            return new JsonPrimitive(EnumAdapterFactory.wireName((Enum<?>) raw.getEnumConstants()[0]));
        }

        if (Collection.class.isAssignableFrom(raw) && type instanceof ParameterizedType parameterized) {
            JsonArray list = new JsonArray();
            list.add(this.sample(parameterized.getActualTypeArguments()[0], name));
            return list;
        }

        if (Map.class.isAssignableFrom(raw)) {
            return new JsonObject();
        }

        if (raw == JsonElement.class) {
            return new JsonPrimitive("x");
        }

        if (raw.isRecord()) {
            JsonObject object = new JsonObject();
            for (RecordComponent component : raw.getRecordComponents()) {
                SerializedName serialized;
                try {
                    serialized = raw.getDeclaredField(component.getName()).getAnnotation(SerializedName.class);
                } catch (NoSuchFieldException e) {
                    serialized = null;
                }

                String key = serialized == null ? component.getName() : serialized.value();
                object.add(key, this.sample(component.getGenericType(), key));
            }

            return object;
        }

        throw new AssertionError("No sample for " + type + " (" + name + ")");
    }

    private String text(String name) {
        if (name.equals("jar")) {
            return TestClient.jar("inheritance_tree").toString();
        }

        if (name.contains("path") || name.contains("directory") || name.contains("file") || name.equals("mappings")) {
            return this.temp.resolve("out-" + name).toString();
        }

        if (name.contains("address")) {
            // nothing listens there: connecting fails at once
            return "127.0.0.1:1";
        }

        if (name.contains("format")) {
            return "enigma:enigma_file";
        }

        if (name.equals("id") || name.contains("decompiler")) {
            return "enigma:vineflower";
        }

        if (name.contains("desc")) {
            return "()V";
        }

        if (name.contains("user")) {
            return "tester";
        }

        if (name.contains("password") || name.contains("profile")) {
            return "";
        }

        return "a";
    }
}
