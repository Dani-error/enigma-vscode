package dev.danibcastro.enigmavscode.backend.rpc;


import dev.danibcastro.enigmavscode.backend.protocol.error.ErrorData;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import lombok.Getter;
import org.jspecify.annotations.Nullable;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

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
    private final transient ErrorData data;

    public RpcException(int code, String message) {
        this(code, message, null);
    }

    public RpcException(int code, String message, @Nullable ErrorData data) {
        super(message);
        this.code = code;
        this.data = data;
    }

    public static RpcException user(String message) {
        return new RpcException(USER_ERROR, message);
    }

    /**
     * @param problem what happened
     * @param args what the text is about, in the order the client expects them
     */
    public static RpcException said(Problem problem, Object... args) {
        return new RpcException(USER_ERROR, describe(problem, args), new ErrorData.Said(problem, Arrays.stream(args).map(String::valueOf).toList()));
    }

    /** No jar is open: the request needs one. */
    public static RpcException noProject() {
        return new RpcException(NO_PROJECT, describe(Problem.NO_JAR), new ErrorData.Said(Problem.NO_JAR, List.of()));
    }

    /** What went wrong with a file, as the system says it. */
    public static String reason(IOException e) {
        return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
    }

    public static String describe(Problem problem, Object... args) {
        StringBuilder text = new StringBuilder(problem.wireName());
        for (int i = 0; i < args.length; i++) {
            text.append(i == 0 ? ": " : ", ").append(args[i]);
        }

        return text.toString();
    }

    public static RpcException invalidParams(String message) {
        return new RpcException(INVALID_PARAMS, message);
    }

}
