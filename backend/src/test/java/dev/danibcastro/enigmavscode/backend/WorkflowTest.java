package dev.danibcastro.enigmavscode.backend;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertThrows;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:40
 * Created by: Dani-error
 */
@Timeout(300)
class WorkflowTest {

    private static final JsonObject DO_BASE_THINGS = TestClient.method("a", "a", "()V");

    /** The {@code String} parameter of BaseClass' constructor. Index 0 is {@code this}. */
    private static final JsonObject CONSTRUCTOR_PARAMETER = TestClient.params(
            "kind", "local", "owner", "a", "method", "<init>", "desc", "(Ljava/lang/String;)V", "index", 1, "parameter", true);

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    private static List<String> users(TestClient client) {
        return client.call("collab/state").getAsJsonArray("users").asList().stream().map(e -> e.getAsString()).toList();
    }

    @Test
    void collaboratorsSeeEachOthersChanges() throws IOException {
        int port = freePort();
        try (TestClient host = new TestClient(); TestClient guest = new TestClient()) {
            host.openJar("inheritance_tree");
            guest.openJar("inheritance_tree");

            // work done before the session starts is shared with whoever joins
            host.rename(DO_BASE_THINGS, "doBaseThings");

            assertThat(host.call("collab/host", "username", "host_user", "port", port, "password", "secret").get("connection").getAsString(), is("hosting"));
            host.awaitNotification("collab/stateChanged", 0, p -> p.getAsJsonArray("users").size() == 1);

            int guestSeen = guest.notificationCount();
            assertThat(guest.call("collab/connect", "username", "guest_user", "address", "127.0.0.1:" + port, "password", "secret").get("connection").getAsString(), is("connected"));
            guest.awaitNotification("mappingsChanged", guestSeen, p -> p.get("full").getAsBoolean());
            host.awaitNotification("collab/stateChanged", 0, p -> p.getAsJsonArray("users").size() == 2);
            assertThat(users(host), hasItems("host_user", "guest_user"));
            assertThat(guest.source("d"), containsString("void doBaseThings()"));

            // guest -> host
            guestSeen = guest.notificationCount();
            int hostSeen = host.notificationCount();
            assertThat(guest.rename(TestClient.field("a", "a", "Ljava/lang/String;"), "name").get("applied").getAsBoolean(), is(true));
            host.awaitNotification("mappingsChanged", hostSeen, p -> true);
            assertThat(host.source("a"), containsString("String name"));
            JsonObject renameMessage = host.awaitNotification("collab/message", hostSeen, p -> p.get("type").getAsString().equals("rename"));
            assertThat(renameMessage.get("user").getAsString(), is("guest_user"));

            // host -> guest, including javadoc
            guestSeen = guest.notificationCount();
            host.call("entry/setJavadoc", "entry", DO_BASE_THINGS, "javadoc", "Shared documentation.");
            guest.awaitNotification("mappingsChanged", guestSeen, p -> true);
            assertThat(guest.source("a"), containsString("Shared documentation."));

            // undo on one side is propagated like any other edit
            guestSeen = guest.notificationCount();
            host.call("edit/undo");
            guest.awaitNotification("mappingsChanged", guestSeen, p -> true);
            assertThat(guest.source("a"), not(containsString("Shared documentation.")));

            // chat
            hostSeen = host.notificationCount();
            guest.call("collab/sendMessage", "text", "hello there");
            JsonObject chat = host.awaitNotification("collab/message", hostSeen, p -> p.get("type").getAsString().equals("chat"));
            assertThat(chat.get("text").getAsString(), containsString("hello there"));

            // the host owns the mappings: guests cannot save
            TestClient.RpcError error = assertThrows(TestClient.RpcError.class, () -> guest.call("mappings/save", "path", "/tmp/nope.mapping", "format", "enigma:enigma_file"));
            assertThat(error.code, is(2));

            // when the host stops the server, guests are disconnected
            guestSeen = guest.notificationCount();
            host.call("collab/disconnect");
            guest.awaitNotification("collab/stateChanged", guestSeen, p -> p.get("state").getAsString().equals("not_connected"));
            assertThat(host.call("project/state").get("connection").getAsString(), is("not_connected"));
        }
    }

