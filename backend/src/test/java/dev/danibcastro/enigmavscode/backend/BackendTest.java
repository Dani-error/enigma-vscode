package dev.danibcastro.enigmavscode.backend;


import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarFile;
import java.util.stream.Stream;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertThrows;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:41
 * Created by: Dani-error
 *
 * E2E Backend tests
 */
@Timeout(300)
class BackendTest {

    private static final JsonObject DO_BASE_THINGS = TestClient.method("a", "a", "()V");
    private static final JsonObject GET_NAME = TestClient.method("a", "a", "()Ljava/lang/String;");
    private static final JsonObject NAME_FIELD = TestClient.field("a", "a", "Ljava/lang/String;");

    private static Map<String, JsonObject> classes(TestClient client) {
        Map<String, JsonObject> classes = new HashMap<>();
        for (JsonElement element : client.callRaw("classes/list").getAsJsonArray()) {
            classes.put(element.getAsJsonObject().get("obf").getAsString(), element.getAsJsonObject());
        }

        return classes;
    }

    /** Renames, accepting warnings such as "this is the first class in that package". */
    private static JsonObject renameConfirmed(TestClient client, JsonObject entry, String newName) {
        return client.call("entry/rename", "entry", entry, "newName", newName, "confirmWarnings", true);
    }

    private static JsonObject findNode(JsonObject node, String label) {
        if (node.get("label").getAsString().equals(label)) {
            return node;
        }

        for (JsonElement child : node.getAsJsonArray("children")) {
            JsonObject found = findNode(child.getAsJsonObject(), label);
            if (found != null) {
                return found;
            }
        }

        return null;
    }

    private static boolean applied(JsonObject result) {
        return result.get("applied").getAsBoolean();
    }

    private static List<String> messageTypes(JsonObject result) {
        return Stream.of(result.getAsJsonArray("messages").asList().toArray(JsonElement[]::new))
                .map(e -> e.getAsJsonObject().get("type").getAsString())
                .toList();
    }

    @Test
    void opensJarListsClassesAndDecompiles() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");

            Map<String, JsonObject> classes = classes(client);
            assertThat(classes.keySet(), hasItems("a", "b", "c", "d", "e", "org/quiltmc/enigma/input/Keep"));
            // inner classes are shown inside their outer class, not in the class list
            assertThat(classes.keySet(), not(hasItem("b$a")));
            assertThat(classes.get("a").get("obfuscated").getAsBoolean(), is(true));
            // BaseClass and SubclassA are abstract, SubclassB is not; none of them can be thrown
            assertThat(classes.get("a").get("abstract").getAsBoolean(), is(true));
            assertThat(classes.get("c").get("abstract").getAsBoolean(), is(true));
            assertThat(classes.get("d").get("abstract").getAsBoolean(), is(false));
            assertThat(classes.get("a").get("throwable").getAsBoolean(), is(false));

            JsonObject source = client.call("class/source", "class", "a");
            assertThat(source.get("text").getAsString(), containsString("class a"));
            assertThat(source.get("error").isJsonNull(), is(true));
            assertThat(source.getAsJsonObject("tokens").getAsJsonArray("obfuscated").size(), greaterThan(3));

            JsonObject bytecode = client.call("class/source", "class", "a", "view", "bytecode");
            assertThat(bytecode.get("text").getAsString(), containsString("ALOAD"));

