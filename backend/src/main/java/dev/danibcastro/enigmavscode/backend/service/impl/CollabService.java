package dev.danibcastro.enigmavscode.backend.service.impl;


import dev.danibcastro.enigmavscode.backend.Session;
import dev.danibcastro.enigmavscode.backend.protocol.collab.*;
import dev.danibcastro.enigmavscode.backend.protocol.error.Problem;
import dev.danibcastro.enigmavscode.backend.protocol.project.Severity;
import dev.danibcastro.enigmavscode.backend.protocol.project.State;
import dev.danibcastro.enigmavscode.backend.rpc.Announcement;
import dev.danibcastro.enigmavscode.backend.rpc.EntryCodec;
import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;
import dev.danibcastro.enigmavscode.backend.rpc.RpcException;
import dev.danibcastro.enigmavscode.backend.service.Service;
import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.EnigmaProject;
import org.quiltmc.enigma.api.ProgressListener;
import org.quiltmc.enigma.api.translation.mapping.EntryChange;
import org.quiltmc.enigma.api.translation.mapping.EntryMapping;
import org.quiltmc.enigma.api.translation.mapping.EntryRemapper;
import org.quiltmc.enigma.api.translation.mapping.tree.DeltaTrackingTree;
import org.quiltmc.enigma.api.translation.mapping.tree.EntryTree;
import org.quiltmc.enigma.api.translation.mapping.tree.HashEntryTree;
import org.quiltmc.enigma.api.translation.representation.entry.Entry;
import org.quiltmc.enigma.network.*;
import org.quiltmc.enigma.network.packet.Packet;
import org.quiltmc.enigma.network.packet.c2s.EntryChangeC2SPacket;
import org.quiltmc.enigma.network.packet.c2s.LoginC2SPacket;
import org.quiltmc.enigma.network.packet.c2s.MessageC2SPacket;
import org.quiltmc.enigma.network.packet.s2c.UserListS2CPacket;
import org.quiltmc.enigma.util.I18n;
import org.tinylog.Logger;

import java.io.IOException;
import java.net.Socket;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 19:44
 * Created by: Dani-error
 */
public final class CollabService implements Service, ClientPacketHandler {

    private final Session session;
    private final EditService edits;
    private final MappingsService mappings;

    @Nullable
    private EnigmaClient client;
    @Nullable
    private EnigmaServer server;
    private List<String> users = List.of();

    public CollabService(Session session, EditService edits, MappingsService mappings) {
        this.session = session;
        this.edits = edits;
        this.mappings = mappings;

        // what is changed here is sent to the others
        edits.onChange(this::sendChange);
    }

    @Override
    public void register() {
        JsonRpcConnection rpc = this.session.rpc();
        rpc.register("collab/connect", ConnectParams.class, this::connect);
        rpc.register("collab/host", HostParams.class, this::host);
        rpc.register("collab/disconnect", () -> {
            this.disconnect(null);
            return this.session.state();
        });
        rpc.registerAction("collab/sendMessage", SendMessageParams.class, this::sendMessage);
        rpc.register("collab/state", this::describe);
    }

    private CollabState describe() {
        return new CollabState(this.session.connectionState(), this.users);
    }

    private void setState(ConnectionState state) {
        this.session.connectionState(state);
        this.session.rpc().notify(Announcement.COLLAB_STATE_CHANGED, this.describe());
        this.session.notifyState();
    }

    private static char[] password(@Nullable String sent) {
        char[] password = Objects.requireNonNullElse(sent, "").toCharArray();
        if (password.length > EnigmaServer.MAX_PASSWORD_LENGTH) {
            throw RpcException.user(I18n.translateFormatted("validation.message.field_length_out_of_range", EnigmaServer.MAX_PASSWORD_LENGTH));
        }

        return password;
    }

    private static String username(String username) {
        if (!EnigmaServer.usernameMatchesRegex(username)) {
            throw RpcException.user(I18n.translate("validation.message.invalid_username"));
        }

        return username;
    }

