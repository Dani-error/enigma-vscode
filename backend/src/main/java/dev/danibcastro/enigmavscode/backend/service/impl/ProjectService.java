package dev.danibcastro.enigmavscode.backend.service.impl;


import com.google.gson.JsonElement;
import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.project.*;
import dev.danibcastro.enigmavscode.backend.rpc.Announcement;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.rpc.RpcProgress;
import dev.danibcastro.enigmavscode.backend.service.Service;
import lombok.RequiredArgsConstructor;
import org.quiltmc.enigma.api.Enigma;
import org.quiltmc.enigma.api.EnigmaProfile;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.class_provider.ClassProvider;
import org.quiltmc.enigma.api.class_provider.ClasspathClassProvider;
import org.quiltmc.enigma.api.class_provider.CombiningClassProvider;
import org.quiltmc.enigma.api.class_provider.JarClassProvider;
import org.quiltmc.enigma.api.service.DecompilerService;
import org.quiltmc.enigma.api.service.ReadWriteService;
import org.quiltmc.enigma.impl.source.vineflower.VineflowerPreferences;
import org.quiltmc.enigma.util.I18n;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:00
 * Created by: Dani-error
 */
@RequiredArgsConstructor
public final class ProjectService implements Service {

    private final Session session;
    private final SourceService sources;
    private final MappingsService mappings;
    private final CollabService collab;

    @Override
    public void register() {
        JsonRpcConnection rpc = this.session.rpc();
        rpc.register("initialize", ConfigureParams.class, this::initialize);
        rpc.registerAction("configure", ConfigureParams.class, this::configure);
        rpc.registerAction("shutdown", this::closeJar);
        rpc.register("project/openJar", OpenJarParams.class, this::openJar);
        rpc.register("project/closeJar", () -> {
            this.closeJar();
            return this.session.state();
        });
        rpc.register("project/state", this.session::state);
        rpc.register("project/reload", ReloadParams.class, this::reloadAll);
        rpc.register("decompiler/set", SetDecompilerParams.class, this::setDecompiler);
    }

    private Environment initialize(ConfigureParams params) throws IOException {
        this.configure(params);

        Path profilePath = params.profile() == null || params.profile().isEmpty() ? null : Path.of(params.profile());
        if (profilePath != null && !Files.isRegularFile(profilePath)) {
            throw RpcException.said(Problem.PROFILE_NOT_FOUND, profilePath);
        }

        EnigmaProfile profile = EnigmaProfile.read(profilePath);
        this.session.enigma(Enigma.builder().setProfile(profile).build());

        String decompilerId = params.decompiler();
        if (decompilerId != null) {
            this.session.decompiler(this.findDecompiler(decompilerId));
        }

        return this.describeEnvironment();
    }

    /**
     * Applies settings that can change while the backend is running.
     */
    private void configure(ConfigureParams params) {
        String language = params.language();
        if (language != null && I18n.getAvailableLanguages().contains(language)) {
            I18n.setLanguage(language);
        }

        if (params.editable() != null) {
            // settings are written by hand: what names nothing is passed over
            this.session.setEditable(params.editable().stream().flatMap(name -> Editable.named(name).stream()).toList());
        }

        if (params.autoSave() != null) {
            this.session.autoSave(params.autoSave());
        }

        boolean vineflowerChanged = false;
        if (params.vineflower() != null) {
            Map<String, Object> options = new LinkedHashMap<>();
            for (Map.Entry<String, JsonElement> option : params.vineflower().entrySet()) {
                JsonElement value = option.getValue();
                if (value.isJsonPrimitive()) {
                    if (value.getAsJsonPrimitive().isBoolean()) {
                        options.put(option.getKey(), value.getAsBoolean() ? "1" : "0");
                    } else {
                        options.put(option.getKey(), value.getAsString());
                    }
                }
            }

            if (!options.equals(VineflowerPreferences.OPTIONS)) {
                VineflowerPreferences.OPTIONS.clear();
                VineflowerPreferences.OPTIONS.putAll(options);
                vineflowerChanged = true;
            }
        }

        if (this.session.project() != null) {
            if (vineflowerChanged) {
                this.sources.invalidateAll();
            }

            this.session.notifyState();
        }
    }

