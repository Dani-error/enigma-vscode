package dev.danibcastro.enigmavscode.backend.rpc;


import com.google.gson.*;
import lombok.Getter;
import org.jspecify.annotations.Nullable;
import org.tinylog.Logger;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.*;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 14:14
 * Created by: Dani-error
 *
 * Minimal JSON-RPC 2.0 endpoint.
 */
public final class JsonRpcConnection implements Closeable {

    public static final Gson GSON = new GsonBuilder()
            .disableHtmlEscaping()
            .serializeNulls()
            .create();

    private final InputStream in;
    private final OutputStream out;

    private final Object writeLock = new Object();
    private final Map<String, Handler> handlers = new ConcurrentHashMap<>();

    @Getter
    private final ExecutorService sessionExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "enigma-session");
        thread.setDaemon(true);
        return thread;
    });

    private volatile boolean closed;

    public JsonRpcConnection(InputStream in, OutputStream out) {
        this.in = new BufferedInputStream(in);
        this.out = out;
    }

    /**
     * Handles a request or a notification. May return a {@link CompletableFuture} for results that are produced asynchronously.
     */
    @FunctionalInterface
    public interface Handler {
        @Nullable
        Object handle(JsonObject params) throws Exception;
    }

    public void register(String method, Handler handler) {
        if (this.handlers.put(method, handler) != null) {
            throw new IllegalStateException("duplicate handler for " + method);
        }
    }

    /**
     * Runs a task on the session thread.
     */
    public void runOnSessionThread(Runnable task) {
        this.sessionExecutor.execute(() -> {
            try {
                task.run();
            } catch (Throwable t) {
                Logger.error(t, "Uncaught exception in session task");
            }
        });
    }

    /**
     * Reads messages until the input is closed.
     */
    public void listen() {
        try {
            while (!this.closed) {
                JsonObject message = this.readMessage();
                if (message == null) {
                    break;
                }

                this.dispatch(message);
            }
        } catch (EOFException e) {
            // the client went away
        } catch (IOException e) {
            Logger.error(e, "Failed to read message");
        } finally {
            this.closed = true;
        }
    }

    public void close() {
        this.closed = true;
        this.sessionExecutor.shutdown();
    }

    @Nullable
    private JsonObject readMessage() throws IOException {
        int contentLength = -1;

        while (true) {
            String line = this.readHeaderLine();
            if (line == null) {
                return null;
            }

            if (line.isEmpty()) {
                if (contentLength >= 0) {
                    break;
                }

                // tolerate stray blank lines between messages
                continue;
            }

            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("Content-Length")) {
                contentLength = Integer.parseInt(line.substring(colon + 1).trim());
            }
        }

        byte[] body = this.in.readNBytes(contentLength);
        if (body.length < contentLength) {
            throw new EOFException();
        }

        JsonElement element = JsonParser.parseString(new String(body, StandardCharsets.UTF_8));
        if (!element.isJsonObject()) {
            throw new IOException("Expected a JSON object");
        }

        return element.getAsJsonObject();
    }

    @Nullable
    private String readHeaderLine() throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        while (true) {
            int b = this.in.read();
            if (b < 0) {
                return buffer.size() == 0 ? null : buffer.toString(StandardCharsets.US_ASCII);
            }

            if (b == '\n') {
                return buffer.toString(StandardCharsets.US_ASCII);
            }

            if (b != '\r') {
                buffer.write(b);
            }
        }
    }

    private void dispatch(JsonObject message) {
        if (!message.has("method")) {
            // responses to server-initiated requests are not used by this protocol
            return;
        }

        String method = message.get("method").getAsString();
        JsonElement id = message.get("id");
        JsonElement rawParams = message.get("params");
        JsonObject params = rawParams != null && rawParams.isJsonObject() ? rawParams.getAsJsonObject() : new JsonObject();

        Handler handler = this.handlers.get(method);
        if (handler == null) {
            if (id != null) {
                this.sendError(id, RpcException.METHOD_NOT_FOUND, "Unknown method: " + method, null);
            }

            return;
        }

        this.sessionExecutor.execute(() -> {
            try {
                Object result = handler.handle(params);
                if (result instanceof CompletableFuture<?> future) {
                    future.whenComplete((value, error) -> {
                        if (error != null) {
                            this.respondError(id, method, error);
                        } else if (id != null) {
                            this.sendResult(id, value);
                        }
                    });
                } else if (id != null) {
                    this.sendResult(id, result);
                }
            } catch (Throwable t) {
                this.respondError(id, method, t);
            }
        });
    }

    /**
     * Answers a request that failed. Whatever else goes wrong here, the client gets an answer: it waits for one, and
     * shows nothing until it has it.
     */
    private void respondError(@Nullable JsonElement id, String method, Throwable error) {
        Throwable cause = error;
        while ((cause instanceof CompletionException || cause instanceof ExecutionException) && cause.getCause() != null) {
            cause = cause.getCause();
        }

        if (cause instanceof RpcException rpc) {
            if (id != null) {
                this.sendError(id, rpc.getCode(), String.valueOf(rpc.getMessage()), rpc.getData());
            }

            return;
        }

        if (id != null) {
            String message = cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getClass().getSimpleName() + ": " + cause.getMessage();
            JsonObject data = new JsonObject();
            try {
                StringWriter trace = new StringWriter();
                cause.printStackTrace(new PrintWriter(trace));
                data.addProperty("stackTrace", trace.toString());
            } catch (Throwable ignored) {
                // the message alone will have to do
            }

            this.sendError(id, RpcException.INTERNAL_ERROR, message, data);
        }

        try {
            Logger.error(cause, "Request {} failed", method);
        } catch (Throwable ignored) {
            // nothing left to tell it to
        }
    }

    private void sendResult(JsonElement id, @Nullable Object result) {
        JsonObject message = new JsonObject();
        message.addProperty("jsonrpc", "2.0");
        message.add("id", id);
        try {
            message.add("result", result == null ? JsonNull.INSTANCE : GSON.toJsonTree(result));
        } catch (RuntimeException e) {
            Logger.error(e, "Failed to serialize result");
            this.sendError(id, RpcException.INTERNAL_ERROR, "Failed to serialize result: " + e, null);
            return;
        }

        this.write(message);
    }

    private void sendError(JsonElement id, int code, String text, @Nullable JsonElement data) {
        JsonObject error = new JsonObject();
        error.addProperty("code", code);
        error.addProperty("message", text);
        if (data != null) {
            error.add("data", data);
        }

        JsonObject message = new JsonObject();
        message.addProperty("jsonrpc", "2.0");
        message.add("id", id);
        message.add("error", error);
        this.write(message);
    }

    /**
     * Sends a notification to the client. May be called from any thread.
     */
    public void notify(String method, @Nullable Object params) {
        JsonObject message = new JsonObject();
        message.addProperty("jsonrpc", "2.0");
        message.addProperty("method", method);
        message.add("params", params == null ? new JsonObject() : GSON.toJsonTree(params));
        this.write(message);
    }

    private void write(JsonObject message) {
        if (this.closed) {
            return;
        }

        byte[] body = GSON.toJson(message).getBytes(StandardCharsets.UTF_8);
        byte[] header = ("Content-Length: " + body.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);

        synchronized (this.writeLock) {
            try {
                this.out.write(header);
                this.out.write(body);
                this.out.flush();
            } catch (IOException e) {
                this.closed = true;
            }
        }
    }

}