    @Test
    void mappingsTheHostOpensAreSharedWithEveryone(@TempDir Path temp) throws IOException {
        int port = freePort();
        Path file = temp.resolve("opened.mapping");
        Files.writeString(file, "CLASS a OpenedBase\n\tFIELD a openedName Ljava/lang/String;\n");
        try (TestClient host = new TestClient(); TestClient guest = new TestClient(); TestClient late = new TestClient()) {
            host.openJar("inheritance_tree");
            guest.openJar("inheritance_tree");
            late.openJar("inheritance_tree");
            host.call("collab/host", "username", "host_user", "port", port, "password", "");
            int guestSeen = guest.notificationCount();
            guest.call("collab/connect", "username", "guest_user", "address", "127.0.0.1:" + port, "password", "");
            guest.awaitNotification("mappingsChanged", guestSeen, p -> p.get("full").getAsBoolean());

            guestSeen = guest.notificationCount();
            host.call("mappings/open", "path", file.toString(), "format", "enigma:enigma_file");
            guest.awaitNotification("mappingsChanged", guestSeen, p -> p.get("full").getAsBoolean());
            assertThat(guest.source("a"), containsString("class OpenedBase"));

            // whoever joins later gets them too, and what they change reaches the host
            int lateSeen = late.notificationCount();
            late.call("collab/connect", "username", "late_user", "address", "127.0.0.1:" + port, "password", "");
            late.awaitNotification("mappingsChanged", lateSeen, p -> p.get("full").getAsBoolean());
            assertThat(late.source("a"), containsString("String openedName"));
            int hostSeen = host.notificationCount();
            assertThat(late.rename(DO_BASE_THINGS, "afterOpening").get("applied").getAsBoolean(), is(true));
            host.awaitNotification("mappingsChanged", hostSeen, p -> true);
            assertThat(host.source("a"), containsString("void afterOpening()"));

            // closing them is shared as well
            guestSeen = guest.notificationCount();
            host.call("mappings/close");
            guest.awaitNotification("mappingsChanged", guestSeen, p -> p.get("full").getAsBoolean());
            assertThat(guest.source("a"), not(containsString("OpenedBase")));

            // the mappings of a session are the server's: someone who joined cannot swap them for others alone
            TestClient.RpcError refused = assertThrows(TestClient.RpcError.class,
                    () -> guest.call("mappings/open", "path", file.toString(), "format", "enigma:enigma_file"));
            assertThat(refused.data.getAsJsonObject().get("key").getAsString(), is("mappings-from-server"));
        }
    }

    @Test
    void rejectsBadCredentialsAndMismatchedJars() throws IOException {
        int port = freePort();
        try (TestClient host = new TestClient(); TestClient guest = new TestClient(); TestClient stranger = new TestClient()) {
            host.openJar("inheritance_tree");
            guest.openJar("inheritance_tree");
            stranger.openJar("lone_class");
            host.call("collab/host", "username", "host_user", "port", port, "password", "secret");

            TestClient.RpcError badName = assertThrows(TestClient.RpcError.class, () -> guest.call("collab/connect", "username", "x", "address", "127.0.0.1:" + port));
            assertThat(badName.code, is(2));

            // the server kicks clients with a wrong password or a different jar
            int seen = guest.notificationCount();
            guest.call("collab/connect", "username", "guest_user", "address", "127.0.0.1:" + port, "password", "wrong");
            guest.awaitNotification("collab/stateChanged", seen, p -> p.get("state").getAsString().equals("not_connected"));

            seen = stranger.notificationCount();
            stranger.call("collab/connect", "username", "stranger", "address", "127.0.0.1:" + port, "password", "secret");
            stranger.awaitNotification("collab/stateChanged", seen, p -> p.get("state").getAsString().equals("not_connected"));

            assertThat(users(host), is(List.of("host_user")));
        }
    }

