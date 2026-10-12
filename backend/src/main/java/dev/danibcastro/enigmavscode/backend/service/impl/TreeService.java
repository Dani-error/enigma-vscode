package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryInfo;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryParams;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.entry.SymbolKind;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.tree.*;
import dev.danibcastro.enigmavscode.backend.rpc.EntryCodec;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.service.Service;
import lombok.AllArgsConstructor;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.analysis.EntryReference;
import org.quiltmc.enigma.api.analysis.index.jar.EntryIndex;
import org.quiltmc.enigma.api.analysis.index.jar.InheritanceIndex;
import org.quiltmc.enigma.api.analysis.index.jar.ReferenceIndex;
import org.quiltmc.enigma.api.analysis.tree.*;
import org.quiltmc.enigma.api.source.TokenType;
import org.quiltmc.enigma.api.translation.Translator;
import org.quiltmc.enigma.api.translation.representation.entry.*;
import org.quiltmc.enigma.impl.analysis.IndexTreeBuilder;

import javax.swing.tree.DefaultMutableTreeNode;
import javax.swing.tree.TreeNode;
import java.util.*;
import java.util.function.Function;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 17:53
 * Created by: Dani-error
 */
@AllArgsConstructor
public final class TreeService implements Service {

    private final Session session;
    private final EntryService entries;

    @Override
    public void register() {
        JsonRpcConnection rpc = this.session.rpc();
        rpc.register("structure", StructureParams.class, this::structure);
        rpc.register("hierarchy/inheritance", EntryParams.class, params -> this.hierarchy(params, false));
        rpc.register("hierarchy/implementations", EntryParams.class, params -> this.hierarchy(params, true));
        rpc.register("hierarchy/supertypes", ClassNameParams.class, this::supertypes);
        rpc.register("hierarchy/subtypes", ClassNameParams.class, this::subtypes);
        rpc.register("calls", CallsParams.class, this::calls);
        rpc.register("calls/incoming", EntryParams.class, this::incomingCalls);
        rpc.register("calls/outgoing", EntryParams.class, this::outgoingCalls);
    }

    private TreeItem structure(StructureParams params) {
        EnigmaProject project = this.session.requireProject();
        ClassEntry entry = new ClassEntry(params.className());
        if (!project.getJarIndex().getIndex(EntryIndex.class).hasClass(entry)) {
            throw RpcException.said(Problem.CLASS_NOT_FOUND, entry.getFullName());
        }

        StructureTreeOptions options = new StructureTreeOptions(
                Objects.requireNonNullElse(params.obfuscation(), StructureTreeOptions.ObfuscationVisibility.ALL),
                Objects.requireNonNullElse(params.documentation(), StructureTreeOptions.DocumentationVisibility.ALL),
                Objects.requireNonNullElse(params.sorting(), StructureTreeOptions.SortingOrder.DEFAULT),
                Objects.requireNonNullElse(params.search(), "")
        );

        // same as GuiController#getClassStructure
        StructureTreeNode rootNode = new StructureTreeNode(project, entry, entry);
        rootNode.load(project, options);
        return this.structureNode(rootNode);
    }

    private TreeItem structureNode(StructureTreeNode node) {
        EnigmaProject project = this.session.requireProject();
        ParentedEntry<?> entry = node.getEntry();
        // StructureTreeNode#toHtml computes the modifiers shown in the structure docker: "<i>modifiers</i> label"
        String html = node.toHtml();
        int end = html.indexOf("</i>");
        return new TreeItem(node.toString(), html.startsWith("<i>") && end > 3 ? html.substring(3, end) : "", EntryCodec.toRef(entry),
                this.entries.symbolKind(entry), project.getRemapper().extendedDeobfuscate(entry).getType(),
                null, null, null, null, this.children(node, child -> this.structureNode((StructureTreeNode) child)));
    }

    private List<TreeItem> children(TreeNode node, Function<TreeNode, TreeItem> mapper) {
        List<TreeItem> children = new ArrayList<>(node.getChildCount());
        for (int i = 0; i < node.getChildCount(); i++) {
            children.add(mapper.apply(node.getChildAt(i)));
        }

        return children;
    }

