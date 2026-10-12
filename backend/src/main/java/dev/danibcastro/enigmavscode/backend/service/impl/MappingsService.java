package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.LogCapture;
import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.error.ErrorData;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.project.*;
import dev.danibcastro.enigmavscode.backend.rpc.EntryCodec;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.rpc.RpcProgress;
import dev.danibcastro.enigmavscode.backend.service.Service;
import lombok.RequiredArgsConstructor;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.ProgressListener;
import org.quiltmc.enigma.api.service.ReadWriteService;
import org.quiltmc.enigma.api.translation.mapping.EntryMapping;
import org.quiltmc.enigma.api.translation.mapping.EntryRemapper;
import org.quiltmc.enigma.api.translation.mapping.MappingDelta;
import org.quiltmc.enigma.api.translation.mapping.serde.MappingParseException;
import org.quiltmc.enigma.api.translation.mapping.serde.MappingSaveParameters;
import org.quiltmc.enigma.api.translation.mapping.tree.EntryTree;
import org.quiltmc.enigma.api.translation.representation.entry.Entry;
import org.quiltmc.enigma.util.I18n;
import org.tinylog.Logger;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 18:48
 * Created by: Dani-error
 */
@RequiredArgsConstructor
public final class MappingsService implements Service {

    private static final Pattern PARSE_ERROR_PATTERN = Pattern.compile("^Line (\\d+): (.*) in file (.*)$", Pattern.DOTALL);

    private final Session session;
    private final SourceService sources;

    @Override
    public void register() {
        JsonRpcConnection rpc = this.session.rpc();
        rpc.register("mappings/open", OpenMappingsParams.class, this::openMappings);
        rpc.register("mappings/save", SaveMappingsParams.class, this::saveMappings);
        rpc.register("mappings/close", this::closeMappings);
        rpc.register("mappings/reload", this::reloadMappings);
        rpc.register("mappings/drop", this::dropMappings);
        rpc.registerAction("mappings/snapshot", PathParams.class, this::writeSnapshot);
        rpc.register("mappings/restoreSnapshot", PathParams.class, this::restoreSnapshot);
    }

    private ReadWriteService findReadWriteService(@Nullable String format, Path path) {
        if (format != null) {
            for (ReadWriteService service : this.session.enigma().getReadWriteServices()) {
                if (service.getId().equals(format)) {
                    return service;
                }
            }

            throw RpcException.said(Problem.UNKNOWN_MAPPING_FORMAT, format);
        }

        Optional<ReadWriteService> service = this.session.enigma().getReadWriteService(path);
        if (service.isEmpty()) {
            throw RpcException.user(I18n.translateFormatted("menu.file.open.non_parseable.unsupported_format", path));
        }

        return service.get();
    }

    private State openMappings(OpenMappingsParams params) throws Exception {
        this.session.requireProject();
        Path path = Path.of(params.path()).toAbsolutePath();
        if (!Files.exists(path)) {
            throw RpcException.said(Problem.MAPPINGS_NOT_FOUND, path);
        }

        ReadWriteService service = this.findReadWriteService(params.format(), path);
        if (!service.supportsReading()) {
            throw RpcException.user(I18n.translateFormatted("menu.file.open.non_parseable", Session.translateOr(service.getId(), service.getId())));
        }

        this.load(service, path);
        return this.session.state();
    }

    /** Reads mappings and makes them the ones of the project. */
    public void load(ReadWriteService service, Path path) throws Exception {
        EnigmaProject project = this.session.requireProject();
        RpcProgress progress = this.session.progress(Task.OPENING_MAPPINGS, path.getFileName());
        try {
            EntryTree<EntryMapping> mappings = service.read(path, progress);
            project.setMappings(mappings, progress);
        } catch (MappingParseException e) {
            throw parseError(e);
        } finally {
            progress.end();
        }

        this.session.setMappingsFile(service, path);
        this.session.resetStatistics();
        this.session.history().clear();
        this.sources.invalidateJavadoc();
        this.session.notifyMappingsChanged(null);
        this.session.notifyUser(Severity.INFO, I18n.translateFormatted("validation.message.opened_project", project.getJarPath().getFileName().toString(), path.getFileName().toString()), null);
    }

    /**
     * Replaces all mappings without touching the file association. Used by the collaboration client and by snapshot restore.
     */
    void replaceMappings(@Nullable EntryTree<EntryMapping> mappings, ProgressListener progress) {
        EnigmaProject project = this.session.requireProject();
        project.setMappings(mappings, progress);
        this.session.resetStatistics();
        this.session.history().clear();
        this.sources.invalidateJavadoc();
        this.session.notifyMappingsChanged(null);
    }

    private static RpcException parseError(MappingParseException e) {
        String message = String.valueOf(e.getMessage());
        Matcher matcher = PARSE_ERROR_PATTERN.matcher(message);
        ErrorData data = matcher.matches()
                ? new ErrorData.MappingParse(ErrorData.Kind.MAPPING_PARSE, Integer.parseInt(matcher.group(1)), matcher.group(2), matcher.group(3))
                : new ErrorData.MappingParse(ErrorData.Kind.MAPPING_PARSE, null, null, null);
        return new RpcException(RpcException.USER_ERROR, message, data);
    }

