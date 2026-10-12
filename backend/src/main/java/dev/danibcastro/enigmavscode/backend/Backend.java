package dev.danibcastro.enigmavscode.backend;


import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.rpc.Params;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.rpc.RpcProgress;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.Enigma;
import org.quiltmc.enigma.api.EnigmaProfile;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.class_provider.ClassProvider;
import org.quiltmc.enigma.api.class_provider.ClasspathClassProvider;
import org.quiltmc.enigma.api.class_provider.CombiningClassProvider;
import org.quiltmc.enigma.api.class_provider.JarClassProvider;
import org.quiltmc.enigma.api.service.DecompilerService;
import org.quiltmc.enigma.api.service.ReadWriteService;
import org.quiltmc.enigma.api.source.Decompilers;
import org.quiltmc.enigma.api.stats.StatsGenerator;
import org.quiltmc.enigma.impl.analysis.IndexTreeBuilder;
import org.quiltmc.enigma.impl.source.vineflower.VineflowerPreferences;
import org.quiltmc.enigma.util.I18n;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 15:05
 * Created by: Dani-error
 *
 * Headless counterpart of Enigma's GuiController, owns the open project and exposes it through JSON-RPC
 */
public final class Backend {

    public static final List<String> EDITABLE_TYPES = List.of("class", "method", "field", "parameter", "local", "javadoc");

    public final JsonRpcConnection rpc;

    public Enigma enigma;
    @Nullable
    public EnigmaProject project;
    @Nullable
    public IndexTreeBuilder indexTreeBuilder;
    @Nullable
    public StatsGenerator statsGenerator;
    public DecompilerService decompiler = Decompilers.VINEFLOWER;

    @Nullable
    public Path mappingsPath;
    @Nullable
    public ReadWriteService mappingsService;
    public final Set<String> editable = new HashSet<>(EDITABLE_TYPES);
    public boolean autoSave;

    /** Incremented whenever the mappings change in any way. */
    public long revision;

    private final AtomicLong progressIds = new AtomicLong();

    public Backend(JsonRpcConnection rpc) {
        this.rpc = rpc;
        this.enigma = Enigma.create();
        // TODO: rest of services

        rpc.register("initialize", this::initialize);
        rpc.register("configure", this::configure);
        rpc.register("shutdown", params -> {
            this.closeJar();
            return null;
        });
        rpc.register("project/openJar", this::openJar);
        rpc.register("project/closeJar", params -> {
            this.closeJar();
            return this.state();
        });
        rpc.register("project/state", params -> this.state());
        rpc.register("project/reload", this::reloadAll);
        rpc.register("decompiler/set", this::setDecompiler);

        // register services
    }

    public EnigmaProject requireProject() {
        if (this.project == null) {
            throw RpcException.noProject();
        }

        return this.project;
    }

    /**
     * @param task what is being done, as a key the client has a text for
     * @param args what that text is about
     */
    public RpcProgress progress(String task, Object... args) {
        return new RpcProgress(this.rpc, this.progressIds.incrementAndGet(), task, java.util.Arrays.stream(args).map(String::valueOf).toArray(String[]::new));
    }

