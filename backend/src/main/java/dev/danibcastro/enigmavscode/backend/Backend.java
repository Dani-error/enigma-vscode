package dev.danibcastro.enigmavscode.backend;

import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 15:05
 * Created by: Dani-error
 *
 * Puts the engine layer together.
 */
public final class Backend {

    public Backend(JsonRpcConnection rpc) {
        Session session = new Session(rpc);

        // TODO: register services
    }

}