            JsonObject state = client.call("project/state");
            assertThat(state.get("dirty").getAsBoolean(), is(false));
            assertThat(state.get("jarPath").getAsString(), containsString("inheritance_tree.jar"));
        }
    }

    /**
     * Enigma loses a change of javadoc when the mappings change again before it has produced the source for it. An
     * assistant that documents and renames is that fast.
     */
    @Test
    void keepsUpWithChangesThatFollowEachOtherAtOnce() throws InterruptedException {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            JsonObject method = TestClient.method("d", "b", "()V");
            assertThat(client.call("class/source", "class", "d").get("text").getAsString(), not(containsString("Short-lived.")));

            for (int round = 0; round < 15; round++) {
                client.call("entry/setJavadoc", "entry", method, "javadoc", "Short-lived.");
                client.call("entry/rename", "entry", method, "newName", "first" + round, "confirmWarnings", true);
                client.call("entry/setJavadoc", "entry", method, "javadoc", "");
                client.call("entry/rename", "entry", method, "newName", "second" + round, "confirmWarnings", true);

                String text = "";
                for (int waited = 0; waited < 100; waited++) {
                    text = client.call("class/source", "class", "d").get("text").getAsString();
                    if (text.contains("void second" + round + "()") && !text.contains("Short-lived.")) {
                        break;
                    }

                    Thread.sleep(50);
                }

                assertThat("round " + round, text, containsString("void second" + round + "()"));
                assertThat("round " + round, text, not(containsString("Short-lived.")));
            }
        }
    }

    /** What a request needs is checked before it is handled, and what is missing is named. */
    @Test
    void refusesRequestsThatLackWhatTheyNeed() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");

            TestClient.RpcError noName = assertThrows(TestClient.RpcError.class, () -> client.call("entry/rename", "entry", GET_NAME));
            assertThat(noName.code, is(-32602));
            assertThat(noName.getMessage(), is("Missing parameter: newName"));

            TestClient.RpcError noEntry = assertThrows(TestClient.RpcError.class, () -> client.call("entry/rename", "newName", "x"));
            assertThat(noEntry.getMessage(), is("Missing parameter: entry"));

            // the class of a text is sent as "class", and that is what is asked for
            TestClient.RpcError noClass = assertThrows(TestClient.RpcError.class, () -> client.call("class/source"));
            assertThat(noClass.getMessage(), is("Missing parameter: class"));

            TestClient.RpcError noLine = assertThrows(TestClient.RpcError.class, () -> client.call("class/entryAt", "class", "a", "character", 3));
            assertThat(noLine.getMessage(), is("Missing parameter: line"));

            // an entry that does not say what it is, or lacks a part of its name
            JsonObject nameless = new JsonObject();
            nameless.addProperty("kind", "method");
            nameless.addProperty("owner", "a");
            TestClient.RpcError malformed = assertThrows(TestClient.RpcError.class, () -> client.call("entry/info", "entry", nameless));
            assertThat(malformed.code, is(-32602));
            assertThat(malformed.getMessage(), containsString("Entry is missing \"name\""));

            // the wrong kind of value
            TestClient.RpcError notANumber = assertThrows(TestClient.RpcError.class, () -> client.call("class/entryAt", "class", "a", "line", "first", "character", 3));
            assertThat(notANumber.code, is(-32602));

            // what may be left out is left out without complaint, and means what it always meant
            assertThat(client.call("class/source", "class", "a").get("view").getAsString(), is("source"));
            assertThat(client.call("calls", "entry", GET_NAME).has("root"), is(true));
            assertThat(client.call("project/state").get("dirty").getAsBoolean(), is(false));
        }
    }

    @Test
    void tellsWhenAPositionIsForATextThatWasReplaced() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");

            JsonObject before = client.call("class/source", "class", "a");
            long serial = before.get("serial").getAsLong();
            String[] lines = before.get("text").getAsString().split("\n", -1);
            int found = 0;
            while (!lines[found].contains("abstract void a()")) {
                found++;
            }

            int line = found;
            int character = lines[line].indexOf("a()");
            JsonObject token = client.call("class/entryAt", "class", "a", "serial", serial, "line", line, "character", character);
            assertThat(token.get("text").getAsString(), is("a"));

            // Giving the class a javadoc moves everything below it. Until the client has the new text, it shows the
            // old one, and the position of the method in it is something else in the new one.
            int seen = client.notificationCount();
            client.call("entry/setJavadoc", "entry", TestClient.classEntry("a"), "javadoc", "The base of everything.");
            client.awaitNotification("sourceChanged", seen, n -> n.get("class").getAsString().equals("a"));
            JsonObject after = client.call("class/source", "class", "a");
            assertThat(after.get("serial").getAsLong(), greaterThan(serial));
            assertThat(after.get("text").getAsString(), containsString("The base of everything."));

            // a position that says it is for the old text is not answered for the new one
            TestClient.RpcError error = assertThrows(TestClient.RpcError.class,
                    () -> client.call("class/entryAt", "class", "a", "serial", serial, "line", line, "character", character));
            assertThat(error.code, is(RpcException.STALE));

            // asked again for the text it was given last, the client gets its answer
            String[] newLines = after.get("text").getAsString().split("\n", -1);
            int newLine = 0;
            while (!newLines[newLine].contains("abstract void a()")) {
                newLine++;
            }

            assertThat(newLine, greaterThan(line));
            JsonObject again = client.call("class/entryAt", "class", "a", "serial", after.get("serial").getAsLong(),
                    "line", newLine, "character", newLines[newLine].indexOf("a()"));
            assertThat(again.get("text").getAsString(), is("a"));
        }
    }

    @Test
    void describesTheEditableZonesOfASource() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.rename(GET_NAME, "getName");

            // SubsubclassAA overrides getName, and calls both super.getName() and this.getName()
            JsonObject source = client.call("class/source", "class", "e");
            String[] lines = source.get("text").getAsString().split("\n", -1);
            JsonArray refs = source.getAsJsonArray("refs");
            JsonArray groups = source.getAsJsonArray("groups");
            assertThat(refs.size(), greaterThan(4));

            int previousLine = -1;
            int previousEnd = -1;
            Map<Integer, Set<String>> textsOfGroup = new HashMap<>();
            Integer methodGroup = null;
            for (JsonElement element : refs) {
                JsonArray ref = element.getAsJsonArray();
                int line = ref.get(0).getAsInt();
                int character = ref.get(1).getAsInt();
                int length = ref.get(2).getAsInt();
                int group = ref.get(3).getAsInt();
                String text = lines[line].substring(character, character + length);

                // tokens are in document order and never overlap: the editor relies on that to tell names from the rest
                assertThat(line > previousLine || (line == previousLine && character >= previousEnd), is(true));
                previousLine = line;
                previousEnd = character + length;

                textsOfGroup.computeIfAbsent(group, k -> new HashSet<>()).add(text);
                if (text.equals("getName")) {
                    methodGroup = group;
                    assertThat("method tokens can be renamed in place", ref.get(4).getAsInt() & 2, is(2));
                    assertThat("they are highlighted as deobfuscated", ref.get(5).getAsInt(), is(2));
                } else if (text.equals("String")) {
                    assertThat("library classes cannot be renamed", ref.get(4).getAsInt() & 2, is(0));
                }
            }

            // the declaration, the super call and the call on this are one group: they are renamed together
            assertThat(methodGroup, notNullValue());
            JsonObject group = groups.get(methodGroup).getAsJsonObject();
            assertThat(group.get("name").getAsString(), is("getName"));
            assertThat(group.get("kind").getAsString(), is("method"));
            int expectedGroup = methodGroup;
            long occurrences = refs.asList().stream().filter(e -> e.getAsJsonArray().get(3).getAsInt() == expectedGroup).count();
            assertThat(occurrences, is(3L));

            // names that merely look the same are kept apart: in SubclassB, the superclass, a field and a method are all shown as "a"
            JsonObject subclassB = client.call("class/source", "class", "d");
            String[] subclassBLines = subclassB.get("text").getAsString().split("\\n", -1);
            Set<String> kindsNamedA = new HashSet<>();
            for (JsonElement element : subclassB.getAsJsonArray("refs")) {
                JsonArray ref = element.getAsJsonArray();
                String text = subclassBLines[ref.get(0).getAsInt()].substring(ref.get(1).getAsInt(), ref.get(1).getAsInt() + ref.get(2).getAsInt());
                if (text.equals("a")) {
                    kindsNamedA.add(subclassB.getAsJsonArray("groups").get(ref.get(3).getAsInt()).getAsJsonObject().get("kind").getAsString());
                }
            }

            assertThat(kindsNamedA, is(Set.of("class", "field", "method")));

            // every occurrence of a group shows the same text, which is what makes editing them together possible
            for (JsonElement element : refs) {
                JsonArray ref = element.getAsJsonArray();
                if ((ref.get(4).getAsInt() & 2) != 0) {
                    assertThat(textsOfGroup.get(ref.get(3).getAsInt()).size(), is(1));
                }
            }

            // bytecode is not editable in place
            JsonObject bytecode = client.call("class/source", "class", "e", "view", "bytecode");
            for (JsonElement element : bytecode.getAsJsonArray("refs")) {
                assertThat(element.getAsJsonArray().get(4).getAsInt() & 2, is(0));
            }

            // the class list says what kind of class each one is
            assertThat(classes(client).get("a").get("kind").getAsString(), is("class"));
        }
    }

    @Test
    void renamingAMethodPropagatesThroughTheInheritanceTree() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            // open the subclass first, so that the rename has to update an already decompiled class
            assertThat(client.source("d"), not(containsString("doBaseThings")));

            assertThat(applied(client.rename(DO_BASE_THINGS, "doBaseThings")), is(true));

            assertThat(client.source("a"), containsString("void doBaseThings()"));
            // SubclassB and SubsubclassAA override the method: the override and the super call follow the rename
            assertThat(client.source("d"), containsString("void doBaseThings()"));
            assertThat(client.source("e"), containsString("void doBaseThings()"));
            assertThat(client.call("project/state").get("dirty").getAsBoolean(), is(true));

            // renaming through an override renames the root declaration as well
            assertThat(applied(client.rename(TestClient.method("e", "a", "()V"), "performBaseThings")), is(true));
            assertThat(client.source("a"), containsString("void performBaseThings()"));
            assertThat(client.source("d"), containsString("void performBaseThings()"));
            assertThat(client.source("a"), not(containsString("doBaseThings")));
        }
    }

    @Test
    void renamingAClassUpdatesReferencesAndTheClassList() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            assertThat(client.source("c"), containsString("extends a"));

            int seen = client.notificationCount();
            assertThat(applied(renameConfirmed(client, TestClient.classEntry("a"), "com/example/BaseClass")), is(true));

            JsonObject changed = client.awaitNotification("mappingsChanged", seen, params -> true);
            JsonObject item = changed.getAsJsonArray("classes").get(0).getAsJsonObject();
            assertThat(item.get("obf").getAsString(), is("a"));
            assertThat(item.get("deobf").getAsString(), is("com/example/BaseClass"));
            assertThat(item.get("obfuscated").getAsBoolean(), is(false));

            assertThat(client.source("c"), containsString("extends BaseClass"));
            JsonObject source = client.call("class/source", "class", "a");
            assertThat(source.get("deobfName").getAsString(), is("com/example/BaseClass"));
            assertThat(source.get("text").getAsString(), containsString("class BaseClass"));
            assertThat(source.getAsJsonObject("tokens").getAsJsonArray("deobfuscated").size(), greaterThan(0));

            // renaming a constructor renames its class
            assertThat(applied(client.rename(TestClient.method("c", "<init>", "(Ljava/lang/String;)V"), "com/example/SubclassA")), is(true));
            assertThat(classes(client).get("c").get("deobf").getAsString(), is("com/example/SubclassA"));
        }
    }

    @Test
    void invalidRenamesAreRejectedWithEnigmasValidationMessages() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");

            JsonObject reserved = client.rename(NAME_FIELD, "class");
            assertThat(applied(reserved), is(false));
            assertThat(messageTypes(reserved), hasItem("error"));

            JsonObject illegal = client.rename(DO_BASE_THINGS, "1abc");
            assertThat(applied(illegal), is(false));
            assertThat(messageTypes(illegal), hasItem("error"));

            // two classes cannot share a name
            assertThat(applied(renameConfirmed(client, TestClient.classEntry("a"), "com/example/Thing")), is(true));
            JsonObject conflict = client.rename(TestClient.classEntry("c"), "com/example/Thing");
            assertThat(applied(conflict), is(false));
            assertThat(messageTypes(conflict), hasItem("error"));
            assertThat(client.source("c"), containsString("class c"));

            // nothing but the one valid rename happened
            assertThat(client.source("a"), not(containsString("1abc")));

            // javadoc cannot terminate the comment it is put in
            JsonObject doc = client.call("entry/setJavadoc", "entry", DO_BASE_THINGS, "javadoc", "oops */ injected");
            assertThat(applied(doc), is(false));
        }
    }

    @Test
    void warningsRequireConfirmation() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");

            // putting a class into a package that does not exist yet is a warning in Enigma
            JsonObject first = client.rename(TestClient.classEntry("a"), "brand/fresh/pkg/Base");
            assertThat(applied(first), is(false));
            assertThat(first.get("needsConfirmation").getAsBoolean(), is(true));
            assertThat(messageTypes(first), contains("warning"));
            assertThat(classes(client).get("a").get("obfuscated").getAsBoolean(), is(true));

            JsonObject confirmed = renameConfirmed(client, TestClient.classEntry("a"), "brand/fresh/pkg/Base");
            assertThat(applied(confirmed), is(true));
            assertThat(classes(client).get("a").get("deobf").getAsString(), is("brand/fresh/pkg/Base"));

            // the package exists now, so a second class needs no confirmation
            assertThat(applied(client.rename(TestClient.classEntry("c"), "brand/fresh/pkg/Sub")), is(true));

            // package components are validated like any identifier
            JsonObject reserved = client.rename(TestClient.classEntry("d"), "brand/new/pkg/Other");
            assertThat(applied(reserved), is(false));
            assertThat(reserved.get("needsConfirmation").getAsBoolean(), is(false));
            assertThat(messageTypes(reserved), hasItem("error"));
        }
    }

    @Test
    void undoAndRedoRestoreMappings() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            assertThat(client.call("project/state").get("canUndo").getAsBoolean(), is(false));

            client.rename(DO_BASE_THINGS, "doBaseThings");
            client.rename(DO_BASE_THINGS, "doOtherThings");
            client.call("entry/setJavadoc", "entry", DO_BASE_THINGS, "javadoc", "Does things.");
            assertThat(client.source("d"), containsString("doOtherThings"));
            assertThat(client.source("a"), containsString("Does things."));

            assertThat(applied(client.call("edit/undo")), is(true));
            assertThat(client.source("a"), not(containsString("Does things.")));
            assertThat(client.source("a"), containsString("doOtherThings"));

            client.call("edit/undo");
            assertThat(client.source("d"), containsString("void doBaseThings()"));

            client.call("edit/undo");
            assertThat(client.source("d"), not(containsString("doBaseThings")));
            JsonObject state = client.call("project/state");
            assertThat(state.get("canUndo").getAsBoolean(), is(false));
            assertThat(state.get("canRedo").getAsBoolean(), is(true));

            client.call("edit/redo");
            client.call("edit/redo");
            assertThat(client.source("d"), containsString("void doOtherThings()"));
            client.call("edit/redo");
            assertThat(client.source("a"), containsString("Does things."));
            assertThat(client.call("project/state").get("canRedo").getAsBoolean(), is(false));

            // a new edit discards the redo history
            client.call("edit/undo");
            client.rename(GET_NAME, "getName");
            assertThat(client.call("project/state").get("canRedo").getAsBoolean(), is(false));
            TestClient.RpcError error = assertThrows(TestClient.RpcError.class, () -> client.call("edit/redo"));
            // said by its name: the words are the client's
            assertThat(error.getMessage(), is("nothing-to-redo"));
            assertThat(error.data.getAsJsonObject().get("key").getAsString(), is("nothing-to-redo"));
        }
    }

    @Test
    void togglingMarksAndResetsEntries() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");

            // marking as deobfuscated keeps the obfuscated name
            assertThat(applied(client.call("entry/toggleMapping", "entry", NAME_FIELD)), is(true));
            JsonObject info = client.call("entry/info", "entry", NAME_FIELD);
            assertThat(info.get("tokenType").getAsString(), is("deobfuscated"));
            assertThat(info.get("name").getAsString(), is("a"));

            // toggling again resets it
            assertThat(applied(client.call("entry/toggleMapping", "entry", NAME_FIELD)), is(true));
            assertThat(client.call("entry/info", "entry", NAME_FIELD).get("tokenType").getAsString(), is("obfuscated"));
        }
    }

    @Test
    void mappingsSurviveSavingAndReopeningInEveryWritableFormat(@TempDir Path temp) throws IOException {
        Map<String, String> targets = Map.of(
                "enigma:enigma_file", "out.mapping",
                "enigma:enigma_directory", "out_dir",
                "enigma:enigma_zip", "out.zip",
                "enigma:tiny_v2", "out.tiny"
        );

        for (Map.Entry<String, String> target : targets.entrySet()) {
            Path path = temp.resolve(target.getValue());
            try (TestClient client = new TestClient()) {
                client.openJar("inheritance_tree");
                client.call("entry/rename", "entry", TestClient.classEntry("a"), "newName", "com/example/BaseClass", "confirmWarnings", true);
                client.rename(DO_BASE_THINGS, "doBaseThings");
                client.rename(NAME_FIELD, "name");
                client.call("entry/setJavadoc", "entry", GET_NAME, "javadoc", "Gets the name.");

                JsonObject saved = client.call("mappings/save", "path", path.toString(), "format", target.getKey());
                assertThat(target.getKey(), saved.get("dirty").getAsBoolean(), is(false));
                assertThat(target.getKey(), saved.get("mappingsFormat").getAsString(), is(target.getKey()));
                assertThat(target.getKey(), Files.exists(path), is(true));
            }

            // a fresh backend, as after restarting the editor
            try (TestClient client = new TestClient()) {
                client.openJar("inheritance_tree");
                JsonObject opened = client.call("mappings/open", "path", path.toString());
                assertThat(target.getKey(), opened.get("mappingsFormat").getAsString(), is(target.getKey()));
                assertThat(target.getKey(), opened.get("dirty").getAsBoolean(), is(false));

                String source = client.source("a");
                assertThat(target.getKey(), source, containsString("class BaseClass"));
                assertThat(target.getKey(), source, containsString("void doBaseThings()"));
                assertThat(target.getKey(), source, containsString("String name"));
                assertThat(target.getKey(), source, containsString("Gets the name."));
                assertThat(target.getKey(), classes(client).get("a").get("deobf").getAsString(), is("com/example/BaseClass"));

                // saving again only writes what changed, and must keep everything else
                client.rename(GET_NAME, "getName");
                assertThat(client.call("mappings/save").get("dirty").getAsBoolean(), is(false));
            }

            try (TestClient client = new TestClient()) {
                client.openJar("inheritance_tree");
                client.call("mappings/open", "path", path.toString());
                String source = client.source("a");
                assertThat(target.getKey(), source, containsString("String getName()"));
                assertThat(target.getKey(), source, containsString("void doBaseThings()"));
                assertThat(target.getKey(), source, containsString("Gets the name."));
            }
        }
    }

    @Test
    void readsAndWritesTheOtherFormats(@TempDir Path temp) throws IOException {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");

            // proguard mappings are read-only: the obfuscation log of the fixture itself is one, mapping deobfuscated -> obfuscated
            Path proguard = temp.resolve("inheritance_tree.txt");
            Files.copy(TestClient.OBF_JARS.resolve("inheritance_tree.map"), proguard);
            JsonObject opened = client.call("mappings/open", "path", proguard.toString());
            assertThat(opened.get("mappingsFormat").getAsString(), is("enigma:proguard"));
            assertThat(classes(client).get("a").get("deobf").getAsString(), is("org/quiltmc/enigma/input/inheritance_tree/BaseClass"));
            assertThat(client.source("a"), containsString("void doBaseThings()"));

            TestClient.RpcError readOnly = assertThrows(TestClient.RpcError.class, () -> client.call("mappings/save"));
            assertThat(readOnly.code, is(2));

            // srg can only be written
            Path srg = temp.resolve("out.tsrg");
            client.call("mappings/save", "path", srg.toString(), "format", "enigma:srg_file");
            assertThat(Files.readString(srg), containsString("org/quiltmc/enigma/input/inheritance_tree/BaseClass"));
            TestClient.RpcError writeOnly = assertThrows(TestClient.RpcError.class, () -> client.call("mappings/open", "path", srg.toString()));
            assertThat(writeOnly.code, is(2));

            // closing mappings returns everything to obfuscated
            client.call("mappings/close");
            assertThat(classes(client).get("a").get("obfuscated").getAsBoolean(), is(true));
            assertThat(client.call("project/state").get("mappingsPath").isJsonNull(), is(true));
        }
    }

    @Test
    void malformedMappingsReportTheOffendingLine(@TempDir Path temp) throws IOException {
        Path broken = temp.resolve("broken.mapping");
        Files.writeString(broken, "CLASS a com/example/Base\n\tMETHOD\n");

        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            TestClient.RpcError error = assertThrows(TestClient.RpcError.class, () -> client.call("mappings/open", "path", broken.toString()));
            assertThat(error.code, is(2));
            JsonObject data = error.data.getAsJsonObject();
            assertThat(data.get("kind").getAsString(), is("mappingParse"));
            assertThat(data.get("line").getAsInt(), greaterThan(0));
            assertThat(data.get("file").getAsString(), containsString("broken.mapping"));

            // the project is still usable and untouched
            assertThat(classes(client).get("a").get("obfuscated").getAsBoolean(), is(true));
        }
    }

    @Test
    void dropsMappingsThatDoNotMatchTheJar(@TempDir Path temp) throws IOException {
        Path mappings = temp.resolve("stale.mapping");
        Files.writeString(mappings, "CLASS a com/example/Base\nCLASS zzz com/example/Gone\n\tFIELD q gone I\n");

        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.call("mappings/open", "path", mappings.toString());

            JsonArray dropped = client.call("mappings/drop").getAsJsonArray("dropped");
            Set<String> names = new HashSet<>();
            dropped.forEach(e -> names.add(e.getAsJsonObject().get("kind").getAsString() + ":" + e.getAsJsonObject().get("name").getAsString()));
            assertThat(names, hasItems("class:zzz", "field:q"));
            assertThat(names, not(hasItem("class:a")));
            assertThat(client.call("project/state").get("dirty").getAsBoolean(), is(true));
        }
    }

    @Test
    void navigatesToDeclarationsAndFindsReferences() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.rename(DO_BASE_THINGS, "doBaseThings");

            JsonObject declaration = client.call("nav/declaration", "entry", DO_BASE_THINGS);
            assertThat(declaration.get("class").getAsString(), is("a"));
            JsonArray range = declaration.getAsJsonArray("range");
            assertThat(range.get(2).getAsInt(), is("doBaseThings".length()));

            // the token at that position is the method, and it can be renamed from there
            client.source("a");
            JsonObject at = client.call("class/entryAt", "class", "a", "line", range.get(0).getAsInt(), "character", range.get(1).getAsInt() + 2);
            assertThat(at.get("renameName").getAsString(), is("doBaseThings"));
            assertThat(at.get("renamable").getAsBoolean(), is(true));
            assertThat(at.get("declaration").getAsBoolean(), is(true));
            assertThat(at.getAsJsonObject("renameEntry"), is(DO_BASE_THINGS));

            // from an override, "go to definition" leads to the root declaration
            JsonObject overrideDeclaration = client.call("nav/declaration", "entry", TestClient.method("d", "a", "()V"));
            assertThat(overrideDeclaration.get("class").getAsString(), is("d"));
            JsonArray overrideRange = overrideDeclaration.getAsJsonArray("range");
            client.source("d");
            JsonObject definition = client.call("nav/definition", "class", "d", "line", overrideRange.get(0).getAsInt(), "character", overrideRange.get(1).getAsInt());
            assertThat(definition.get("class").getAsString(), is("a"));
            assertThat(definition.getAsJsonArray("range"), is(range));

            // references cover the declaration, the overrides and the call sites in other classes
            JsonObject references = client.call("nav/references", "entry", DO_BASE_THINGS);
            Set<String> classes = new HashSet<>();
            references.getAsJsonArray("locations").forEach(e -> classes.add(e.getAsJsonObject().get("class").getAsString()));
            assertThat(classes, hasItems("a", "d", "e"));
            assertThat(references.get("truncated").getAsBoolean(), is(false));

            // a class is referenced by its subclasses
            JsonObject classReferences = client.call("nav/references", "entry", TestClient.classEntry("a"));
            Set<String> referencing = new HashSet<>();
            classReferences.getAsJsonArray("locations").forEach(e -> referencing.add(e.getAsJsonObject().get("class").getAsString()));
            assertThat(referencing, hasItems("a", "c", "d"));

            // symbols of the class, for the outline
            JsonArray symbols = client.callRaw("class/symbols", "class", "a").getAsJsonArray();
            Set<String> symbolNames = new HashSet<>();
            symbols.forEach(e -> symbolNames.add(e.getAsJsonObject().get("name").getAsString()));
            assertThat(symbolNames, hasItems("a", "doBaseThings"));
        }
    }

    @Test
    void exposesStructureHierarchiesCallsSearchAndStats() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.call("entry/rename", "entry", TestClient.classEntry("a"), "newName", "com/example/BaseClass", "confirmWarnings", true);
            client.rename(DO_BASE_THINGS, "doBaseThings");

            JsonObject structure = client.call("structure", "class", "a");
            Set<String> labels = new HashSet<>();
            structure.getAsJsonArray("children").forEach(e -> labels.add(e.getAsJsonObject().get("label").getAsString()));
            assertThat(labels, hasItems("doBaseThings(): void", "a: String", "BaseClass(String)"));

            JsonObject onlyDeobfuscated = client.call("structure", "class", "a", "obfuscation", "deobfuscated");
            Set<String> deobfLabels = new HashSet<>();
            onlyDeobfuscated.getAsJsonArray("children").forEach(e -> deobfLabels.add(e.getAsJsonObject().get("label").getAsString()));
            assertThat(deobfLabels, hasItem("doBaseThings(): void"));
            assertThat(deobfLabels, not(hasItem("a: String")));

            // class inheritance is shown from the root of the hierarchy, like in Enigma's inheritance docker:
            // Object, then BaseClass with SubclassA and SubclassB below it, and the queried class selected
            JsonObject inheritance = client.call("hierarchy/inheritance", "entry", TestClient.classEntry("c")).getAsJsonObject("root");
            assertThat(inheritance.get("label").getAsString(), is("java/lang/Object"));
            JsonObject base = findNode(inheritance, "com/example/BaseClass");
            assertThat(base, notNullValue());
            assertThat(base.getAsJsonArray("children").size(), is(2));
            assertThat(findNode(inheritance, "c").get("selected").getAsBoolean(), is(true));
            assertThat(base.get("selected").getAsBoolean(), is(false));

            // method inheritance: the overrides of doBaseThings
            JsonObject methodInheritance = client.call("hierarchy/inheritance", "entry", DO_BASE_THINGS).getAsJsonObject("root");
            assertThat(methodInheritance, notNullValue());
            assertThat(methodInheritance.get("label").getAsString(), containsString("doBaseThings"));

            // implementations of an interface: b$c is InterfaceTree.Leaf1, which Branch12 extends
            JsonObject implementations = client.call("hierarchy/implementations", "entry", TestClient.classEntry("b$c")).getAsJsonObject("root");
            assertThat(implementations.get("label").getAsString(), is("b$c"));
            assertThat(implementations.getAsJsonArray("children").size(), greaterThan(0));
            // b$g is InterfaceTree.Root, which nothing extends: there is no tree to show
            assertThat(client.call("hierarchy/implementations", "entry", TestClient.classEntry("b$g")).get("root").isJsonNull(), is(true));

            JsonArray subtypes = client.callRaw("hierarchy/subtypes", "class", "a").getAsJsonArray();
            assertThat(subtypes.size(), is(2));
            JsonArray supertypes = client.callRaw("hierarchy/supertypes", "class", "c").getAsJsonArray();
            assertThat(supertypes.get(0).getAsJsonObject().get("fullName").getAsString(), is("com/example/BaseClass"));

            // who calls the constructor of BaseClass: its subclasses
            JsonObject calls = client.call("calls", "entry", TestClient.method("a", "<init>", "(Ljava/lang/String;)V")).getAsJsonObject("root");
            assertThat(calls.getAsJsonArray("children").size(), greaterThan(0));
            JsonArray incoming = client.callRaw("calls/incoming", "entry", TestClient.method("a", "<init>", "(Ljava/lang/String;)V")).getAsJsonArray();
            assertThat(incoming.size(), greaterThan(0));

            // search finds entries by deobfuscated and obfuscated name, best match first
            JsonArray byName = client.callRaw("search", "query", "BaseClass").getAsJsonArray();
            assertThat(byName.get(0).getAsJsonObject().get("name").getAsString(), is("BaseClass"));
            JsonArray methods = client.callRaw("search", "query", "doBase", "types", List.of("method")).getAsJsonArray();
            assertThat(methods.get(0).getAsJsonObject().get("name").getAsString(), is("doBaseThings"));
            assertThat(client.callRaw("search", "query", "zzzzqqq").getAsJsonArray().size(), is(0));

            JsonObject stats = client.call("stats/generate");
            assertThat(stats.get("mappable").getAsInt(), greaterThan(0));
            assertThat(stats.get("mapped").getAsInt(), greaterThan(0));
            assertThat(stats.getAsJsonObject("types").getAsJsonObject("classes").get("mapped").getAsInt(), greaterThan(0));
            assertThat(stats.getAsJsonObject("tree"), notNullValue());

            JsonObject classStats = client.call("stats/classes");
            assertThat(classStats.getAsJsonArray("a").get(0).getAsInt(), greaterThan(0));
        }
    }

    @Test
    void exportsRemappedJarAndSource(@TempDir Path temp) throws IOException {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.call("entry/rename", "entry", TestClient.classEntry("a"), "newName", "com/example/BaseClass", "confirmWarnings", true);
            client.rename(DO_BASE_THINGS, "doBaseThings");

            Path jar = temp.resolve("out.jar");
            client.call("export/jar", "path", jar.toString());
            try (JarFile jarFile = new JarFile(jar.toFile())) {
                assertThat(jarFile.getEntry("com/example/BaseClass.class"), notNullValue());
                assertThat(jarFile.getEntry("a.class"), nullValue());
            }

            Path sources = temp.resolve("src");
            client.call("export/source", "path", sources.toString());
            String base = Files.readString(sources.resolve("com/example/BaseClass.java"));
            assertThat(base, containsString("void doBaseThings()"));
            assertThat(Files.readString(sources.resolve("d.java")), containsString("extends BaseClass"));
        }
    }

    @Test
    void switchesDecompilers() {
        try (TestClient client = new TestClient()) {
            client.openJar("lone_class");
            String vineflower = client.source("a");
            assertThat(vineflower, containsString("Vineflower"));

            for (String id : List.of("enigma:cfr", "enigma:procyon", "enigma:bytecode", "enigma:vineflower")) {
                assertThat(client.call("decompiler/set", "id", id).get("decompiler").getAsString(), is(id));
                String source = client.source("a");
                assertThat(id, source, not(is("")));
                if (!id.equals("enigma:bytecode")) {
                    assertThat(id, source, containsString("class a"));
                }
            }

            assertThat(client.source("a"), is(vineflower));
        }
    }

    @Test
    void reportsErrorsForMissingProjectsAndUnknownMethods() {
        try (TestClient client = new TestClient()) {
            TestClient.RpcError noProject = assertThrows(TestClient.RpcError.class, () -> client.callRaw("classes/list"));
            assertThat(noProject.code, is(1));

            TestClient.RpcError unknown = assertThrows(TestClient.RpcError.class, () -> client.call("does/notExist"));
            assertThat(unknown.code, is(-32601));

            TestClient.RpcError missing = assertThrows(TestClient.RpcError.class, () -> client.call("project/openJar", "jar", "/does/not/exist.jar"));
            assertThat(missing.code, is(2));

            client.openJar("lone_class");
            TestClient.RpcError noClass = assertThrows(TestClient.RpcError.class, () -> client.call("class/source", "class", "nope"));
            assertThat(noClass.code, is(2));
            assertThat(client.notifications("projectChanged"), not(empty()));
        }
    }
}