    private TreeItem.Root hierarchy(EntryParams params, boolean implementations) {
        EnigmaProject project = this.session.requireProject();
        Entry<?> entry = EntryCodec.fromRef(params.entry());
        Translator translator = project.getRemapper().getDeobfuscator();
        IndexTreeBuilder builder = this.session.requireIndexTreeBuilder();

        DefaultMutableTreeNode node = null;
        if (entry instanceof ClassEntry classEntry) {
            if (implementations) {
                node = builder.buildClassImplementations(translator, classEntry);
            } else {
                ClassInheritanceTreeNode rootNode = builder.buildClassInheritance(translator, classEntry);
                node = ClassInheritanceTreeNode.findNode(rootNode, classEntry);
            }
        } else if (entry instanceof MethodEntry methodEntry) {
            if (implementations) {
                List<MethodImplementationsTreeNode> rootNodes = builder.buildMethodImplementations(translator, methodEntry);
                if (!rootNodes.isEmpty()) {
                    // like upstream, only the first interface is shown if the method implements several
                    node = MethodImplementationsTreeNode.findNode(rootNodes.get(0), methodEntry);
                }
            } else {
                MethodInheritanceTreeNode rootNode = builder.buildMethodInheritance(translator, methodEntry);
                node = MethodInheritanceTreeNode.findNode(rootNode, methodEntry);
            }
        }

        if (node == null) {
            return new TreeItem.Root(null);
        }

        // show the tree at the root, like AbstractInheritanceTreeDocker; a tree with only a root has nothing to show
        TreeNode root = node.getRoot();
        if (root.getChildCount() == 0) {
            return new TreeItem.Root(null);
        }

        return new TreeItem.Root(this.hierarchyNode(root, node));
    }

    private TreeItem hierarchyNode(TreeNode node, TreeNode selected) {
        EnigmaProject project = this.session.requireProject();
        EntryRef entry = null;
        SymbolKind kind = null;
        TokenType tokenType = null;
        Boolean navigable = null;
        Boolean implemented = null;
        if (node instanceof AbstractClassTreeNode classNode) {
            entry = EntryCodec.toRef(classNode.getClassEntry());
            kind = this.entries.symbolKind(classNode.getClassEntry());
            tokenType = project.getRemapper().extendedDeobfuscate(classNode.getClassEntry()).getType();
            navigable = project.isNavigable(classNode.getClassEntry());
        } else if (node instanceof AbstractMethodTreeNode methodNode) {
            entry = EntryCodec.toRef(methodNode.getMethodEntry());
            kind = SymbolKind.METHOD;
            tokenType = project.getRemapper().extendedDeobfuscate(methodNode.getMethodEntry()).getType();
            navigable = project.isNavigable(methodNode.getMethodEntry());
            if (node instanceof MethodInheritanceTreeNode inheritanceNode) {
                implemented = inheritanceNode.isImplemented();
            }
        }

        return new TreeItem(node.toString(), null, entry, kind, tokenType, node == selected, navigable, implemented, null, this.children(node, child -> this.hierarchyNode(child, selected)));
    }

    private EntryInfo classItem(ClassEntry entry) {
        return this.entries.describe(entry).shownIn(entry.getOutermostClass().getFullName());
    }

    /** Direct supertypes of a class, for the editor's type hierarchy. */
    private List<EntryInfo> supertypes(ClassNameParams params) {
        EnigmaProject project = this.session.requireProject();
        ClassEntry entry = new ClassEntry(params.className());
        InheritanceIndex inheritance = project.getJarIndex().getIndex(InheritanceIndex.class);
        return inheritance.getParents(entry).stream().sorted().map(this::classItem).toList();
    }

    /** Direct subtypes of a class, for the editor's type hierarchy. */
    private List<EntryInfo> subtypes(ClassNameParams params) {
        EnigmaProject project = this.session.requireProject();
        ClassEntry entry = new ClassEntry(params.className());
        InheritanceIndex inheritance = project.getJarIndex().getIndex(InheritanceIndex.class);
        return inheritance.getChildren(entry).stream().sorted().map(this::classItem).toList();
    }

