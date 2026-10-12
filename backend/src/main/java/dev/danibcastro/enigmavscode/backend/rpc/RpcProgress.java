package dev.danibcastro.enigmavscode.backend.rpc;


import dev.danibcastro.enigmavscode.backend.protocol.project.Phase;
import dev.danibcastro.enigmavscode.backend.protocol.project.Progress;
import dev.danibcastro.enigmavscode.backend.protocol.project.Task;
import org.quiltmc.enigma.api.ProgressListener;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 14:24
 * Created by: Dani-error
 */
public final class RpcProgress extends ProgressListener {

    private static final long MIN_INTERVAL_NANOS = 60_000_000L;

    private final JsonRpcConnection rpc;
    private final long id;
    private final Task task;
    private final String[] taskArgs;
    private long lastSent;

    /**
     * @param task what is being done
     * @param taskArgs what that text is about
     */
    public RpcProgress(JsonRpcConnection rpc, long id, Task task, String... taskArgs) {
        this.rpc = rpc;
        this.id = id;
        this.task = task;
        this.taskArgs = taskArgs;
        this.send(Phase.BEGIN, true);
    }

    @Override
    public synchronized void init(int totalWork, String title) {
        super.init(totalWork, title);
        this.workDone = 0;
        this.currentMessage = null;
        this.send(Phase.REPORT, true);
    }

    @Override
    public synchronized void step(int workDone, String message) {
        super.step(workDone, message);
        this.send(Phase.REPORT, false);
    }

    public synchronized void end() {
        this.send(Phase.END, true);
    }

    private void send(Phase phase, boolean force) {
        long now = System.nanoTime();
        if (!force && now - this.lastSent < MIN_INTERVAL_NANOS) {
            return;
        }

        this.lastSent = now;
        this.rpc.notify(Announcement.PROGRESS, new Progress(this.id, phase, this.task, this.taskArgs, this.title, this.currentMessage, this.workDone, this.totalWork));
    }

}
