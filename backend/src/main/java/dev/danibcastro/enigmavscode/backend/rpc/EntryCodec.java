package dev.danibcastro.enigmavscode.backend.rpc;


import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import lombok.experimental.UtilityClass;
import org.quiltmc.enigma.api.translation.representation.MethodDescriptor;
import org.quiltmc.enigma.api.translation.representation.TypeDescriptor;
import org.quiltmc.enigma.api.translation.representation.entry.*;

import java.util.LinkedHashMap;
import java.util.Map;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 14:21
 * Created by: Dani-error
 *
 * Enigma's Entry (de)serialization
 */
@UtilityClass
public class EntryCodec {

    public static Map<String, Object> toJson(Entry<?> entry) {
        Map<String, Object> json = new LinkedHashMap<>();
        if (entry instanceof ClassEntry classEntry) {
            json.put("kind", "class");
            json.put("name", classEntry.getFullName());
        } else if (entry instanceof FieldEntry field) {
            json.put("kind", "field");
            if (field.getParent() != null) {
                json.put("owner", field.getParent().getFullName());
            }
            json.put("name", field.getName());
            json.put("desc", field.getDesc().toString());
        } else if (entry instanceof MethodEntry method) {
            json.put("kind", "method");
            if (method.getParent() != null) {
                json.put("owner", method.getParent().getFullName());
            }
            json.put("name", method.getName());
            json.put("desc", method.getDesc().toString());
        } else if (entry instanceof LocalVariableEntry local) {
            MethodEntry method = local.getParent();
            json.put("kind", "local");
            if (method.getParent() != null) {
                json.put("owner", method.getParent().getFullName());
            }
            json.put("method", method.getName());
            json.put("desc", method.getDesc().toString());
            json.put("index", local.getIndex());
            json.put("parameter", local.isArgument());
            json.put("name", local.getName());
        } else {
            throw new IllegalArgumentException("Cannot serialize entry of type " + entry.getClass().getName());
        }

        return json;
    }

    public static Entry<?> fromJson(JsonElement element) {
        if (element == null || !element.isJsonObject()) {
            throw RpcException.invalidParams("Expected an entry");
        }

        JsonObject json = element.getAsJsonObject();
        String kind = string(json, "kind");
        try {
            switch (kind) {
                case "class" -> {
                    return new ClassEntry(string(json, "name"));
                }
                case "field" -> {
                    return new FieldEntry(new ClassEntry(string(json, "owner")), string(json, "name"), new TypeDescriptor(string(json, "desc")));
                }
                case "method" -> {
                    return new MethodEntry(new ClassEntry(string(json, "owner")), string(json, "name"), new MethodDescriptor(string(json, "desc")));
                }
                case "local" -> {
                    MethodEntry method = new MethodEntry(new ClassEntry(string(json, "owner")), string(json, "method"), new MethodDescriptor(string(json, "desc")));
                    boolean parameter = !json.has("parameter") || json.get("parameter").getAsBoolean();
                    String name = json.has("name") && !json.get("name").isJsonNull() ? json.get("name").getAsString() : "";
                    return new LocalVariableEntry(method, json.get("index").getAsInt(), name, parameter, null);
                }
                default -> throw RpcException.invalidParams("Unknown entry kind: " + kind);
            }
        } catch (RpcException e) {
            throw e;
        } catch (RuntimeException e) {
            throw RpcException.invalidParams("Malformed entry: " + e.getMessage());
        }
    }

    public static ClassEntry classFromJson(JsonObject params, String key) {
        if (!params.has(key) || params.get(key).isJsonNull()) {
            throw RpcException.invalidParams("Missing parameter: " + key);
        }

        JsonElement element = params.get(key);
        if (element.isJsonPrimitive()) {
            return new ClassEntry(element.getAsString());
        }

        if (fromJson(element) instanceof ClassEntry classEntry) {
            return classEntry;
        }

        throw RpcException.invalidParams("Expected a class entry for " + key);
    }

    private static String string(JsonObject json, String key) {
        if (!json.has(key) || json.get(key).isJsonNull()) {
            throw RpcException.invalidParams("Entry is missing \"" + key + "\"");
        }

        return json.get(key).getAsString();
    }

    public static String kindOf(Entry<?> entry) {
        if (entry instanceof ClassEntry) {
            return "class";
        } else if (entry instanceof FieldEntry) {
            return "field";
        } else if (entry instanceof MethodEntry method) {
            return method.isConstructor() ? "constructor" : "method";
        } else if (entry instanceof LocalVariableEntry local) {
            return local.isArgument() ? "parameter" : "local";
        }

        return "unknown";
    }

}
