package dev.danibcastro.enigmavscode.backend;


import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import lombok.RequiredArgsConstructor;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.function.Predicate;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:34
 * Created by: Dani-error
 */
final class TestClient implements AutoCloseable {

    static final Path OBF_JARS = Path.of(System.getProperty("enigma.test.obf", "../vendor/enigma/enigma/build/test-obf"));
    static final Path ENIGMA_ROOT = Path.of(System.getProperty("enigma.test.resources", "../vendor/enigma"));

    private static final byte[] EOF = new byte[0];

    private final BlockingQueue<byte[]> toServer = new LinkedBlockingQueue<>();
    private final BlockingQueue<byte[]> fromServer = new LinkedBlockingQueue<>();
    private final Map<Integer, CompletableFuture<JsonObject>> pending = new ConcurrentHashMap<>();
    private final List<JsonObject> notifications = new ArrayList<>();
    private final JsonRpcConnection connection;
    private int nextId = 1;

    static final class RpcError extends RuntimeException {
        final int code;
        final JsonElement data;

        RpcError(int code, String message, JsonElement data) {
            super(message);
            this.code = code;
            this.data = data;
        }
    }

    @RequiredArgsConstructor
    private static final class QueueInputStream extends InputStream {
        private final BlockingQueue<byte[]> queue;
        private byte[] current = new byte[0];
        private int position;
        private boolean finished;

        @Override
        public int read() throws IOException {
            while (this.position >= this.current.length) {
                if (this.finished) {
                    return -1;
                }

                try {
                    this.current = this.queue.take();
                } catch (InterruptedException e) {
                    throw new IOException(e);
                }

                this.position = 0;
                if (this.current == EOF) {
                    this.finished = true;
                    return -1;
                }
            }

            return this.current[this.position++] & 0xFF;
        }

        // Like a pipe or a socket: block for the first byte only, then hand over whatever is already there.
        // The inherited implementation would block until the whole buffer is full.
        @Override
        public int read(byte[] bytes, int offset, int length) throws IOException {
            if (length == 0) {
                return 0;
            }

            int first = this.read();
            if (first < 0) {
                return -1;
            }

            bytes[offset] = (byte) first;
            int count = Math.min(length - 1, this.current.length - this.position);
            System.arraycopy(this.current, this.position, bytes, offset + 1, count);
            this.position += count;
            return count + 1;
        }
    }

    @RequiredArgsConstructor
    private static final class QueueOutputStream extends OutputStream {
        private final BlockingQueue<byte[]> queue;

        @Override
        public void write(int b) {
            this.queue.add(new byte[]{(byte) b});
        }

        @Override
        public void write(byte[] bytes, int offset, int length) {
            byte[] copy = new byte[length];
            System.arraycopy(bytes, offset, copy, 0, length);
            this.queue.add(copy);
        }
    }

    TestClient() {
        this(new JsonObject());
    }

    TestClient(JsonObject settings) {
        this.connection = new JsonRpcConnection(new QueueInputStream(this.toServer), new QueueOutputStream(this.fromServer));
        new Backend(this.connection);

        Thread server = new Thread(this.connection::listen, "test-backend");
        server.setDaemon(true);
        server.start();

        Thread reader = new Thread(this::readLoop, "test-client-reader");
        reader.setDaemon(true);
        reader.start();

        this.request("initialize", settings);
    }


    static JsonObject params(Object... keyValues) {
        JsonObject params = new JsonObject();
        for (int i = 0; i < keyValues.length; i += 2) {
            params.add((String) keyValues[i], JsonRpcConnection.GSON.toJsonTree(keyValues[i + 1]));
        }

        return params;
    }