    private State saveMappings(SaveMappingsParams params) throws Exception {
        EnigmaProject project = this.session.requireProject();
        Path requested = params.path() == null || params.path().isEmpty() ? null : Path.of(params.path());
        Path path = requested != null ? requested.toAbsolutePath() : this.session.mappingsPath();
        if (path == null) {
            throw RpcException.said(Problem.NO_MAPPINGS_FILE_TO_SAVE);
        }

        if (this.session.isRemoteClient()) {
            throw RpcException.said(Problem.SAVE_WHILE_CONNECTED);
        }

        String format = params.format();
        ReadWriteService service;
        if (format == null && path.equals(this.session.mappingsPath()) && this.session.mappingsService() != null) {
            service = this.session.mappingsService();
        } else {
            service = this.findReadWriteService(format, path);
        }

        if (!service.supportsWriting()) {
            throw RpcException.user(I18n.translateFormatted("menu.file.save.non_writeable", Session.translateOr(service.getId(), service.getId())));
        }

        this.save(project, service, path);
        return this.session.state();
    }

    /**
     * Mirrors {@code GuiController#doSave}: only the changed classes are rewritten when saving to the loaded location.
     */
    private void save(EnigmaProject project, ReadWriteService service, Path path) throws Exception {
        EntryRemapper mapper = project.getRemapper();
        MappingSaveParameters saveParameters = this.session.enigma().getProfile().getMappingSaveParameters();
        boolean saveAll = !path.equals(this.session.mappingsPath()) || service != this.session.mappingsService();

        RpcProgress progress = this.session.progress(Task.SAVING_MAPPINGS);
        List<String> errors;
        try {
            MappingDelta<EntryMapping> delta = mapper.takeMappingDelta();
            errors = LogCapture.errorsDuring(() -> {
                if (saveAll) {
                    service.write(mapper.getMappings(), path, progress, saveParameters);
                } else {
                    service.write(mapper.getMappings(), delta, path, progress, saveParameters);
                }
            });

            if (!errors.isEmpty()) {
                // the engine reset its dirty tracking when the delta was taken, but nothing reliable was written:
                // flag every mapping as changed so the next save rewrites all of them
                mapper.getMappings().getAllEntries().toList().forEach(mapper.getMappings()::trackChange);
            }
        } finally {
            progress.end();
        }

        if (!errors.isEmpty()) {
            this.session.notifyState();
            throw RpcException.said(Problem.SAVE_FAILED, String.join("; ", errors));
        }

        this.session.setMappingsFile(service, path);
        this.session.notifyState();
    }

    /**
     * Saves in the background after an edit if the user asked for it, like Enigma's "auto save mappings" option.
     */
    void autoSaveIfEnabled() {
        EnigmaProject project = this.session.project();
        if (!this.session.autoSave() || project == null || this.session.mappingsPath() == null || this.session.mappingsService() == null
                || !this.session.mappingsService().supportsWriting() || this.session.isRemoteClient()) {
            return;
        }

        try {
            this.save(project, this.session.mappingsService(), this.session.mappingsPath());
        } catch (Exception e) {
            Logger.error(e, "Auto save failed");
            this.session.notifyUserOf(Severity.ERROR, Problem.AUTO_SAVE_FAILED, e.getMessage());
        }
    }

    private State closeMappings() {
        EnigmaProject project = this.session.requireProject();
        project.setMappings(null, ProgressListener.createEmpty());
        this.session.setMappingsFile(null, null);
        this.session.resetStatistics();
        this.session.history().clear();
        this.sources.invalidateJavadoc();
        this.session.notifyMappingsChanged(null);
        return this.session.state();
    }

    private State reloadMappings() throws Exception {
        this.session.requireProject();
        Path path = this.session.mappingsPath();
        ReadWriteService service = this.session.mappingsService();
        if (path == null || service == null) {
            throw RpcException.said(Problem.NO_MAPPINGS_FILE);
        }

        this.closeMappings();
        this.load(service, path);
        return this.session.state();
    }

    private Dropped dropMappings() {
        EnigmaProject project = this.session.requireProject();
        RpcProgress progress = this.session.progress(Task.DROPPING_MAPPINGS);
        Collection<Entry<?>> dropped;
        try {
            dropped = project.dropMappings(progress);
        } finally {
            progress.end();
        }

        List<EntryRef> entries = new ArrayList<>();
        for (Entry<?> entry : dropped) {
            entries.add(EntryCodec.toRef(entry));
        }

        if (!dropped.isEmpty()) {
            this.session.history().clear();
            this.sources.invalidateJavadoc();
            this.session.notifyMappingsChanged(null);
        }

        return new Dropped(entries);
    }

    /**
     * Writes every current mapping to a single Enigma-format file, without affecting the dirty state.
     * The extension uses this to protect unsaved work, since VS Code can close without asking.
     */
    private void writeSnapshot(PathParams params) throws Exception {
        EnigmaProject project = this.session.requireProject();
        Path path = Path.of(params.path()).toAbsolutePath();
        ReadWriteService service = this.findReadWriteService("enigma:enigma_file", path);
        Files.createDirectories(path.getParent());
        Files.deleteIfExists(path);

        List<String> errors = LogCapture.errorsDuring(() ->
                service.write(project.getRemapper().getMappings(), path, ProgressListener.createEmpty(), this.session.enigma().getProfile().getMappingSaveParameters()));
        if (!errors.isEmpty()) {
            throw RpcException.said(Problem.SNAPSHOT_FAILED, String.join("; ", errors));
        }
    }

    private State restoreSnapshot(PathParams params) throws Exception {
        EnigmaProject project = this.session.requireProject();
        Path path = Path.of(params.path()).toAbsolutePath();
        ReadWriteService service = this.findReadWriteService("enigma:enigma_file", path);
        EntryTree<EntryMapping> mappings;
        try {
            mappings = service.read(path, ProgressListener.createEmpty());
        } catch (MappingParseException e) {
            throw parseError(e);
        }

        this.replaceMappings(mappings, ProgressListener.createEmpty());
        // nothing of this has been saved to the real mappings file yet
        project.getRemapper().getMappings().getAllEntries().toList().forEach(project.getRemapper().getMappings()::trackChange);
        this.session.notifyState();
        return this.session.state();
    }
}
