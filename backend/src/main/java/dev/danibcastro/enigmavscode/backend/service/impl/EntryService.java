package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.entry.ClassItem;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryInfo;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryParams;
import dev.danibcastro.enigmavscode.backend.protocol.entry.SymbolKind;
import dev.danibcastro.enigmavscode.backend.protocol.project.Editable;
import dev.danibcastro.enigmavscode.backend.rpc.EntryCodec;
import dev.danibcastro.enigmavscode.backend.service.Service;
import dev.danibcastro.enigmavscode.backend.util.ThrowableTypes;
import lombok.AllArgsConstructor;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.analysis.index.jar.EntryIndex;
import org.quiltmc.enigma.api.service.ObfuscationTestService;
import org.quiltmc.enigma.api.source.TokenType;
import org.quiltmc.enigma.api.translation.TranslateResult;
import org.quiltmc.enigma.api.translation.Translator;
import org.quiltmc.enigma.api.translation.mapping.EntryMapping;
import org.quiltmc.enigma.api.translation.mapping.EntryRemapper;
import org.quiltmc.enigma.api.translation.representation.AccessFlags;
import org.quiltmc.enigma.api.translation.representation.MethodDescriptor;
import org.quiltmc.enigma.api.translation.representation.TypeDescriptor;
import org.quiltmc.enigma.api.translation.representation.entry.*;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.stream.Collectors;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:25
 * Created by: Dani-error
 */
@AllArgsConstructor
public final class EntryService implements Service {

    private final Session session;

    @Override
    public void register() {
        this.session.rpc().register("classes/list", () -> this.classItems(this.topLevelClasses()));
        this.session.rpc().register("entry/info", EntryParams.class, params -> this.describe(EntryCodec.fromRef(params.entry())));
    }

    List<ClassEntry> topLevelClasses() {
        EnigmaProject project = this.session.requireProject();
        return project.getJarIndex().getIndex(EntryIndex.class).getClasses().stream()
                .filter(entry -> !entry.isInnerClass())
                .sorted()
                .toList();
    }

    /**
     * Describes top-level classes for the class trees, splitting them like {@code GuiController#addSeparatedClasses}.
     */
    List<ClassItem> classItems(Collection<ClassEntry> classes) {
        EnigmaProject project = this.session.requireProject();
        EntryRemapper mapper = project.getRemapper();
        List<ObfuscationTestService> obfServices = project.getEnigma().getServices().get(ObfuscationTestService.TYPE);
        EntryIndex entries = project.getJarIndex().getIndex(EntryIndex.class);

        List<ClassItem> items = new ArrayList<>(classes.size());
        for (ClassEntry entry : classes) {
            TranslateResult<ClassEntry> result = mapper.extendedDeobfuscate(entry);
            ClassEntry deobfEntry = result.getValue();

            boolean obfuscated = result.isObfuscated() && deobfEntry.equals(entry);
            if (obfuscated && !obfServices.isEmpty() && obfServices.stream().anyMatch(service -> service.testDeobfuscated(entry))) {
                obfuscated = false;
            }

            // what the lists of classes tell apart beyond the kind, like any Java tool does
            ClassDefEntry definition = entries.getDefinition(entry);
            items.add(new ClassItem(entry.getFullName(), deobfEntry.getFullName(), obfuscated, result.getType(), this.symbolKind(entry),
                    definition != null && definition.getAccess().isAbstract() && !definition.getAccess().isInterface(), ThrowableTypes.isThrowable(entry, entries)));
        }

        return items;
    }

    SymbolKind symbolKind(Entry<?> entry) {
        EnigmaProject project = this.session.requireProject();
        if (entry instanceof ClassEntry classEntry) {
            ClassDefEntry definition = project.getJarIndex().getIndex(EntryIndex.class).getDefinition(classEntry);
            if (definition != null) {
                AccessFlags access = definition.getAccess();
                if (access.isAnnotation()) {
                    return SymbolKind.ANNOTATION;
                } else if (access.isInterface()) {
                    return SymbolKind.INTERFACE;
                } else if (definition.isEnum()) {
                    return SymbolKind.ENUM;
                } else if (definition.isRecord()) {
                    return SymbolKind.RECORD;
                }
            }

            return SymbolKind.CLASS;
        } else if (entry instanceof FieldEntry field) {
            AccessFlags access = project.getJarIndex().getIndex(EntryIndex.class).getFieldAccess(field);
            return access != null && access.isEnum() ? SymbolKind.ENUM_CONSTANT : SymbolKind.FIELD;
        }

        return EntryCodec.kindOf(entry);
    }

    @Nullable
    String symbolDetail(Entry<?> entry) {
        EnigmaProject project = this.session.requireProject();
        Translator translator = project.getRemapper().getDeobfuscator();
        if (entry instanceof FieldEntry field) {
            return readableType(translator.translate(field.getDesc()));
        } else if (entry instanceof MethodEntry method) {
            return readableSignature(translator.translate(method.getDesc()), method.isConstructor());
        }

        return null;
    }

    static String readableType(TypeDescriptor desc) {
        if (desc.isVoid()) {
            return "void";
        } else if (desc.isPrimitive()) {
            return desc.getPrimitive().getKeyword();
        } else if (desc.isType()) {
            return desc.getTypeEntry().getSimpleName().replace('$', '.');
        } else if (desc.isArray()) {
            return readableType(desc.getArrayType()) + "[]".repeat(desc.getArrayDimension());
        }

        return desc.toString();
    }

