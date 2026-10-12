package dev.danibcastro.enigmavscode.backend.protocol.project;


import com.google.gson.JsonElement;
import org.jspecify.annotations.Nullable;

import java.util.List;
import java.util.Map;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:03
 * Created by: Dani-error
 */
/**
 * {@code initialize} and {@code configure}: the settings of the user. Only what is sent is changed.
 *
 * @param editable what may be edited
 * @param vineflower options of that decompiler, by key
 * @param profile the file of an Enigma profile; only read when the engine starts
 */
public record ConfigureParams(
        @Nullable String language,
        @Nullable List<String> editable,
        @Nullable Boolean autoSave,
        @Nullable Map<String, JsonElement> vineflower,
        @Nullable String profile,
        @Nullable String decompiler
) { }