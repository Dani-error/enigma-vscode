package dev.danibcastro.enigmavscode.backend.rpc;


import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.experimental.Accessors;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 16:01
 * Created by: Dani-error
 *
 * What the engine tells the client without being asked, by the name the client listens for.
 */
@AllArgsConstructor
@Getter @Accessors(fluent = true)
public enum Announcement {
    /** What is open, or what can be done with it, is different now. */
    STATE_CHANGED("stateChanged"),
    /** A jar was opened or closed. */
    PROJECT_CHANGED("projectChanged"),
    MAPPINGS_CHANGED("mappingsChanged"),
    /** The text of a class the client has open is another now. */
    SOURCE_CHANGED("sourceChanged"),
    /** Something to tell the user. */
    NOTIFICATION("notification"),
    PROGRESS("progress"),
    COLLAB_STATE_CHANGED("collab/stateChanged"),
    COLLAB_MESSAGE("collab/message");

    private final String method;

}
