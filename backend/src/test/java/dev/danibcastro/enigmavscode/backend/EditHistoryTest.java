package dev.danibcastro.enigmavscode.backend;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 20:31
 * Created by: Dani-error
 */
class EditHistoryTest {

    private static EditHistory.Step step(String label) {
        return new EditHistory.Step(label, List.of());
    }

    @Test
    void takesBackTheLastThingFirstAndMakesItAgain() {
        EditHistory history = new EditHistory();
        assertThat(history.canUndo(), is(false));
        assertThat(history.takeUndo(), is(nullValue()));

        history.record(step("first"));
        history.record(step("second"));
        assertThat(history.undoLabel(), is("second"));

        EditHistory.Step taken = history.takeUndo();
        history.undone(taken);
        assertThat(history.undoLabel(), is("first"));
        assertThat(history.redoLabel(), is("second"));

        history.redone(history.takeRedo());
        assertThat(history.undoLabel(), is("second"));
        assertThat(history.canRedo(), is(false));
    }

    @Test
    void forgetsWhatWasTakenBackOnceSomethingElseIsDone() {
        EditHistory history = new EditHistory();
        history.record(step("first"));
        history.undone(history.takeUndo());
        assertThat(history.canRedo(), is(true));

        history.record(step("other"));
        assertThat(history.canRedo(), is(false));
        assertThat(history.undoLabel(), is("other"));
    }

    @Test
    void doesNotOfferAgainWhatWasNotPutBack() {
        // a step that could not be taken back all the way is dropped rather than left half done
        EditHistory history = new EditHistory();
        history.record(step("first"));
        history.takeUndo();
        assertThat(history.canUndo(), is(false));
        assertThat(history.canRedo(), is(false));
    }

    @Test
    void forgetsEverythingWhenTheMappingsAreOthers() {
        EditHistory history = new EditHistory();
        history.record(step("first"));
        history.record(step("second"));
        history.undone(history.takeUndo());
        history.clear();
        assertThat(history.canUndo(), is(false));
        assertThat(history.canRedo(), is(false));
        assertThat(history.undoLabel(), is(nullValue()));
    }

}
