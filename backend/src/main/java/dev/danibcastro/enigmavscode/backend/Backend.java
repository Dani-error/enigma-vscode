package dev.danibcastro.enigmavscode.backend;

import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.service.Service;
import dev.danibcastro.enigmavscode.backend.service.impl.*;

import java.util.List;

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

        EntryService entries;

        List.of(
                entries = new EntryService(session),
                new SourceService(session, entries),
                new TreeService(session, entries),
                new SearchService(session, entries),
                new StatsService(session),
                new ExportService(session)
                // TODO: rest
        ).forEach(Service::register);
    }

}