    private Environment describeEnvironment() {
        List<Environment.Decompiler> decompilers = new ArrayList<>();
        for (DecompilerService service : this.session.enigma().getServices().get(DecompilerService.TYPE)) {
            decompilers.add(new Environment.Decompiler(service.getId(), Session.translateOr(service.getId(), service.getId())));
        }

        List<Environment.Format> formats = new ArrayList<>();
        for (ReadWriteService service : this.session.enigma().getReadWriteServices()) {
            formats.add(new Environment.Format(service.getId(), Session.translateOr(service.getId(), service.getId()), service.getFileType().getExtensions(),
                    service.getFileType().isDirectory(), service.supportsReading(), service.supportsWriting()));
        }

        List<Environment.Preference> preferences = new ArrayList<>();
        for (VineflowerPreferences.Preference preference : VineflowerPreferences.getPreferences()) {
            preferences.add(new Environment.Preference(preference.key(), preference.type(), preference.name(), preference.description(),
                    String.valueOf(VineflowerPreferences.DEFAULTS.get(preference.key()))));
        }

        return new Environment(Enigma.VERSION, Enigma.VINEFLOWER_VERSION, Enigma.CFR_VERSION, Enigma.PROCYON_VERSION, Runtime.version().toString(),
                decompilers, formats, preferences, I18n.getAvailableLanguages(), this.session.state());
    }

    private DecompilerService findDecompiler(String id) {
        return this.session.enigma().getService(DecompilerService.TYPE, id)
                .orElseThrow(() -> RpcException.said(Problem.UNKNOWN_DECOMPILER, id));
    }

    private State setDecompiler(SetDecompilerParams params) {
        DecompilerService decompiler = this.findDecompiler(params.id());
        this.session.decompiler(decompiler);
        this.sources.setDecompiler(decompiler);
        this.session.notifyState();
        return this.session.state();
    }

    private State openJar(OpenJarParams params) throws Exception {
        Path jar = Path.of(params.jar()).toAbsolutePath();
        if (!Files.isRegularFile(jar)) {
            throw RpcException.said(Problem.JAR_NOT_FOUND, jar);
        }

        List<String> libraries = Objects.requireNonNullElse(params.libraries(), List.of());

        this.closeJar();

        List<ClassProvider> libraryProviders = new ArrayList<>();
        libraryProviders.add(new ClasspathClassProvider());
        for (String library : libraries) {
            Path libraryPath = Path.of(library);
            if (!Files.isRegularFile(libraryPath)) {
                throw RpcException.said(Problem.LIBRARY_NOT_FOUND, libraryPath);
            }

            libraryProviders.add(new JarClassProvider(libraryPath));
        }

        ClassProvider libraryProvider = libraryProviders.size() == 1
                ? libraryProviders.get(0)
                : new CombiningClassProvider(libraryProviders.toArray(ClassProvider[]::new));

        RpcProgress progress = this.session.progress(Task.OPENING_JAR, jar.getFileName());
        try {
            EnigmaProject project = this.session.enigma().openJar(jar, libraryProvider, progress);
            this.session.openProject(project);
            this.sources.onProjectOpened(project, this.session.decompiler());
        } finally {
            progress.end();
        }

        this.session.rpc().notify(Announcement.PROJECT_CHANGED, this.session.state());
        this.session.notifyMappingsChanged(null);
        this.session.notifyUser(Severity.INFO, I18n.translateFormatted("validation.message.opened_jar", jar.getFileName().toString()), null);
        return this.session.state();
    }

    /** Closes the jar that is open, if one is, and everything that goes with it. */
    public void closeJar() {
        if (this.session.project() == null) {
            return;
        }

        this.collab.disconnect(null);
        this.sources.onProjectClosed();
        this.session.closeProject();
        this.session.rpc().notify(Announcement.PROJECT_CHANGED, this.session.state());
    }

    private State reloadAll(ReloadParams params) throws Exception {
        EnigmaProject project = this.session.requireProject();
        Path mappingsPath = this.session.mappingsPath();
        ReadWriteService service = this.session.mappingsService();

        this.openJar(new OpenJarParams(project.getJarPath().toString(), params.libraries()));
        if (mappingsPath != null && service != null) {
            this.mappings.load(service, mappingsPath);
        }

        return this.session.state();
    }

}
