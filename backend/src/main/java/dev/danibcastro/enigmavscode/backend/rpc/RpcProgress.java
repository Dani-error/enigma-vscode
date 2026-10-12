package dev.danibcastro.enigmavscode.backend.rpc;


import org.quiltmc.enigma.api.ProgressListener;

import java.util.LinkedHashMap;
import java.util.Map;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 14:24
 * Created by: Dani-error
 */
public final class RpcProgress extends ProgressListener {

    private static final long MIN_INTERVAL_NANOS = 60_000_000L;

    private final JsonRpcConnection rpc;
    private final long id;
    private final String task;
    private final String[] taskArgs;
    private long lastSent;

    /**
     * @param task what is being done, as a key the client has a text for, like {@code opening-jar}
     * @param taskArgs what that text is about
     */
    public RpcProgress(JsonRpcConnection rpc, long id, String task, String... taskArgs) {
        this.rpc = rpc;
        this.id = id;
        this.task = task;
        this.taskArgs = taskArgs;
        this.send("begin", true);
    }

    @Override
    public synchronized void init(int totalWork, String title) {
        super.init(totalWork, title);
        this.workDone = 0;
        this.currentMessage = null;
        this.send("report", true);
    }

    @Override
    public synchronized void step(int workDone, String message) {
        super.step(workDone, message);
        this.send("report", false);
    }

    public synchronized void end() {
        this.send("end", true);
    }

    private void send(String phase, boolean force) {
        long now = System.nanoTime();
        if (!force && now - this.lastSent < MIN_INTERVAL_NANOS) {
            return;
        }

        this.lastSent = now;
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("id", this.id);
        params.put("phase", phase);
        params.put("task", this.task);
        params.put("taskArgs", this.taskArgs);
        params.put("title", this.title);
        params.put("message", this.currentMessage);
        params.put("done", this.workDone);
        params.put("total", this.totalWork);
        this.rpc.notify("progress", params);
    }

}
