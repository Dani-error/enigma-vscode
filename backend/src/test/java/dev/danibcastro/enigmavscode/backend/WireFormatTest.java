package dev.danibcastro.enigmavscode.backend;


import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryKind;
import dev.danibcastro.enigmavscode.backend.protocol.entry.EntryRef;
import dev.danibcastro.enigmavscode.backend.protocol.entry.SymbolKind;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.project.Task;
import dev.danibcastro.enigmavscode.backend.protocol.source.NameRef;
import dev.danibcastro.enigmavscode.backend.protocol.source.Range;
import dev.danibcastro.enigmavscode.backend.protocol.source.TokenCategory;
import dev.danibcastro.enigmavscode.backend.protocol.source.View;
import dev.danibcastro.enigmavscode.backend.protocol.stats.ClassProgress;
import dev.danibcastro.enigmavscode.backend.protocol.wire.Flatten;
import dev.danibcastro.enigmavscode.backend.protocol.wire.OmitIfNull;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.quiltmc.enigma.api.source.TokenType;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertThrows;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:32
 * Created by: Dani-error
 */
class WireFormatTest {

    private static String json(Object value) {
        return JsonRpcConnection.GSON.toJson(value);
    }

    record Inner(
            String name,
            @OmitIfNull @Nullable String sometimes,
            @Nullable String always
    ) { }

    record Outer(
            @Flatten Inner inner,
            String name,
            int more
    ) { }

    record Keyed(
            Map<TokenCategory, List<Integer>> byCategory
    ) { }

    record Viewed(
            @Nullable View view
    ) { }

    @Test
    void sendsEnumsTheWayTheClientSpellsThem() {
        // in lower case
        assertThat(json(View.BYTECODE), is("\"bytecode\""));
        assertThat(json(EntryKind.LOCAL), is("\"local\""));
        // also those of Enigma
        assertThat(json(TokenType.JAR_PROPOSED), is("\"jar_proposed\""));
        // or under the name they say they have
        assertThat(json(SymbolKind.ENUM_CONSTANT), is("\"enumConstant\""));
        assertThat(json(Problem.JAR_NOT_FOUND), is("\"jar-not-found\""));
        assertThat(json(Task.OPENING_MAPPINGS), is("\"opening-mappings\""));
    }

    @Test
    void sendsEnumsThatAreKeysTheSameWay() {
        Map<TokenCategory, List<Integer>> map = new EnumMap<>(TokenCategory.class);
        map.put(TokenCategory.DEOBFUSCATED, List.of(1));
        assertThat(json(new Keyed(map)), is("{\"byCategory\":{\"deobfuscated\":[1]}}"));
    }

    @Test
    void readsEnumsWhateverTheirCaseAndRefusesWhatIsNone() {
        assertThat(JsonRpcConnection.GSON.fromJson("{\"view\":\"Bytecode\"}", Viewed.class).view(), is(View.BYTECODE));
        assertThat(JsonRpcConnection.GSON.fromJson("{}", Viewed.class).view() == null, is(true));
        assertThrows(JsonParseException.class, () -> JsonRpcConnection.GSON.fromJson("{\"view\":\"sideways\"}", Viewed.class));
    }

    @Test
    void leavesOutOnlyWhatMayBeLeftOut() {
        assertThat(json(new Inner("a", null, null)), is("{\"name\":\"a\",\"always\":null}"));
        assertThat(json(new Inner("a", "b", "c")), is("{\"name\":\"a\",\"sometimes\":\"b\",\"always\":\"c\"}"));
        // an entry says only what its kind has
        assertThat(json(new EntryRef(EntryKind.CLASS, null, null, "a/B", null, null, null)), is("{\"kind\":\"class\",\"name\":\"a/B\"}"));
    }

    @Test
    void writesAnAnswerBuiltOnAnotherAsOne() {
        JsonObject flat = JsonRpcConnection.GSON.toJsonTree(new Outer(new Inner("inner", null, "kept"), "outer", 3)).getAsJsonObject();
        // the parts of both, without the part that held one of them
        assertThat(flat.keySet(), is(java.util.Set.of("name", "always", "more")));
        assertThat(flat.get("always").getAsString(), is("kept"));
        // what the answer says itself wins over what it is built on
        assertThat(flat.get("name").getAsString(), is("outer"));
    }

    record Holder(
            @Flatten @Nullable Inner inner,
            String name
    ) { }

    @Test
    void writesAPartThatIsNotThereAsNothing() {
        assertThat(json(new Holder(null, "alone")), is("{\"name\":\"alone\"}"));
    }

    @Test
    void sendsPlacesAsShortListsOfNumbers() {
        Range range = new Range(4, 22, 9);
        assertThat(json(range), is("[4,22,9]"));
        // a name in a text: where, its group, what it is (1 declared here, 2 can be typed over), how it is marked
        assertThat(json(new NameRef(range, 3, true, true, TokenCategory.DEOBFUSCATED)), is("[4,22,9,3,3,2]"));
        assertThat(json(new NameRef(range, 0, false, true, null)), is("[4,22,9,0,2,0]"));
        assertThat(json(new ClassProgress(5, 12)), is("[5,12]"));
        assertThat(json(List.of(range, range)), is("[[4,22,9],[4,22,9]]"));
    }

}
