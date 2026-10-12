package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.project.PathParams;
import dev.danibcastro.enigmavscode.backend.protocol.project.Task;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.rpc.RpcProgress;
import dev.danibcastro.enigmavscode.backend.service.Service;
import lombok.AllArgsConstructor;
import org.quiltmc.enigma.api.EnigmaProject;
import org.tinylog.Logger;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:51
 * Created by: Dani-error
 */
@AllArgsConstructor
public final class ExportService implements Service {

    private final Session session;

    @Override
    public void register() {
        this.session.rpc().registerAction("export/source", PathParams.class, this::exportSource);
        this.session.rpc().registerAction("export/jar", PathParams.class, this::exportJar);
    }

    private void exportSource(PathParams params) throws RpcException {
        EnigmaProject project = this.session.requireProject();
        Path path = Path.of(params.path()).toAbsolutePath();
        RpcProgress progress = this.session.progress(Task.EXPORTING_SOURCE);
        List<String> failures = new ArrayList<>();
        try {
            EnigmaProject.JarExport jar = project.exportRemappedJar(progress);
            jar.decompileStream(progress, this.session.decompiler(), EnigmaProject.DecompileErrorStrategy.TRACE_AS_SOURCE)
                    .forEach(source -> {
                        try {
                            source.writeTo(source.resolvePath(path));
                        } catch (IOException e) {
                            Logger.error(e, "Failed to write {}", source.name);
                            synchronized (failures) {
                                failures.add(source.name + ": " + e.getMessage());
                            }
                        }
                    });
        } finally {
            progress.end();
        }

        if (!failures.isEmpty()) {
            throw RpcException.said(Problem.EXPORT_SOURCE_FAILED, failures.size(), failures.get(0));
        }
    }

    private void exportJar(PathParams params) throws Exception {
        EnigmaProject project = this.session.requireProject();
        Path path = Path.of(params.path()).toAbsolutePath();
        RpcProgress progress = this.session.progress(Task.EXPORTING_JAR);

        try {
            EnigmaProject.JarExport jar = project.exportRemappedJar(progress);
            jar.write(path, progress);
        } finally {
            progress.end();
        }
    }

}