    static String readableSignature(MethodDescriptor desc, boolean constructor) {
        String args = desc.getTypeDescs().stream().map(EntryService::readableType).collect(Collectors.joining(", ", "(", ")"));
        return constructor ? args : args + ": " + readableType(desc.getReturnDesc());
    }

    private static List<String> modifiers(@Nullable AccessFlags access) {
        List<String> modifiers = new ArrayList<>();
        if (access == null) {
            return modifiers;
        }

        if (access.isPublic()) {
            modifiers.add("public");
        } else if (access.isProtected()) {
            modifiers.add("protected");
        } else if (access.isPrivate()) {
            modifiers.add("private");
        }

        if (access.isStatic()) {
            modifiers.add("static");
        }

        if (access.isAbstract() && !access.isInterface()) {
            modifiers.add("abstract");
        }

        if (access.isFinal()) {
            modifiers.add("final");
        }

        if (access.isSynthetic()) {
            modifiers.add("synthetic");
        }

        return modifiers;
    }

    /**
     * Everything the identifier panel and the entry tooltip of the Swing interface show about an entry.
     */
    EntryInfo describe(Entry<?> entry) {
        EnigmaProject project = this.session.requireProject();
        EntryRemapper remapper = project.getRemapper();
        EntryIndex entryIndex = project.getJarIndex().getIndex(EntryIndex.class);

        TranslateResult<Entry<?>> result = remapper.extendedDeobfuscate(entry);
        Entry<?> deobf = result == null ? entry : result.getValue();
        EntryMapping mapping = result == null ? EntryMapping.OBFUSCATED : result.getMapping();

        // what renaming and documenting this entry means, for interfaces that act on an entry rather than on a token
        Entry<?> nameable = entry instanceof MethodEntry constructor && constructor.isConstructor() ? constructor.getContainingClass() : entry;
        boolean renamable = project.isRenamable(nameable);
        AccessFlags access = entryIndex.hasEntry(entry) ? entryIndex.getEntryAccess(entry) : null;

        EntryInfo.TypeDetails type = null;
        EntryInfo.Declaration declaration = null;
        if (entry instanceof ClassEntry classEntry) {
            String outerClass = classEntry.getOuterClass() == null ? null : remapper.deobfuscate(classEntry.getOuterClass()).getFullName();
            ClassDefEntry definition = entryIndex.getDefinition(classEntry);
            if (definition == null) {
                // a class of a library: all that is known of it is its name
                type = new EntryInfo.TypeDetails(outerClass, null, null);
            } else {
                String superClass = definition.getSuperClass() == null ? null : remapper.deobfuscate(definition.getSuperClass()).getFullName();
                List<String> interfaces = Arrays.stream(definition.getInterfaces()).map(itf -> remapper.deobfuscate(itf).getFullName()).toList();
                type = new EntryInfo.TypeDetails(outerClass, superClass, interfaces);
            }
        } else if (entry instanceof FieldEntry field) {
            declaration = new EntryInfo.Declaration(remapper.deobfuscate(field.getParent()).getFullName(), EntryCodec.toRef(field.getParent()),
                    field.getDesc().toString(), readableType(remapper.deobfuscate(field.getDesc())), null, null);
        } else if (entry instanceof MethodEntry method) {
            declaration = new EntryInfo.Declaration(remapper.deobfuscate(method.getParent()).getFullName(), EntryCodec.toRef(method.getParent()),
                    method.getDesc().toString(), readableSignature(remapper.deobfuscate(method.getDesc()), method.isConstructor()), null, null);
        } else if (entry instanceof LocalVariableEntry local) {
            // the entry index only contains obfuscated entries, so use the obfuscated entry to look up the local's descriptor
            LocalVariableDefEntry definition = entryIndex.getDefinition(local);
            declaration = new EntryInfo.Declaration(remapper.deobfuscate(local.getContainingClass()).getFullName(), null, null,
                    definition == null ? null : readableType(remapper.deobfuscate(definition.getDesc())),
                    remapper.deobfuscate(local.getParent()).getName(), local.getIndex());
        }

        String simpleName = entry instanceof MethodEntry constructor && constructor.isConstructor()
                ? remapper.deobfuscate(constructor.getParent()).getSimpleName()
                : deobf.getSimpleName();
        return new EntryInfo(
                EntryCodec.toRef(entry), this.symbolKind(entry),
                new EntryInfo.Names(entry.getName(), deobf.getName(), simpleName, deobf.getFullName()),
                new EntryInfo.Mapping(mapping.tokenType(), mapping.sourcePluginId(), remapper.getMapping(entry).javadoc(), mapping.tokenType() == TokenType.OBFUSCATED),
                entryIndex.hasEntry(entry), project.isNavigable(entry), project.isRenamable(entry),
                new EntryInfo.Renaming(renamable && this.session.isEditable(SourceService.editableType(entry)), renamable && this.session.isEditable(Editable.JAVADOC),
                        EntryCodec.toRef(nameable), this.editableName(nameable, nameable.getName())),
                entry.getTopLevelClass().getFullName(), modifiers(access), type, declaration);
    }

    /**
     * The name the user edits when renaming, following {@code IdentifierPanel}:
     * top-level classes are edited with their package, everything else by simple name.
     */
    String editableName(Entry<?> obfEntry, @Nullable String fallback) {
        EnigmaProject project = this.session.requireProject();
        Entry<?> deobf = project.getRemapper().deobfuscate(obfEntry);
        String name;
        if (deobf instanceof ClassEntry classEntry) {
            name = classEntry.isInnerClass() ? classEntry.getName() : classEntry.getFullName();
        } else {
            name = deobf.getName();
        }

        return (name == null || name.isBlank()) && fallback != null ? fallback : name;
    }

}