    @Test
    void unsavedWorkOfTheHostIsStillSavedAfterHosting(@TempDir Path temp) throws IOException {
        int port = freePort();
        Path mappings = temp.resolve("work.mapping");
        try (TestClient host = new TestClient()) {
            host.openJar("inheritance_tree");
            host.rename(DO_BASE_THINGS, "savedBefore");
            host.call("mappings/save", "path", mappings.toString(), "format", "enigma:enigma_file");

            host.rename(DO_BASE_THINGS, "unsavedBeforeHosting");
            host.call("collab/host", "username", "host_user", "port", port);
            host.awaitNotification("collab/stateChanged", 0, p -> p.getAsJsonArray("users").size() == 1);

            // starting the server swaps the mappings for the server's copy; the pending change must not be forgotten
            assertThat(host.call("project/state").get("dirty").getAsBoolean(), is(true));
            host.call("mappings/save");
            assertThat(Files.readString(mappings), containsString("unsavedBeforeHosting"));
        }
    }

    @Test
    void snapshotsRecoverUnsavedWork(@TempDir Path temp) {
        Path snapshot = temp.resolve("recovery/snapshot.mapping");
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.rename(DO_BASE_THINGS, "doBaseThings");
            client.call("entry/setJavadoc", "entry", DO_BASE_THINGS, "javadoc", "Recovered.");

            client.call("mappings/snapshot", "path", snapshot.toString());
            // taking a snapshot is not saving
            assertThat(client.call("project/state").get("dirty").getAsBoolean(), is(true));
        }

