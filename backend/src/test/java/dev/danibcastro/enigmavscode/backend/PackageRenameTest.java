package dev.danibcastro.enigmavscode.backend;


import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:34
 * Created by: Dani-error
 */
@Timeout(300)
class PackageRenameTest {

    private static final Path MAPPINGS = TestClient.ENIGMA_ROOT.resolve("enigma-swing/src/test/resources/test_mappings");

    private static TestClient setup() {
        TestClient client = new TestClient();
        client.openJar("complete");
        client.call("mappings/open", "path", MAPPINGS.toString());
        assertBaseMappings(client);
        return client;
    }

    private static void renamePackage(TestClient client, String packageName, String newName, String mode) {
        JsonObject result = client.call("package/rename", "from", packageName, "to", newName, "mode", mode, "apply", true);
        assertThat(result.get("applied").getAsBoolean(), is(true));
    }

    private static void assertBaseMappings(TestClient client) {
        Map<String, String> names = names(client);
        assertThat(names.get("a"), is("a/b/c/A"));
        assertThat(names.get("b"), is("a/b/c/B"));
        assertThat(names.get("c"), is("a/b/C"));
        assertThat(names.get("d"), is("a/D"));
        assertThat(names.get("e"), is("E"));
        assertThat(names.get("f"), is("b/F"));
        assertThat(names.get("g"), is("b/c/G"));
    }

    private static Map<String, String> names(TestClient client) {
        Map<String, String> names = new HashMap<>();
        for (JsonElement element : client.callRaw("classes/list").getAsJsonArray()) {
            names.put(element.getAsJsonObject().get("obf").getAsString(), element.getAsJsonObject().get("deobf").getAsString());
        }

        return names;
    }

    private static void assertMappings(TestClient client, String... obfToDeobf) {
        Map<String, String> names = names(client);
        for (int i = 0; i < obfToDeobf.length; i += 2) {
            assertThat(obfToDeobf[i], names.get(obfToDeobf[i]), is(obfToDeobf[i + 1]));
        }
    }

    @Test
    void testRemoveOnePackage() {
        try (TestClient client = setup()) {
            renamePackage(client, "a/b/c", "a/c", "refactor");
            assertMappings(client, "a", "a/c/A", "b", "a/c/B", "c", "a/c/C", "d", "a/D", "e", "E");
        }
    }

    @Test
    void testRemoveTwoPackages() {
        try (TestClient client = setup()) {
            renamePackage(client, "a/b/c", "a", "refactor");
            assertMappings(client, "a", "a/A", "b", "a/B", "c", "a/C", "d", "a/D", "e", "E");
        }
    }

    @Test
    void testPackageConservation() {
        try (TestClient client = setup()) {
            renamePackage(client, "a/b", "a", "refactor");
            assertMappings(client, "a", "a/c/A", "b", "a/c/B", "c", "a/C", "d", "a/D", "e", "E");
        }
    }

    @Test
    void testAppendOnePackage() {
        try (TestClient client = setup()) {
            renamePackage(client, "a/b/c", "a/b/c/d", "refactor");
            assertMappings(client, "a", "a/b/c/d/A", "b", "a/b/c/d/B", "c", "a/b/C", "d", "a/D", "e", "E");
        }
    }

    @Test
    void testSimpleRename() {
        try (TestClient client = setup()) {
            renamePackage(client, "a/b/c", "a/b/d", "refactor");
            assertMappings(client, "a", "a/b/d/A", "b", "a/b/d/B", "c", "a/b/C", "d", "a/D", "e", "E");
        }
    }

    @Test
    void testFirstPackageRename() {
        try (TestClient client = setup()) {
            renamePackage(client, "a", "b", "refactor");
            assertMappings(client, "a", "b/b/c/A", "b", "b/b/c/B", "c", "b/b/C", "d", "b/D", "e", "E");
        }
    }

    @Test
    void testPackageMove() {
        try (TestClient client = setup()) {
            renamePackage(client, "a/b/c", "a/c", "move");
            assertMappings(client, "a", "a/c/A", "b", "a/c/B", "c", "a/b/C", "d", "a/D", "e", "E");
        }
    }

    @Test
    void testPackageMerge() {
        try (TestClient client = setup()) {
            renamePackage(client, "b", "a", "refactor");
            assertMappings(client, "a", "a/b/c/A", "b", "a/b/c/B", "c", "a/b/C", "d", "a/D", "e", "E", "f", "a/F", "g", "a/c/G");
        }
    }

    @Test
    void previewsWithoutApplyingAndUndoesAsOneStep() {
        try (TestClient client = setup()) {
            JsonObject preview = client.call("package/rename", "from", "a/b/c", "to", "a/b/d", "mode", "refactor");
            assertThat(preview.get("applied").getAsBoolean(), is(false));
            assertThat(preview.getAsJsonArray("renames").size(), is(2));
            assertBaseMappings(client);

            renamePackage(client, "a/b/c", "a/b/d", "refactor");
            assertMappings(client, "a", "a/b/d/A", "b", "a/b/d/B");

            client.call("edit/undo");
            assertBaseMappings(client);

            TestClient.RpcError invalid = org.junit.jupiter.api.Assertions.assertThrows(TestClient.RpcError.class,
                    () -> client.call("package/rename", "from", "a/b/c", "to", "a/b/d/", "mode", "refactor", "apply", true));
            assertThat(invalid.code, is(2));
        }
    }

}