    /**
     * Tells the user something this layer has no words for: see {@link RpcException#said}.
     * @param type one of {@code info}, {@code warning} and {@code error}
     */
    public void notifyUserOf(String type, String key, Object... args) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("type", type);
        params.put("text", RpcException.describe(key, args));
        params.put("key", key);
        params.put("args", java.util.Arrays.stream(args).map(String::valueOf).toList());
        params.put("details", null);
        this.rpc.notify("notification", params);
    }

    /**
     * Tells the user something in words that are already in their language: a message of Enigma, mirroring its
     * notification manager.
     * @param type one of {@code info}, {@code warning} and {@code error}
     */
    public void notifyUser(String type, String text, @Nullable String details) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("type", type);
        params.put("text", text);
        params.put("details", details == null || details.isEmpty() ? null : details);
        this.rpc.notify("notification", params);
    }

    public boolean isEditable(String type) {
        return this.editable.contains(type);
    }

    public Map<String, Object> state() {
        Map<String, Object> state = new LinkedHashMap<>();
        EnigmaProject project = this.project;
        state.put("jarPath", project == null ? null : project.getJarPath().toString());
        state.put("jarChecksum", project == null ? null : HexFormat.of().formatHex(project.getJarChecksum()));
        state.put("mappingsPath", this.mappingsPath == null ? null : this.mappingsPath.toString());
        state.put("mappingsFormat", this.mappingsService == null ? null : this.mappingsService.getId());
        state.put("dirty", project != null && project.getRemapper().isDirty());
        state.put("decompiler", this.decompiler.getId());
        state.put("revision", this.revision);
        // TODO: edits and collab state
        state.put("editable", new ArrayList<>(this.editable));
        return state;
    }

    public void notifyState() {
        this.rpc.notify("stateChanged", this.state());
    }

    /**
     * Announces that mappings changed.
     * @param classes the top-level classes whose names changed, or {@code null} if everything has to be reloaded
     */
    public void notifyMappingsChanged(@Nullable Collection<Map<String, Object>> classes) {
        this.revision++;
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("revision", this.revision);
        params.put("full", classes == null);
        params.put("classes", classes == null ? List.of() : classes);
        this.rpc.notify("mappingsChanged", params);
        this.notifyState();
    }

    private Object initialize(JsonObject params) throws IOException {
        this.configure(params);

        Path profilePath = Params.optPath(params, "profile");
        if (profilePath != null && !Files.isRegularFile(profilePath)) {
            throw RpcException.said("profile-not-found", profilePath);
        }

        EnigmaProfile profile = EnigmaProfile.read(profilePath);
        this.enigma = Enigma.builder().setProfile(profile).build();

        String decompilerId = Params.optString(params, "decompiler");
        if (decompilerId != null) {
            this.decompiler = this.findDecompiler(decompilerId);
        }

        return this.describeEnvironment();
    }

    /**
     * Applies settings that can change while the backend is running.
     */
    private Object configure(JsonObject params) {
        String language = Params.optString(params, "language");
        if (language != null && I18n.getAvailableLanguages().contains(language)) {
            I18n.setLanguage(language);
        }

        if (Params.has(params, "editable")) {
            this.editable.clear();
            for (String type : Params.strings(params, "editable")) {
                if (EDITABLE_TYPES.contains(type)) {
                    this.editable.add(type);
                }
            }
        }

        if (Params.has(params, "autoSave")) {
            this.autoSave = params.get("autoSave").getAsBoolean();
        }

        boolean vineflowerChanged = false;
        if (Params.has(params, "vineflower") && params.get("vineflower").isJsonObject()) {
            Map<String, Object> options = new LinkedHashMap<>();
            for (Map.Entry<String, JsonElement> option : params.getAsJsonObject("vineflower").entrySet()) {
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

        // TODO: invalidate sources if vineflower was changed

        if (this.project != null) {
            this.notifyState();
        }

        return null;
    }

    private Map<String, Object> describeEnvironment() {
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("enigmaVersion", Enigma.VERSION);
        info.put("vineflowerVersion", Enigma.VINEFLOWER_VERSION);
        info.put("cfrVersion", Enigma.CFR_VERSION);
        info.put("procyonVersion", Enigma.PROCYON_VERSION);
        info.put("javaVersion", Runtime.version().toString());

        List<Map<String, Object>> decompilers = new ArrayList<>();
        for (DecompilerService service : this.enigma.getServices().get(DecompilerService.TYPE)) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", service.getId());
            entry.put("name", translateOr(service.getId(), service.getId()));
            decompilers.add(entry);
        }

        info.put("decompilers", decompilers);

        List<Map<String, Object>> formats = new ArrayList<>();
        for (ReadWriteService service : this.enigma.getReadWriteServices()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", service.getId());
            entry.put("name", translateOr(service.getId(), service.getId()));
            entry.put("extensions", service.getFileType().getExtensions());
            entry.put("directory", service.getFileType().isDirectory());
            entry.put("read", service.supportsReading());
            entry.put("write", service.supportsWriting());
            formats.add(entry);
        }

        info.put("formats", formats);

        List<Map<String, Object>> preferences = new ArrayList<>();
        for (VineflowerPreferences.Preference preference : VineflowerPreferences.getPreferences()) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("key", preference.key());
            entry.put("type", preference.type().name().toLowerCase(Locale.ROOT));
            entry.put("name", preference.name());
            entry.put("description", preference.description());
            entry.put("default", String.valueOf(VineflowerPreferences.DEFAULTS.get(preference.key())));
            preferences.add(entry);
        }

        info.put("vineflowerPreferences", preferences);
        info.put("languages", I18n.getAvailableLanguages());
        info.put("state", this.state());
        return info;
    }

    public static String translateOr(String key, String fallback) {
        String translated = I18n.translateOrNull(key);
        return translated == null ? fallback : translated;
    }

    private DecompilerService findDecompiler(String id) {
        return this.enigma.getService(DecompilerService.TYPE, id)
                .orElseThrow(() -> RpcException.said("unknown-decompiler", id));
    }

    private Object setDecompiler(JsonObject params) {
        this.decompiler = this.findDecompiler(Params.string(params, "id"));
        // TODO: update decompiler
        this.notifyState();
        return this.state();
    }

    private Object openJar(JsonObject params) throws Exception {
        Path jar = Params.path(params, "jar").toAbsolutePath();
        if (!Files.isRegularFile(jar)) {
            throw RpcException.said("jar-not-found", jar);
        }

        List<String> libraries = Params.strings(params, "libraries");

        this.closeJar();

        List<ClassProvider> libraryProviders = new ArrayList<>();
        libraryProviders.add(new ClasspathClassProvider());
        for (String library : libraries) {
            Path libraryPath = Path.of(library);
            if (!Files.isRegularFile(libraryPath)) {
                throw RpcException.said("library-not-found", libraryPath);
            }

            libraryProviders.add(new JarClassProvider(libraryPath));
        }

        ClassProvider libraryProvider = libraryProviders.size() == 1
                ? libraryProviders.get(0)
                : new CombiningClassProvider(libraryProviders.toArray(ClassProvider[]::new));

        RpcProgress progress = this.progress("opening-jar", jar.getFileName());
        try {
            EnigmaProject project = this.enigma.openJar(jar, libraryProvider, progress);
            this.project = project;
            this.indexTreeBuilder = new IndexTreeBuilder(project.getJarIndex());
            this.statsGenerator = new StatsGenerator(project);
            this.mappingsPath = null;
            this.mappingsService = null;

            // TODO: call on project open and reset edits
        } finally {
            progress.end();
        }

        this.rpc.notify("projectChanged", this.state());
        this.notifyMappingsChanged(null);
        this.notifyUser("info", I18n.translateFormatted("validation.message.opened_jar", jar.getFileName().toString()), null);
        return this.state();
    }

    public void closeJar() {
        if (this.project == null) {
            return;
        }

        // TODO: disconnect collab, call on project close and reset edits
        this.project = null;
        this.indexTreeBuilder = null;
        this.statsGenerator = null;
        this.mappingsPath = null;
        this.mappingsService = null;
        this.revision++;
        this.rpc.notify("projectChanged", this.state());
    }

    private Object reloadAll(JsonObject params) throws Exception {
        EnigmaProject project = this.requireProject();
        Path jar = project.getJarPath();
        Path mappings = this.mappingsPath;
        ReadWriteService service = this.mappingsService;

        JsonObject openParams = new JsonObject();
        openParams.addProperty("jar", jar.toString());
        if (params.has("libraries")) {
            openParams.add("libraries", params.get("libraries"));
        }

        this.openJar(openParams);
        if (mappings != null && service != null) {
            // TODO: load mappings
        }

        return this.state();
    }

}
