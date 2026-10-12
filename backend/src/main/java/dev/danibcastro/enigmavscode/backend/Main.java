package dev.danibcastro.enigmavscode.backend;


import dev.danibcastro.enigmavscode.backend.rpc.JsonRpcConnection;

import java.io.*;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 13:59
 * Created by: Dani-error
 */
public class Main {

    public static void main(String[] args) {
        System.setProperty("tinylog.configuration", "enigma-vscode-tinylog.properties");

        // make sure it doesn't open a display
        System.setProperty("java.awt.headless", "true");

        // stdout carries the protocol, so nothing else may write to it
        InputStream in = System.in;
        OutputStream out = new FileOutputStream(FileDescriptor.out);
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.err), true));

        JsonRpcConnection connection = new JsonRpcConnection(in, out);

        // TODO: initialise backend

        connection.listen();
        connection.close();
        System.exit(0);
    }

}
