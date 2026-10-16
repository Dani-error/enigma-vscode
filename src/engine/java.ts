import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Finding a Java runtime that can run the Enigma engine.

export const MINIMUM_JAVA = 17;

/** Where a runtime was found. The extension words it for the user; source is the same in English, for logs. */
export type JavaOrigin =
    | { kind: 'setting' }
    | { kind: 'javaHome' }
    | { kind: 'path' }
    | { kind: 'installed'; directory: string };

/** Why a runtime was passed over. */
export type JavaProblem =
    | { kind: 'noExecutable'; file: string }
    | { kind: 'notStartable'; error?: string }
    | { kind: 'tooOld'; version: number };

export interface JavaRuntime {
    executable: string;
    /** The installation directory, when known. */
    home?: string;
    /** Major version, e.g. 17 */
    version: number;
    origin: JavaOrigin;
    /** Where it was found, in English, for logs */
    source: string;
}

export interface RejectedJava {
    path: string;
    origin: JavaOrigin;
    problem: JavaProblem;
    /** origin and problem in English, for logs */
    source: string;
    reason: string;
}

const SOURCES: Record<Exclude<JavaOrigin['kind'], 'installed'>, string> = {
    setting: 'the enigma.java.home setting',
    javaHome: 'JAVA_HOME',
    path: 'the PATH',
};

/** Where a runtime was found, in English. */
export const sourceOf = (origin: JavaOrigin) => origin.kind === 'installed' ? `installed in ${origin.directory}` : SOURCES[origin.kind];

/** Why a runtime was passed over, in English. */
export const reasonOf = (problem: JavaProblem) => problem.kind === 'noExecutable' ? `there is no ${problem.file} in it`
    : problem.kind === 'tooOld' ? `it is Java ${problem.version}` : problem.error ?? 'it could not be started';

const rejection = (javaPath: string, origin: JavaOrigin, problem: JavaProblem): RejectedJava =>
    ({ path: javaPath, origin, problem, source: sourceOf(origin), reason: reasonOf(problem) });

export interface JavaSearch {
    /** The runtime to use, if found. */
    runtime?: JavaRuntime;
    /** What was looked at and passed over, in order. */
    rejected: RejectedJava[];
    /** Set when the user chose an installation explicitly and it cannot be used. Nothing else is tried in that case. */
    configuredInvalid?: boolean;
}

export interface JavaSearchOptions {
    /** Value of the enigma.java.home setting. */
    configuredHome?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    homeDir?: string;
    minimum?: number;
    /** Directories that contain Java installations; defaults to the usual ones of the platform. */
    searchRoots?: string[];
}

const executableName = (platform: NodeJS.Platform) => {
    return platform === 'win32' ? 'java.exe' : 'java';
}

/** Parses the major version out of the output of {@code java -version} or the {@code JAVA_VERSION} of a release file. */
export const parseMajorVersion = (text: string) => {
    const match = /(?:version\s+"|JAVA_VERSION\s*=\s*")(\d+)(?:\.(\d+))?/.exec(text) ?? /^"?(\d+)(?:\.(\d+))?/.exec(text.trim());
    if (!match) {
        return undefined;
    }

    // Java 8 and older call themselves 1.8, 1.7, ...
    const major = match[1] === '1' && match[2] !== undefined ? Number(match[2]) : Number(match[1]);
    return Number.isFinite(major) ? major : undefined;
}

/**
 * Asks a java executable for its version.
 *
 * JAVA_HOME is removed from its environment: launchers such as macOS' /usr/bin/java run whatever JAVA_HOME points
 * to, which would make "java on the PATH" report the very installation that was just found unsuitable.
 */
export const probeJava = (executable: string, env: NodeJS.ProcessEnv = process.env) => {
    const childEnv = { ...env };
    delete childEnv.JAVA_HOME;

    return new Promise<{ version?: number; error?: string }>(resolve => {
        execFile(executable, ['-version'], { timeout: 20000, env: childEnv }, (error, stdout, stderr) => {
            if (error) {
                resolve({ error: error.message.split('\n')[0] });
                return;
            }

            const version = parseMajorVersion(`${stderr}\n${stdout}`);
            resolve(version === undefined ? { error: 'its version could not be determined' } : { version });
        });
    });
}

