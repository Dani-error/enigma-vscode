package dev.danibcastro.enigmavscode.backend.util;


import dev.danibcastro.enigmavscode.backend.protocol.edit.PackageMode;
import lombok.RequiredArgsConstructor;
import org.quiltmc.enigma.api.translation.mapping.EntryRemapper;
import org.quiltmc.enigma.api.translation.representation.entry.ClassEntry;

import java.util.*;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:35
 * Created by: Dani-error
 */
@RequiredArgsConstructor
public final class PackageRenamePlanner {

    private final PackageMode mode;

    public static boolean isValidPackageName(String input) {
        return input != null && input.matches("[a-zA-Z0-9_/]+") && !input.isBlank() && !input.startsWith("/") && !input.endsWith("/");
    }

    private abstract static class Node {
        Container parent;
    }

    private static class Container extends Node {
        final List<Node> children = new ArrayList<>();
    }

    @RequiredArgsConstructor
    private static final class PackageNode extends Container {

        final String packageName;

    }

    @RequiredArgsConstructor
    private static final class ClassNode extends Node {

        final ClassEntry obf;
        final ClassEntry deobf;

    }

    /**
     * @return the new deobfuscated name of every class that has to be renamed, keyed by obfuscated class
     */
    public Map<ClassEntry, String> plan(Collection<ClassEntry> classes, EntryRemapper remapper, String path, String input) {
        // the same structure as Enigma's NestedPackages: one node per package, nested by name
        Container root = new Container();
        Map<String, PackageNode> packages = new HashMap<>();
        for (ClassEntry obf : classes) {
            ClassEntry deobf = remapper.deobfuscate(obf);
            ClassNode node = new ClassNode(obf, deobf);
            Container parent = getPackage(root, packages, deobf.getPackageName());
            node.parent = parent;
            parent.children.add(node);
        }

        // Enigma's class tree keeps packages before classes and sorts packages by name; visit nodes in the same order
        sort(root);

        String[] oldPackageNames = path.split("/");
        String[] newPackageNames = input.split("/");

        Map<String, ClassNode> oldNameToNode = new LinkedHashMap<>();
        Map<String, String> renameStack = new LinkedHashMap<>();
        for (Node node : new ArrayList<>(root.children)) {
            this.handleNode(0, false, oldPackageNames, newPackageNames, renameStack, oldNameToNode, node);
        }

        Map<ClassEntry, String> result = new LinkedHashMap<>();
        renameStack.forEach((oldName, newName) -> {
            if (!oldName.equals(newName)) {
                result.put(oldNameToNode.get(oldName).obf, newName);
            }
        });
        return result;
    }

    private static void sort(Container container) {
        container.children.sort((a, b) -> {
            if (a instanceof PackageNode pA) {
                return b instanceof PackageNode pB ? pA.packageName.compareTo(pB.packageName) : -1;
            } else if (b instanceof PackageNode) {
                return 1;
            }

            return ((ClassNode) a).deobf.compareTo(((ClassNode) b).deobf);
        });

        for (Node child : container.children) {
            if (child instanceof Container childContainer) {
                sort(childContainer);
            }
        }
    }

    private static Container getPackage(Container root, Map<String, PackageNode> packages, String packageName) {
        if (packageName == null) {
            return root;
        }

        PackageNode node = packages.get(packageName);
        if (node == null) {
            node = new PackageNode(packageName);
            Container parent = getPackage(root, packages, ClassEntry.getParentPackage(packageName));
            node.parent = parent;
            parent.children.add(node);
            packages.put(packageName, node);
        }

        return node;
    }

