package dev.danibcastro.enigmavscode.backend;


import dev.danibcastro.enigmavscode.backend.protocol.collab.ConnectionState;
import dev.danibcastro.enigmavscode.backend.protocol.entry.ClassItem;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.project.*;
import dev.danibcastro.enigmavscode.backend.rpc.Announcement;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.rpc.RpcProgress;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.Enigma;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.service.DecompilerService;
import org.quiltmc.enigma.api.service.ReadWriteService;
import org.quiltmc.enigma.api.source.Decompilers;
import org.quiltmc.enigma.api.stats.StatsGenerator;
import org.quiltmc.enigma.impl.analysis.IndexTreeBuilder;
import org.quiltmc.enigma.util.I18n;

import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:39
 * Created by: Dani-error
 */
@Accessors(fluent = true)
public final class Session {

    @Getter
    private final JsonRpcConnection rpc;
    @Getter
    private final EditHistory history = new EditHistory();
    private final Set<Editable> editable = EnumSet.allOf(Editable.class);
    private final AtomicLong progressIds = new AtomicLong();

    @Setter @Getter
    private Enigma enigma = Enigma.create();
    @Setter @Getter
    private DecompilerService decompiler = Decompilers.VINEFLOWER;
    @Setter @Getter
    private boolean autoSave;

    @Nullable @Getter
    private EnigmaProject project;
    @Nullable
    private IndexTreeBuilder indexTreeBuilder;
    @Nullable
    private StatsGenerator statsGenerator;
    @Nullable @Getter
    private Path mappingsPath;
    @Nullable @Getter
    private ReadWriteService mappingsService;
    @Getter @Setter
    private ConnectionState connectionState = ConnectionState.NOT_CONNECTED;

    /** Incremented whenever the mappings change in any way. */
    @Getter
    private long revision;

    public Session(JsonRpcConnection rpc) {
        this.rpc = rpc;
    }

    public void setEditable(Collection<Editable> editable) {
        this.editable.clear();
        this.editable.addAll(editable);
    }

    /** Whether this is a guest on the server of someone else, who owns the mappings then. */
    public boolean isRemoteClient() {
        return this.connectionState == ConnectionState.CONNECTED;
    }

    /** Takes a jar that was just opened: it has no mappings from a file, and nothing was done to it. */
    public void openProject(EnigmaProject project) {
        this.project = project;
        this.indexTreeBuilder = new IndexTreeBuilder(project.getJarIndex());
        this.statsGenerator = new StatsGenerator(project);
        this.setMappingsFile(null, null);
        this.history.clear();
    }

    public void closeProject() {
        this.project = null;
        this.indexTreeBuilder = null;
        this.statsGenerator = null;
        this.setMappingsFile(null, null);
        this.history.clear();
        this.revision++;
    }

    /** Says where the mappings are on disk from now on, or with two nulls that they are nowhere. */
    public void setMappingsFile(@Nullable ReadWriteService service, @Nullable Path path) {
        this.mappingsService = service;
        this.mappingsPath = path;
    }

    /** Forgets what was counted: the mappings are others now. */
    public void resetStatistics() {
        this.statsGenerator = new StatsGenerator(this.requireProject());
    }

    public StatsGenerator requireStatsGenerator() {
        if (this.statsGenerator == null) {
            throw RpcException.noProject();
        }

        return this.statsGenerator;
    }

    public IndexTreeBuilder requireIndexTreeBuilder() {
        if (this.indexTreeBuilder == null) {
            throw RpcException.noProject();
        }

        return this.indexTreeBuilder;
    }

    public EnigmaProject requireProject() {
        if (this.project == null) {
            throw RpcException.noProject();
        }

        return this.project;
    }

    /**
     * @param task what is being done
     * @param args what that text is about
     */
    public RpcProgress progress(Task task, Object... args) {
        return new RpcProgress(this.rpc, this.progressIds.incrementAndGet(), task, Arrays.stream(args).map(String::valueOf).toArray(String[]::new));
    }

    /**
     * Tells the user something this layer has no words for: see {@link RpcException#said}.
     */
    public void notifyUserOf(Severity severity, Problem problem, Object... args) {
        this.rpc.notify(Announcement.NOTIFICATION, new Notification(severity, RpcException.describe(problem, args), problem, Arrays.stream(args).map(String::valueOf).toList(), null));
    }

    /**
     * Tells the user something in words that are already in their language: a message of Enigma, mirroring its
     * notification manager.
     */
    public void notifyUser(Severity severity, String text, @Nullable String details) {
        this.rpc.notify(Announcement.NOTIFICATION, new Notification(severity, text, null, null, details == null || details.isEmpty() ? null : details));
    }

    public boolean isEditable(Editable type) {
        return this.editable.contains(type);
    }

    public State state() {
        EnigmaProject project = this.project;
        return new State(
                project == null ? null : project.getJarPath().toString(),
                project == null ? null : HexFormat.of().formatHex(project.getJarChecksum()),
                this.mappingsPath == null ? null : this.mappingsPath.toString(),
                this.mappingsService == null ? null : this.mappingsService.getId(),
                project != null && project.getRemapper().isDirty(),
                this.decompiler.getId(),
                this.revision,
                this.history.canUndo(), this.history.canRedo(), this.history.undoLabel(), this.history.redoLabel(),
                this.connectionState,
                EnumSet.copyOf(this.editable));
    }

    public void notifyState() {
        this.rpc.notify(Announcement.STATE_CHANGED, this.state());
    }

    /**
     * Announces that mappings changed.
     * @param classes the top-level classes whose names changed, or {@code null} if everything has to be reloaded
     */
    public void notifyMappingsChanged(@Nullable Collection<ClassItem> classes) {
        this.revision++;
        this.rpc.notify(Announcement.MAPPINGS_CHANGED, new MappingsChanged(this.revision, classes == null, classes == null ? List.of() : classes));
        this.notifyState();
    }

    public static String translateOr(String key, String fallback) {
        String translated = I18n.translateOrNull(key);
        return translated == null ? fallback : translated;
    }

}