/** The version recorded in the release file every JDK ships, without starting it. */
const releaseVersion = (home: string) => {
    try {
        const release = fs.readFileSync(path.join(home, 'release'), 'utf8');
        const line = release.split(/\r?\n/).find(candidate => candidate.startsWith('JAVA_VERSION='));

        return line ? parseMajorVersion(line) : undefined;
    } catch {
        return undefined;
    }
}

const expandHome = (value: string, homeDir: string) => {
    return value === '~' || value.startsWith('~/') || value.startsWith('~\\') ? path.join(homeDir, value.substring(1)) : value;
}

/**
 * Turns what a user may reasonably put into the setting into an installation directory: the directory itself, its
 * bin directory, the java executable, or a macOS .jdk bundle.
 */
export const normalizeJavaHome = (value: string, platform: NodeJS.Platform = process.platform, homeDir: string = os.homedir()) => {
    let home = expandHome(value.trim().replace(/^["']|["']$/g, ''), homeDir);
    const executable = executableName(platform);
    if (path.basename(home) === executable || path.basename(home) === 'java') {
        home = path.dirname(home);
    }

    if (path.basename(home) === 'bin' && !fs.existsSync(path.join(home, 'bin', executable))) {
        home = path.dirname(home);
    }

    const bundled = path.join(home, 'Contents', 'Home');
    if (!fs.existsSync(path.join(home, 'bin', executable)) && fs.existsSync(path.join(bundled, 'bin', executable))) {
        home = bundled;
    }

    return home;
}

const defaultSearchRoots = (platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv) => {
    const roots = [
        path.join(homeDir, '.sdkman', 'candidates', 'java'),
        path.join(homeDir, '.jdks'),
        path.join(homeDir, '.gradle', 'jdks'),
        path.join(homeDir, '.asdf', 'installs', 'java'),
        path.join(homeDir, '.local', 'share', 'mise', 'installs', 'java'),
    ];

    if (platform === 'darwin') {
        roots.unshift(
            '/Library/Java/JavaVirtualMachines',
            path.join(homeDir, 'Library', 'Java', 'JavaVirtualMachines'),
            '/opt/homebrew/opt',
            '/usr/local/opt',
        );
    } else if (platform === 'win32') {
        for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]) {
            if (base) {
                roots.unshift(...['Java', 'Eclipse Adoptium', 'Amazon Corretto', 'Zulu', 'Microsoft', 'BellSoft', 'Semeru'].map(vendor => path.join(base, vendor)));
            }
        }
    } else {
        roots.unshift('/usr/lib/jvm', '/usr/lib64/jvm', '/usr/java', '/opt/java', '/opt/jdk');
    }

    return roots;
}

/**
 * Lists the Java installations found in the usual places, newest first. Nothing is executed.
 */
export const discoverInstallations = (options: JavaSearchOptions = {}) => {
    const platform = options.platform ?? process.platform;
    const homeDir = options.homeDir ?? os.homedir();
    const env = options.env ?? process.env;
    const executable = executableName(platform);
    const found = new Map<string, JavaRuntime>();

    for (const root of options.searchRoots ?? defaultSearchRoots(platform, homeDir, env)) {
        let entries: string[];
        try {
            entries = fs.readdirSync(root);
        } catch {
            continue;
        }

        for (const entry of entries) {
            // homebrew keeps many unrelated packages next to its JDKs
            if ((root.endsWith(`${path.sep}opt`) || root.endsWith('/opt')) && !/^openjdk/.test(entry)) {
                continue;
            }

            const candidates = [
                path.join(root, entry),
                path.join(root, entry, 'Contents', 'Home'),
                path.join(root, entry, 'libexec', 'openjdk.jdk', 'Contents', 'Home'),
            ];
            for (const home of candidates) {
                const java = path.join(home, 'bin', executable);
                if (!fs.existsSync(java)) {
                    continue;
                }

                const version = releaseVersion(home);
                if (version === undefined) {
                    continue;
                }

                let resolved = home;
                try {
                    resolved = fs.realpathSync(home);
                } catch {
                    // keep the path as it is
                }

                if (!found.has(resolved)) {
                    const origin: JavaOrigin = { kind: 'installed', directory: root };
                    found.set(resolved, { executable: java, home, version, origin, source: sourceOf(origin) });
                }

                break;
            }
        }
    }

    return [...found.values()].sort((a, b) => b.version - a.version || a.executable.localeCompare(b.executable));
}

const onPath = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => {
    const executable = executableName(platform);
    for (const directory of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
        if (directory && fs.existsSync(path.join(directory, executable))) {
            return path.join(directory, executable);
        }
    }

    return undefined;
}


/**
 * Finds a Java runtime new enough for the engine.
 */
export async function findJava(options: JavaSearchOptions = {}): Promise<JavaSearch> {
    const platform = options.platform ?? process.platform;
    const homeDir = options.homeDir ?? os.homedir();
    const env = options.env ?? process.env;
    const minimum = options.minimum ?? MINIMUM_JAVA;
    const executable = executableName(platform);
    const rejected: RejectedJava[] = [];

    const tryHome = async (rawHome: string, origin: JavaOrigin): Promise<JavaRuntime | undefined> => {
        const home = normalizeJavaHome(rawHome, platform, homeDir);
        const java = path.join(home, 'bin', executable);
        if (!fs.existsSync(java)) {
            rejected.push(rejection(rawHome, origin, { kind: 'noExecutable', file: path.join('bin', executable) }));
            return undefined;
        }

        const probe = await probeJava(java, env);
        if (probe.version === undefined) {
            rejected.push(rejection(java, origin, { kind: 'notStartable', error: probe.error }));
            return undefined;
        }

        if (probe.version < minimum) {
            rejected.push(rejection(java, origin, { kind: 'tooOld', version: probe.version }));
            return undefined;
        }

        return { executable: java, home, version: probe.version, origin, source: sourceOf(origin) };
    };

    const configured = options.configuredHome?.trim();
    if (configured) {
        const runtime = await tryHome(configured, { kind: 'setting' });
        return runtime ? { runtime, rejected } : { rejected, configuredInvalid: true };
    }

    if (env.JAVA_HOME) {
        const runtime = await tryHome(env.JAVA_HOME, { kind: 'javaHome' });
        if (runtime) {
            return { runtime, rejected };
        }
    }

    const pathJava = onPath(env, platform);
    if (pathJava) {
        const probe = await probeJava(pathJava, env);
        if (probe.version !== undefined && probe.version >= minimum) {
            return { runtime: { executable: pathJava, version: probe.version, origin: { kind: 'path' }, source: sourceOf({ kind: 'path' }) }, rejected };
        }

        rejected.push(rejection(pathJava, { kind: 'path' }, probe.version !== undefined ? { kind: 'tooOld', version: probe.version } : { kind: 'notStartable', error: probe.error }));
    }

    for (const installation of discoverInstallations(options)) {
        if (installation.version < minimum) {
            continue;
        }

        // the release file said it is new enough; make sure it actually starts
        const probe = await probeJava(installation.executable, env);
        if (probe.version !== undefined && probe.version >= minimum) {
            return { runtime: { ...installation, version: probe.version }, rejected };
        }

        rejected.push(rejection(installation.executable, installation.origin, probe.version !== undefined ? { kind: 'tooOld', version: probe.version } : { kind: 'notStartable', error: probe.error }));
    }

    return { rejected };
}

/** Explains a failed search, in English: for logs and the build (the extension words it for the user, see javaText.ts). */
export const describeFailure = (search: JavaSearch, minimum: number = MINIMUM_JAVA) => {
    const tried = search.rejected.map(entry => `${entry.path} (from ${entry.source}): ${entry.reason}`).join('; ');
    if (search.configuredInvalid) {
        return `The Java installation chosen in the "enigma.java.home" setting cannot be used. ${tried}. Enigma needs Java ${minimum} or newer.`;
    }

    return `Enigma needs Java ${minimum} or newer to run, and none was found.${tried ? ` Looked at: ${tried}.` : ''}`;
}

export const environmentFor = (runtime: JavaRuntime, env: NodeJS.ProcessEnv = process.env) => {
    const result: NodeJS.ProcessEnv = { ...env };
    if (runtime.home) {
        result.JAVA_HOME = runtime.home;
    } else {
        delete result.JAVA_HOME;
    }

    return result;
}