    private State connect(ConnectParams params) {
        EnigmaProject project = this.session.requireProject();
        if (this.session.connectionState() != ConnectionState.NOT_CONNECTED) {
            throw RpcException.said(Problem.ALREADY_CONNECTED);
        }

        String username = username(params.username());
        char[] password = password(params.password());
        ServerAddress address = ServerAddress.from(params.address(), EnigmaServer.DEFAULT_PORT);
        if (address == null) {
            throw RpcException.user(I18n.translate("validation.message.invalid_ip"));
        }

        try {
            Client client = new Client(address.address, address.port);
            client.connect();
            this.client = client;
            client.sendPacket(new LoginC2SPacket(project.getJarChecksum(), password, username));
        } catch (IOException e) {
            this.client = null;
            throw RpcException.said(Problem.CONNECT_FAILED, address.address + ":" + address.port, e.getMessage());
        }

        this.setState(ConnectionState.CONNECTED);
        this.session.notifyUser(Severity.INFO, I18n.translate("validation.message.connected_to_server"), null);
        return this.session.state();
    }

    private State host(HostParams params) {
        EnigmaProject project = this.session.requireProject();
        if (this.session.connectionState() != ConnectionState.NOT_CONNECTED) {
            throw RpcException.said(Problem.ALREADY_CONNECTED);
        }

        String username = username(params.username());
        char[] password = password(params.password());
        int port = Objects.requireNonNullElse(params.port(), EnigmaServer.DEFAULT_PORT);
        if (port < 0 || port > 65535) {
            throw RpcException.user(I18n.translateFormatted("validation.message.field_out_of_range_int", 0, 65535));
        }

        try {
            // the server works on its own copy of the mappings, exactly like GuiController#createServer
            EntryRemapper serverRemapper = EntryRemapper.mapped(
                    project.getEnigma(), project.getCombinedIndex(), project.getMappingsIndex(),
                    new HashEntryTree<>(project.getRemapper().getJarProposedMappings()),
                    new HashEntryTree<>(project.getRemapper().getDeobfMappings()),
                    project.getEnigma().getNameProposalServices()
            );

            Server server = new Server(project.getJarChecksum(), password, serverRemapper, port);
            server.start();
            this.server = server;

            Client client = new Client("127.0.0.1", port);
            client.connect();
            this.client = client;
            client.sendPacket(new LoginC2SPacket(project.getJarChecksum(), password, username));
        } catch (IOException e) {
            this.stopNetworking();
            throw RpcException.said(Problem.SERVER_START_FAILED, port, e.getMessage());
        }

        this.setState(ConnectionState.HOSTING);
        this.session.notifyUser(Severity.INFO, I18n.translate("validation.message.server_started"), null);
        return this.session.state();
    }

    private void sendMessage(SendMessageParams params) {
        if (this.client == null) {
            throw RpcException.said(Problem.NOT_CONNECTED);
        }

        String text = params.text().trim();
        if (!text.isEmpty()) {
            this.client.sendPacket(new MessageC2SPacket(text));
        }
    }

    private void stopNetworking() {
        if (this.client != null) {
            this.client.disconnect();
            this.client = null;
        }

        if (this.server != null) {
            this.server.stop();
            this.server = null;
        }
    }

    /**
     * Disconnects from, and stops, any running server.
     * @param reason a translation key or message explaining why, if the disconnection was not requested by the user
     */
    public void disconnect(@Nullable String reason) {
        if (this.client == null && this.server == null) {
            return;
        }

        this.stopNetworking();
        this.users = List.of();

        if (reason != null) {
            this.session.notifyUser(Severity.WARNING, I18n.translate("disconnect.disconnected") + ": " + Session.translateOr(reason, reason), null);
        }

        this.session.notifyUser(Severity.INFO, I18n.translate("validation.message.left_server"), null);
        this.setState(ConnectionState.NOT_CONNECTED);
    }

    /** Sends a local change to the server, if connected. */
    void sendChange(EntryChange<?> change) {
        this.sendPacket(new EntryChangeC2SPacket(change));
    }