    private void handleNode(int divergenceIndex, boolean rename, String[] oldPackageNames, String[] newPackageNames, Map<String, String> renameStack, Map<String, ClassNode> oldNameToNode, Node node) {
        if (node instanceof ClassNode classNode && rename) {
            String oldName = classNode.deobf.getFullName();
            int finalPackageIndex = divergenceIndex == 0 ? 0 : divergenceIndex - 1;

            // skips all classes that do not match the exact package being renamed
            if (this.mode == PackageMode.MOVE) {
                if (!oldName.equals(String.join("/", oldPackageNames) + "/" + classNode.deobf.getSimpleName())) {
                    return;
                }
            }

            oldNameToNode.put(oldName, classNode);
            renameStack.put(oldName, newName(oldName, classNode.deobf.getSimpleName(), finalPackageIndex, oldPackageNames, newPackageNames));
        } else if (node instanceof PackageNode packageNode) {
            String packageName = packageNode.packageName.substring(packageNode.packageName.lastIndexOf("/") + 1);
            int index = packageNode.packageName.split("/").length - 1;

            if (rename) {
                this.handlePackage(divergenceIndex, true, oldPackageNames, newPackageNames, renameStack, oldNameToNode, packageNode);
                return;
            }

            // handle backwards renaming
            if (oldPackageNames.length > newPackageNames.length) {
                // if we are past the final index in the new packages, begin rename from previous
                if (newPackageNames.length <= index) {
                    this.handlePackage(index - 1, true, oldPackageNames, newPackageNames, renameStack, oldNameToNode, packageNode.parent);
                    return;
                }
            } else {
                // handle appending new packages
                if (newPackageNames.length > oldPackageNames.length && index == oldPackageNames.length - 1) {
                    this.handlePackage(index + 1, true, oldPackageNames, newPackageNames, renameStack, oldNameToNode, packageNode);
                    return;
                }
            }

            if (newPackageNames.length - 1 >= index && packageName.equals(newPackageNames[index])) {
                this.handlePackage(index, false, oldPackageNames, newPackageNames, renameStack, oldNameToNode, packageNode);
            } else if (oldPackageNames.length - 1 >= index && packageName.equals(oldPackageNames[index])) {
                this.handlePackage(index, true, oldPackageNames, newPackageNames, renameStack, oldNameToNode, packageNode);
            }
        }
    }

    private void handlePackage(int divergenceIndex, boolean rename, String[] oldPackageNames, String[] newPackageNames, Map<String, String> renameStack, Map<String, ClassNode> oldNameToNode, Container node) {
        if (!rename) {
            divergenceIndex++;
        }

        for (Node child : new ArrayList<>(node.children)) {
            this.handleNode(divergenceIndex, rename, oldPackageNames, newPackageNames, renameStack, oldNameToNode, child);
        }
    }

    private static String newName(String oldName, String simpleName, int finalPackageIndex, String[] oldPackageNames, String[] newPackageNames) {
        String[] split = oldName.split("/");
        StringBuilder newPackages = new StringBuilder();

        if (oldPackageNames.length <= newPackageNames.length) {
            for (int i = finalPackageIndex; i < newPackageNames.length; i++) {
                if (i >= 0) {
                    if (i < oldPackageNames.length && i < split.length && oldPackageNames[i].equals(split[i])) {
                        split[i] = newPackageNames[i];
                    } else {
                        newPackages.append("/").append(newPackageNames[i]);
                    }
                }
            }
        } else {
            for (int i = 0; i < oldPackageNames.length; i++) {
                if (i > newPackageNames.length - 1 || !oldPackageNames[i].equals(newPackageNames[i])) {
                    StringBuilder string = new StringBuilder();

                    // append preceding old package names
                    for (int j = 0; j <= i - 1; j++) {
                        appendSlash(string);
                        string.append(oldPackageNames[j]);
                    }

                    // append new package names
                    for (int j = i; j < newPackageNames.length; j++) {
                        appendSlash(string);
                        string.append(newPackageNames[j]);
                    }

                    // append the remaining old package names
                    for (int j = i - 1 + oldPackageNames.length; j < split.length - 1; j++) {
                        appendSlash(string);
                        string.append(split[j]);
                    }

                    appendSlash(string);
                    string.append(simpleName);
                    split = string.toString().split("/");
                    break;
                }
            }
        }

        // append new packages to last package
        if (!newPackages.toString().isBlank()) {
            split[finalPackageIndex] = split[finalPackageIndex] + newPackages;
        }

        return String.join("/", split);
    }

    private static void appendSlash(StringBuilder string) {
        if (!string.isEmpty()) {
            string.append("/");
        }
    }

}
