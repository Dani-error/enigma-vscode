package dev.danibcastro.enigmavscode.backend.rpc;


import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import lombok.Getter;
import org.jspecify.annotations.Nullable;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 14:27
 * Created by: Dani-error
 *
 * Error which is reported back to the client through the JSON-RPC
 */
@Getter
public class RpcException extends RuntimeException {

    // error codes
    public static final int PARSE_ERROR = -32700;
    public static final int INVALID_REQUEST = -32600;
    public static final int METHOD_NOT_FOUND = -32601;
    public static final int INVALID_PARAMS = -32602;
    public static final int INTERNAL_ERROR = -32603;

    /** No jar is open. */
    public static final int NO_PROJECT = 1;
    /** The request cannot be fulfilled in the current state, with a message meant for the user. */
    public static final int USER_ERROR = 2;
    /** A position was sent for a text of a class that is not the one the client was last given. */
    public static final int STALE = 3;

    private final int code;
    @Nullable
    private final transient JsonElement data;

    public RpcException(int code, String message) {
        this(code, message, null);
    }

    public RpcException(int code, String message, @Nullable JsonElement data) {
        super(message);
        this.code = code;
        this.data = data;
    }

    public static RpcException user(String message) {
        return new RpcException(USER_ERROR, message);
    }

    /**
     * @param key what happened, like {@code jar-not-found}; the client has a text for each
     * @param args what the text is about, in the order the client expects them
     */
    public static RpcException said(String key, Object... args) {
        return new RpcException(USER_ERROR, describe(key, args), data(key, args));
    }

    /** No jar is open: the request needs one. */
    public static RpcException noProject() {
        return new RpcException(NO_PROJECT, "no-jar", data("no-jar"));
    }

    public static String describe(String key, Object... args) {
        StringBuilder text = new StringBuilder(key);
        for (int i = 0; i < args.length; i++) {
            text.append(i == 0 ? ": " : ", ").append(args[i]);
        }

        return text.toString();
    }

    public static JsonObject data(String key, Object... args) {
        JsonObject data = new JsonObject();
        data.addProperty("key", key);
        JsonArray values = new JsonArray();
        for (Object arg : args) {
            values.add(String.valueOf(arg));
        }

        data.add("args", values);
        return data;
    }

    public static RpcException invalidParams(String message) {
        return new RpcException(INVALID_PARAMS, message);
    }

}