        // the editor was closed without saving; a new session restores the snapshot
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            JsonObject state = client.call("mappings/restoreSnapshot", "path", snapshot.toString());
            assertThat(state.get("dirty").getAsBoolean(), is(true));
            assertThat(client.source("d"), containsString("void doBaseThings()"));
            assertThat(client.source("a"), containsString("Recovered."));
        }
    }

    @Test
    void autoSaveWritesEveryEdit(@TempDir Path temp) throws IOException {
        Path mappings = temp.resolve("auto.mapping");
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.call("mappings/save", "path", mappings.toString(), "format", "enigma:enigma_file");
            client.call("configure", "autoSave", true);

            client.rename(DO_BASE_THINGS, "savedAutomatically");
            assertThat(Files.readString(mappings), containsString("savedAutomatically"));
            assertThat(client.call("project/state").get("dirty").getAsBoolean(), is(false));

            client.call("edit/undo");
            assertThat(Files.readString(mappings), not(containsString("savedAutomatically")));
        }
    }

    @Test
    void parametersAndConstructorsCanBeEdited() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");

            assertThat(client.rename(CONSTRUCTOR_PARAMETER, "initialName").get("applied").getAsBoolean(), is(true));
            assertThat(client.source("a"), containsString("String initialName"));

            // constructors cannot be renamed, but they can be documented
            JsonObject constructor = TestClient.method("a", "<init>", "(Ljava/lang/String;)V");
            assertThat(client.call("entry/setJavadoc", "entry", constructor, "javadoc", "Creates the base.").get("applied").getAsBoolean(), is(true));
            String source = client.source("a");
            assertThat(source, containsString("Creates the base."));
            // parameter names show up in the generated javadoc
            assertThat(source, containsString("initialName"));

            // clearing javadoc
            client.call("entry/setJavadoc", "entry", constructor, "javadoc", "");
            assertThat(client.source("a"), not(containsString("Creates the base.")));
        }
    }

    @Test
    void reloadingDiscardsUnsavedChanges(@TempDir Path temp) {
        Path mappings = temp.resolve("reload.mapping");
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.rename(DO_BASE_THINGS, "saved");
            client.call("mappings/save", "path", mappings.toString(), "format", "enigma:enigma_file");

            // reload mappings: back to what is on disk
            client.rename(DO_BASE_THINGS, "notSaved");
            assertThat(client.source("a"), containsString("void notSaved()"));
            JsonObject reloaded = client.call("mappings/reload");
            assertThat(reloaded.get("dirty").getAsBoolean(), is(false));
            assertThat(reloaded.get("mappingsPath").getAsString(), is(mappings.toString()));
            assertThat(client.source("a"), containsString("void saved()"));

            // reload all: the jar is indexed again and the same mappings are applied
            client.rename(DO_BASE_THINGS, "notSavedEither");
            JsonObject reloadedAll = client.call("project/reload");
            assertThat(reloadedAll.get("mappingsPath").getAsString(), is(mappings.toString()));
            assertThat(reloadedAll.get("dirty").getAsBoolean(), is(false));
            assertThat(client.source("a"), containsString("void saved()"));
            assertThat(client.call("project/state").get("canUndo").getAsBoolean(), is(false));

            // there is nothing to reload without mappings
            client.call("mappings/close");
            TestClient.RpcError error = assertThrows(TestClient.RpcError.class, () -> client.call("mappings/reload"));
            assertThat(error.code, is(2));
        }
    }

    @Test
    void opensJarsWithLibrariesAndAppliesDecompilerOptions() {
        try (TestClient client = new TestClient()) {
            // another jar as a library: it is available to the decompiler and the indexer, but is not part of the project
            client.call("project/openJar", "jar", TestClient.jar("inheritance_tree").toString(), "libraries", List.of(TestClient.jar("records").toString()));
            List<String> classes = client.callRaw("classes/list").getAsJsonArray().asList().stream().map(e -> e.getAsJsonObject().get("obf").getAsString()).toList();
            assertThat(classes, hasItems("a", "d"));
            assertThat(classes.size(), is(6));

            TestClient.RpcError missing = assertThrows(TestClient.RpcError.class,
                    () -> client.call("project/openJar", "jar", TestClient.jar("inheritance_tree").toString(), "libraries", List.of("/no/such/library.jar")));
            assertThat(missing.code, is(2));

            // Vineflower options take effect on classes that are already open
            client.call("project/openJar", "jar", TestClient.jar("inheritance_tree").toString());
            assertThat(client.source("a"), containsString("Class file decompiled with Vineflower"));
            client.call("configure", "vineflower", TestClient.params("banner", "// decompiled for a test\n"));
            String source = client.source("a");
            assertThat(source, containsString("// decompiled for a test"));
            assertThat(source, not(containsString("Class file decompiled with Vineflower")));
            client.call("configure", "vineflower", TestClient.params());
            assertThat(client.source("a"), containsString("Class file decompiled with Vineflower"));
        }
    }

    @Test
    void honoursTheSaveParametersOfAProfile(@TempDir Path temp) throws IOException {
        // profiles configure services and how mappings are written: here, directory mappings named after obfuscated classes
        Path profile = temp.resolve("profile.json");
        Files.writeString(profile, """
				{
					"services": {},
					"mapping_save_parameters": { "file_name_format": "by_obf", "write_proposed_names": false }
				}
				""");

        Path byObf = temp.resolve("by_obf");
        try (TestClient client = new TestClient(TestClient.params("profile", profile.toString()))) {
            client.openJar("inheritance_tree");
            client.call("entry/rename", "entry", TestClient.classEntry("a"), "newName", "com/example/BaseClass", "confirmWarnings", true);
            client.call("mappings/save", "path", byObf.toString(), "format", "enigma:enigma_directory");
            assertThat(Files.exists(byObf.resolve("a.mapping")), is(true));
        }

        // the default profile names files after the deobfuscated class
        Path byDeobf = temp.resolve("by_deobf");
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.call("entry/rename", "entry", TestClient.classEntry("a"), "newName", "com/example/BaseClass", "confirmWarnings", true);
            client.call("mappings/save", "path", byDeobf.toString(), "format", "enigma:enigma_directory");
            assertThat(Files.exists(byDeobf.resolve("com/example/BaseClass.mapping")), is(true));
        }

        TestClient.RpcError missing = assertThrows(TestClient.RpcError.class, () -> new TestClient(TestClient.params("profile", temp.resolve("nope.json").toString())).close());
        assertThat(missing.code, is(2));
    }

    @Test
    void editingCanBeRestrictedByType() {
        try (TestClient client = new TestClient()) {
            client.openJar("inheritance_tree");
            client.call("configure", "editable", List.of("class", "javadoc"));

            TestClient.RpcError error = assertThrows(TestClient.RpcError.class, () -> client.rename(DO_BASE_THINGS, "nope"));
            assertThat(error.code, is(2));
            assertThat(client.call("entry/rename", "entry", TestClient.classEntry("a"), "newName", "Base").get("applied").getAsBoolean(), is(true));
            assertThat(client.call("entry/setJavadoc", "entry", DO_BASE_THINGS, "javadoc", "Allowed.").get("applied").getAsBoolean(), is(true));

            List<String> editable = client.call("project/state").getAsJsonArray("editable").asList().stream().map(e -> e.getAsString()).toList();
            assertThat(editable, hasItem("class"));
            assertThat(editable, not(hasItem("method")));
        }
    }

}
