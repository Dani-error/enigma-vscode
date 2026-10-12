package dev.danibcastro.enigmavscode.backend;


import org.tinylog.Level;
import org.tinylog.core.LogEntry;
import org.tinylog.core.LogEntryValue;
import org.tinylog.writers.Writer;

import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiConsumer;

/*
 * Project: enigma-vscode
 * Created at: 12/10/2026 14:03
 * Created by: Dani-error
 */
public final class LogCapture implements Writer {

    private static final List<BiConsumer<Level, String>> LISTENERS = new CopyOnWriteArrayList<>();

    public LogCapture(Map<String, String> properties) { }

    @Override
    public Collection<LogEntryValue> getRequiredLogEntryValues() {
        return EnumSet.of(LogEntryValue.LEVEL, LogEntryValue.MESSAGE, LogEntryValue.EXCEPTION);
    }

    @Override
    public void write(LogEntry logEntry) {
        if (LISTENERS.isEmpty()) {
            return;
        }

        String message = logEntry.getMessage();
        Throwable exception = logEntry.getException();
        if (exception != null) {
            message = message == null || message.isEmpty() ? exception.toString() : message + ": " + exception;
        }

        for (BiConsumer<Level, String> listener : LISTENERS) {
            listener.accept(logEntry.getLevel(), String.valueOf(message));
        }
    }

    @Override
    public void flush() { }

    @Override
    public void close() { }

    /**
     * Runs the task, returning every error that was logged while it ran.
     */
    public static List<String> errorsDuring(ThrowingRunnable task) throws Exception {
        List<String> errors = new ArrayList<>();
        BiConsumer<Level, String> listener = (level, message) -> {
            if (level == Level.ERROR) {
                synchronized (errors) {
                    errors.add(message);
                }
            }
        };

        LISTENERS.add(listener);
        try {
            task.run();
        } finally {
            LISTENERS.remove(listener);
        }

        return errors;
    }

    public static void addListener(BiConsumer<Level, String> listener) {
        LISTENERS.add(listener);
    }

    @FunctionalInterface
    public interface ThrowingRunnable {
        void run() throws Exception;
    }

}