    @Override
    public void openMappings(EntryTree<EntryMapping> mappings) {
        if (this.session.project() == null) {
            return;
        }

        EntryRemapper previous = this.session.project().getRemapper();
        boolean wasDirty = previous.isDirty();
        this.mappings.replaceMappings(mappings, ProgressListener.createEmpty());

        if (wasDirty) {
            // The engine forgets which entries were modified when the mappings are swapped for the server's copy.
            // Keep unsaved work marked as such, so that the next save writes it out instead of silently skipping it.
            DeltaTrackingTree<EntryMapping> current = this.session.project().getRemapper().getMappings();
            current.getAllEntries().toList().forEach(current::trackChange);
            this.session.notifyState();
        }
    }

    @Override
    public boolean applyChangeFromServer(EntryChange<?> change) {
        if (this.session.project() == null) {
            return false;
        }

        try {
            return this.edits.applyRemoteChange(change);
        } catch (RuntimeException e) {
            Logger.error(e, "Failed to apply change from server: {}", change);
            return false;
        }
    }

    @Override
    public synchronized void disconnectIfConnected(String reason) {
        // may be called from the network thread when the connection drops
        this.session.rpc().runOnSessionThread(() -> this.disconnect(reason));
    }

    @Override
    public void sendPacket(Packet<ServerPacketHandler> packet) {
        if (this.client != null) {
            this.client.sendPacket(packet);
        }
    }

    @Override
    public void addMessage(ServerMessage message) {
        Entry<?> entry = null;
        if (message instanceof ServerMessage.EditDocs m) {
            entry = m.entry;
        } else if (message instanceof ServerMessage.MarkDeobf m) {
            entry = m.entry;
        } else if (message instanceof ServerMessage.RemoveMapping m) {
            entry = m.entry;
        } else if (message instanceof ServerMessage.Rename m) {
            entry = m.entry;
        }

        this.session.rpc().notify(Announcement.COLLAB_MESSAGE, new CollabMessage(message.getType(), message.user, message.translate(), entry == null ? null : EntryCodec.toRef(entry)));
    }

    @Override
    public void updateUserList(List<String> users) {
        this.users = new ArrayList<>(users);
        this.session.rpc().notify(Announcement.COLLAB_STATE_CHANGED, this.describe());
    }

    /** Runs packet handling on the session thread, like the integrated client and server run it on the event dispatch thread. */
    private final class Client extends EnigmaClient {

        Client(String ip, int port) {
            super(CollabService.this, ip, port);
        }

        @Override
        protected void runOnThread(Runnable task) {
            CollabService.this.session.rpc().runOnSessionThread(task);
        }

    }

    private final class Server extends EnigmaServer {
        /** Mirrors the server's own, private, list of logged in users. Touched by the session and the network threads. */
        private final Map<Socket, String> usernames = new ConcurrentHashMap<>();

        Server(byte[] jarChecksum, char[] password, EntryRemapper remapper, int port) {
            super(jarChecksum, password, remapper, port);
        }

        @Override
        protected void runOnThread(Runnable task) {
            CollabService.this.session.rpc().runOnSessionThread(task);
        }

        @Override
        public void setUsername(Socket client, String username) {
            this.usernames.put(client, username);
            super.setUsername(client, username);
        }

        @Override
        public void kick(Socket client, String reason, boolean notifyOthers) {
            this.usernames.remove(client);
            super.kick(client, reason, notifyOthers);
        }

        /**
         * Enigma's server announces the user list when someone logs in, but only to clients that already finished
         * the login exchange. The user who just joined therefore never learns who is connected (a lone host sees
         * nobody at all) until the next person joins or leaves. Announce the list again once a client is approved.
         * This is a regular user list packet, so unmodified Enigma clients handle it too.
         */
        @Override
        public void confirmChange(Socket client, int syncId) {
            boolean wasApproved = this.isClientApproved(client);
            super.confirmChange(client, syncId);
            if (!wasApproved && this.isClientApproved(client)) {
                List<String> names = new ArrayList<>(this.usernames.values());
                Collections.sort(names);
                this.sendToAll(new UserListS2CPacket(names));
            }
        }
    }

}