    /**
     * The reference tree of the calls docker, built exactly like {@code GuiController#get*References}.
     */
    private TreeItem.Root calls(CallsParams params) {
        EnigmaProject project = this.session.requireProject();
        Entry<?> entry = EntryCodec.fromRef(params.entry());
        boolean recursive = Objects.requireNonNullElse(params.recursive(), true);
        Translator translator = project.getRemapper().getDeobfuscator();

        DefaultMutableTreeNode node = null;
        if (entry instanceof ClassEntry classEntry) {
            ClassReferenceTreeNode rootNode = new ClassReferenceTreeNode(translator, classEntry);
            rootNode.load(project.getJarIndex(), true);
            node = rootNode;
        } else if (entry instanceof FieldEntry fieldEntry) {
            FieldReferenceTreeNode rootNode = new FieldReferenceTreeNode(translator, fieldEntry);
            rootNode.load(project.getJarIndex(), true);
            node = rootNode;
        } else if (entry instanceof MethodEntry methodEntry) {
            MethodReferenceTreeNode rootNode = new MethodReferenceTreeNode(translator, methodEntry);
            rootNode.load(project.getJarIndex(), true, recursive);
            node = rootNode;
        }

        return new TreeItem.Root(node == null ? null : this.referenceNode(node));
    }

    private TreeItem referenceNode(TreeNode node) {
        EnigmaProject project = this.session.requireProject();
        EntryRef entryRef = null;
        SymbolKind kind = null;
        TokenType tokenType = null;
        EntryRef context = null;
        if (node instanceof ReferenceTreeNode<?, ?> referenceNode) {
            Entry<?> entry = referenceNode.getEntry();
            EntryReference<?, ?> reference = referenceNode.getReference();
            Entry<?> shown = reference == null ? entry : reference.context;
            entryRef = EntryCodec.toRef(entry);
            kind = this.entries.symbolKind(shown);
            context = reference == null ? null : EntryCodec.toRef(reference.context);
            tokenType = project.getRemapper().extendedDeobfuscate(shown).getType();
        }

        return new TreeItem(node.toString(), null, entryRef, kind, tokenType, null, null, null, context, this.children(node, this::referenceNode));
    }

    private CallItem callItem(MethodEntry method, List<CallItem.Site> sites) {
        return new CallItem(this.entries.describe(method).shownIn(method.getParent().getOutermostClass().getFullName()), sites);
    }

    /** One level of callers of a method, for the editor's call hierarchy. */
    private List<CallItem> incomingCalls(EntryParams params) {
        EnigmaProject project = this.session.requireProject();
        Entry<?> entry = EntryCodec.fromRef(params.entry());
        if (!(entry instanceof MethodEntry method)) {
            return List.of();
        }

        ReferenceIndex referenceIndex = project.getJarIndex().getIndex(ReferenceIndex.class);
        EntryIndex entryIndex = project.getJarIndex().getIndex(EntryIndex.class);
        Collection<MethodEntry> targets = !method.isConstructor() && entryIndex.hasMethod(method)
                ? project.getJarIndex().getEntryResolver().resolveEquivalentMethods(method)
                : List.of(method);

        Map<MethodEntry, List<CallItem.Site>> callers = new LinkedHashMap<>();
        for (MethodEntry target : targets) {
            for (EntryReference<MethodEntry, MethodDefEntry> reference : referenceIndex.getReferencesToMethod(target)) {
                callers.computeIfAbsent(reference.context, k -> new ArrayList<>()).add(new CallItem.Site(EntryCodec.toRef(reference.entry), EntryCodec.toRef(reference.context)));
            }
        }

        List<CallItem> items = new ArrayList<>();
        callers.forEach((caller, sites) -> items.add(this.callItem(caller, sites)));
        return items;
    }

    /** One level of methods called by a method, for the editor's call hierarchy. */
    private List<CallItem> outgoingCalls(EntryParams params) {
        EnigmaProject project = this.session.requireProject();
        Entry<?> entry = EntryCodec.fromRef(params.entry());
        if (!(entry instanceof MethodEntry method)) {
            return List.of();
        }

        ReferenceIndex referenceIndex = project.getJarIndex().getIndex(ReferenceIndex.class);
        List<CallItem> items = new ArrayList<>();
        for (MethodEntry callee : referenceIndex.getMethodsReferencedBy(method)) {
            items.add(this.callItem(callee, List.of(new CallItem.Site(EntryCodec.toRef(callee), EntryCodec.toRef(method)))));
        }

        return items;
    }
}
