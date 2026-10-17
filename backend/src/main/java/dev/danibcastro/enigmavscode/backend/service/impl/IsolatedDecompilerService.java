package dev.danibcastro.enigmavscode.backend.service.impl;

import org.jspecify.annotations.Nullable;
import org.quiltmc.enigma.api.class_provider.ClassProvider;
import org.quiltmc.enigma.api.service.DecompilerService;
import org.quiltmc.enigma.api.source.Decompiler;
import org.quiltmc.enigma.api.source.Source;
import org.quiltmc.enigma.api.source.SourceIndex;
import org.quiltmc.enigma.api.source.SourceSettings;
import org.quiltmc.enigma.api.translation.mapping.EntryRemapper;

import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/*
 * Project: enigma-vscode
 * Created at: 17/10/2026 18:54
 * Created by: Dani-error
 */

/**
 * A decompiler that decompiles on threads of its own, rather than on those of Enigma, which calls it.
 *
 * <p>Enigma stops its threads when its project is closed, in the middle of decompiling if need be: they are
 * interrupted. Vineflower spreads a class over threads of its own, which it waits for. Interrupted while it waits, it
 * stops waiting and closes what it reads from, the classes of the JDK among them, while its threads are still reading:
 * they fail, and log errors. Here nothing is interrupted. A thread of Enigma waits until the class is decompiled,
 * interrupted or not, and then stops.
 */
record IsolatedDecompilerService(DecompilerService decompiler) implements DecompilerService {

    private static final AtomicInteger THREAD_COUNT = new AtomicInteger();
    private static final ExecutorService THREADS = Executors.newCachedThreadPool(task -> {
        Thread thread = new Thread(task, "decompiler-" + THREAD_COUNT.incrementAndGet());
        thread.setDaemon(true);
        return thread;
    });

    @Override
    public String getId() {
        return this.decompiler.getId();
    }

    @Override
    public Decompiler create(ClassProvider classProvider, SourceSettings settings) {
        return new IsolatedDecompiler(this.decompiler.create(classProvider, settings));
    }

    /** Runs a step of decompiling on a thread of its own, and waits for it, whether interrupted meanwhile or not. */
    private static <T> T isolated(Supplier<T> step) {
        Future<T> future = THREADS.submit(step::get);
        boolean interrupted = false;
        try {
            while (true) {
                try {
                    return future.get();
                } catch (InterruptedException e) {
                    interrupted = true;
                } catch (ExecutionException e) {
                    if (e.getCause() instanceof RuntimeException cause) {
                        throw cause;
                    }

                    if (e.getCause() instanceof Error cause) {
                        throw cause;
                    }

                    throw new CompletionException(e.getCause());
                }
            }
        } finally {
            if (interrupted) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private record IsolatedDecompiler(Decompiler decompiler) implements Decompiler {

        @Override
        public Source getUndocumentedSource(String className) {
            return new IsolatedSource(isolated(() -> this.decompiler.getUndocumentedSource(className)));
        }

        @Override
        public Source getSource(String className, @Nullable EntryRemapper remapper) {
            return new IsolatedSource(isolated(() -> this.decompiler.getSource(className, remapper)));
        }
    }

    /** Vineflower decompiles when it is first asked for the text, not when the source is made. */
    private record IsolatedSource(Source source) implements Source {

        @Override
        public String asString() {
            return isolated(this.source::asString);
        }

        @Override
        public Source withJavadocs(EntryRemapper remapper) {
            return new IsolatedSource(isolated(() -> this.source.withJavadocs(remapper)));
        }

        @Override
        public SourceIndex index() {
            return isolated(this.source::index);
        }
    }
}