    private void readLoop() {
        InputStream in = new QueueInputStream(this.fromServer);
        try {
            while (true) {
                int length = -1;
                while (true) {
                    ByteArrayOutputStream line = new ByteArrayOutputStream();
                    int b;
                    while ((b = in.read()) != '\n') {
                        if (b < 0) {
                            return;
                        }

                        if (b != '\r') {
                            line.write(b);
                        }
                    }

                    String header = line.toString(StandardCharsets.US_ASCII);
                    if (header.isEmpty()) {
                        break;
                    }

                    if (header.startsWith("Content-Length:")) {
                        length = Integer.parseInt(header.substring("Content-Length:".length()).trim());
                    }
                }

                byte[] body = in.readNBytes(length);
                JsonObject message = JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
                if (message.has("id") && !message.has("method")) {
                    CompletableFuture<JsonObject> future = this.pending.remove(message.get("id").getAsInt());
                    if (future != null) {
                        future.complete(message);
                    }
                } else {
                    synchronized (this.notifications) {
                        this.notifications.add(message);
                        this.notifications.notifyAll();
                    }
                }
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    JsonElement request(String method, JsonObject params) {
        int id;
        CompletableFuture<JsonObject> future = new CompletableFuture<>();
        synchronized (this) {
            id = this.nextId++;
            this.pending.put(id, future);
            JsonObject message = new JsonObject();
            message.addProperty("jsonrpc", "2.0");
            message.addProperty("id", id);
            message.addProperty("method", method);
            message.add("params", params);
            byte[] body = message.toString().getBytes(StandardCharsets.UTF_8);
            this.toServer.add(("Content-Length: " + body.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            this.toServer.add(body);
        }

        JsonObject response;
        try {
            response = future.get(180, TimeUnit.SECONDS);
        } catch (InterruptedException | ExecutionException | TimeoutException e) {
            throw new RuntimeException("Request " + method + " did not complete", e);
        }

        if (response.has("error")) {
            JsonObject error = response.getAsJsonObject("error");
            throw new RpcError(error.get("code").getAsInt(), error.get("message").getAsString(), error.get("data"));
        }

        JsonElement result = response.get("result");
        return result == null ? JsonNull.INSTANCE : result;
    }

    JsonObject call(String method, Object... keyValues) {
        JsonElement result = this.request(method, params(keyValues));
        return result.isJsonObject() ? result.getAsJsonObject() : new JsonObject();
    }

    JsonElement callRaw(String method, Object... keyValues) {
        return this.request(method, params(keyValues));
    }

    /**
     * Waits for a notification that was received after {@code since} notifications had been seen.
     */
    JsonObject awaitNotification(String method, int since, Predicate<JsonObject> filter) {
        // short enough that a notification that never comes fails the test promptly instead of looking like a hang
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        synchronized (this.notifications) {
            int next = since;
            while (true) {
                for (; next < this.notifications.size(); next++) {
                    JsonObject notification = this.notifications.get(next);
                    if (notification.get("method").getAsString().equals(method) && filter.test(notification.getAsJsonObject("params"))) {
                        return notification.getAsJsonObject("params");
                    }
                }

                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) {
                    throw new AssertionError("Timed out waiting for notification " + method + "; received since then: "
                            + this.notifications.subList(Math.min(since, this.notifications.size()), this.notifications.size()).stream()
                            .filter(n -> !n.get("method").getAsString().equals("progress"))
                            .map(n -> n.toString().length() > 200 ? n.toString().substring(0, 200) + "..." : n.toString())
                            .toList());
                }

                try {
                    TimeUnit.NANOSECONDS.timedWait(this.notifications, remaining);
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                }
            }
        }
    }

    int notificationCount() {
        synchronized (this.notifications) {
            return this.notifications.size();
        }
    }

    List<JsonObject> notifications(String method) {
        synchronized (this.notifications) {
            return this.notifications.stream().filter(n -> n.get("method").getAsString().equals(method)).map(n -> n.getAsJsonObject("params")).toList();
        }
    }

    static Path jar(String name) {
        return OBF_JARS.resolve(name + ".jar");
    }

    void openJar(String name) {
        this.call("project/openJar", "jar", jar(name).toString());
    }

    /**
     * Fetches the source of a class, waiting for any pending re-mapping to be delivered first.
     */
    String source(String className) {
        return this.call("class/source", "class", className).get("text").getAsString();
    }

    static JsonObject classEntry(String name) {
        return params("kind", "class", "name", name);
    }

    static JsonObject method(String owner, String name, String desc) {
        return params("kind", "method", "owner", owner, "name", name, "desc", desc);
    }

    static JsonObject field(String owner, String name, String desc) {
        return params("kind", "field", "owner", owner, "name", name, "desc", desc);
    }

    JsonObject rename(JsonObject entry, String newName) {
        return this.call("entry/rename", "entry", entry, "newName", newName);
    }

    @Override
    public void close() {
        try {
            this.request("shutdown", new JsonObject());
        } finally {
            this.toServer.add(EOF);
            this.fromServer.add(EOF);
        }
    }

}
