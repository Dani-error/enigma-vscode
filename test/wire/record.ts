// Records what the engine sends for a fixed session of every kind of request, to compare before and after a change
// of its code that should not change what it says:
//
//   npx tsx test/wire/record.ts before.json     then change the engine, build it, and
//   npx tsx test/wire/record.ts after.json
//   npx tsx test/wire/compare.ts before.json after.json
//
// Some of what is sent is wrong on purpose: what the engine refuses is part of what it says.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ResponseError } from 'vscode-jsonrpc/node';
import type { SearchResult, SourceResult } from '../../src/engine/protocol';
import { Engine, classEntry, fieldEntry, fixtures, methodEntry } from '../engine';

export interface Recorded {
    method: string;
    params: unknown;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

export interface Recording {
    log: Recorded[];
    /** Each as JSON, sorted: they do not arrive in a fixed order. */
    notifications: string[];
}

/** How long the engine gets to finish telling what follows from the requests before it. */
const SETTLE_MS = 700;

const out = process.argv[2];
if (!out) {
    console.error('Usage: npx tsx test/wire/record.ts <file to write>');
    process.exit(1);
}

const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wire-')));
const jar = path.join(temp, 'inheritance_tree.jar');
fs.copyFileSync(path.join(fixtures, 'inheritance_tree.jar'), jar);
const engine = new Engine(temp);
const log: Recorded[] = [];

/** Takes out what differs from run to run: where the files are, the time, the lines of a stack trace. */
const scrub = <T>(value: T): T =>
    JSON.parse(
        JSON.stringify(value ?? null)
            .split(temp)
            .join('<TEMP>')
            .replace(/"(time|javaVersion|javaHome|pid)":("[^"]*"|\d+)/g, '"$1":"<x>"')
            .replace(/at [\w.$<>]+\([\w.]+:\d+\)\\n\\t?/g, ''),
    ) as T;

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }

    return value && typeof value === 'object'
        ? Object.fromEntries(
              Object.entries(value)
                  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                  .map(([key, inner]) => [key, sortKeys(inner)]),
          )
        : value;
}

/** Sends something, and records what comes back. Untyped: this is about what is on the wire. */
async function ask<T = unknown>(method: string, params: object = {}): Promise<T | undefined> {
    const recorded: Recorded = { method, params: scrub(params) };
    let result: T | undefined;
    try {
        result = (await engine.send(method, params)) as T;
        recorded.result = scrub(result);
    } catch (error) {
        if (!(error instanceof ResponseError)) {
            throw error;
        }

        const data = error.data as Record<string, unknown> | undefined;
        recorded.error = scrub({
            code: error.code,
            message: error.message,
            data: data ? { ...data, stackTrace: data.stackTrace ? '<trace>' : undefined } : undefined,
        });
    }

    log.push(recorded);
    return result;
}

const settle = () => new Promise(resolve => setTimeout(resolve, SETTLE_MS));
const A = classEntry('a');
const D = classEntry('d');
const cls = classEntry;
const doBase = methodEntry('a', 'a', '()V');
const getName = methodEntry('a', 'a', '()Ljava/lang/String;');
const field = fieldEntry('a', 'a', 'Ljava/lang/String;');

await ask('initialize', { language: 'en_us' });
await ask('configure', {
    language: 'en_us',
    editable: null,
    autoSave: false,
    decompiler: 'enigma:vineflower',
    vineflower: {},
    profile: null,
});
await ask('project/state');
await ask('classes/list'); // no project
await ask('project/openJar', { jar, libraries: [] });
await ask('project/openJar', { jar: path.join(temp, 'missing.jar'), libraries: [] });
await ask('project/state');
await ask('classes/list');
for (const entry of [
    A,
    D,
    doBase,
    getName,
    field,
    cls('java/lang/String'),
    { kind: 'method', owner: 'a', name: '<init>', desc: '(Ljava/lang/String;)V' },
]) {
    await ask('entry/info', { entry });
}
const source = await ask<SourceResult>('class/source', { class: 'a', view: 'source' });
await ask('class/source', { class: 'd', view: 'source' });
await ask('class/source', { class: 'a', view: 'bytecode' });
await ask('class/source', { class: 'no/such' });
for (const ref of (source?.refs ?? []).slice(0, 14)) {
    await ask('class/entryAt', { class: 'a', view: 'source', serial: source?.serial, line: ref[0], character: ref[1] });
    await ask('nav/definition', { class: 'a', view: 'source', serial: source?.serial, line: ref[0], character: ref[1] });
}
const some = (source?.refs ?? [])[3];
if (some) {
    await ask('nav/references', {
        class: 'a',
        view: 'source',
        serial: source?.serial,
        line: some[0],
        character: some[1],
        includeDeclaration: true,
        limit: 20,
    });
}
await ask('class/entryAt', { class: 'a', view: 'source', serial: 999999, line: 0, character: 0 });
await ask('class/entryAt', { class: 'a', view: 'source', line: 0, character: 0 });
await ask('class/symbols', { class: 'a', view: 'source' });
for (const sorting of ['default', 'a_z']) {
    await ask('structure', { class: 'a', obfuscation: 'all', documentation: 'all', sorting });
}
await ask('structure', { class: 'd', obfuscation: 'obfuscated', documentation: 'non_documented', sorting: 'z_a' });
for (const entry of [A, D, doBase, getName, field]) {
    await ask('hierarchy/inheritance', { entry });
    await ask('hierarchy/implementations', { entry });
    await ask('calls', { entry, recursive: true });
    await ask('calls', { entry, recursive: false });
    await ask('calls/incoming', { entry });
    await ask('calls/outgoing', { entry });
    await ask('nav/declaration', { entry, view: 'source' });
}
await ask('nav/reference', {
    entry: getName,
    context: { kind: 'method', owner: 'e', name: 'a', desc: '()Ljava/lang/String;' },
    view: 'source',
});
for (const name of ['a', 'd', 'e']) {
    await ask('hierarchy/supertypes', { class: name });
    await ask('hierarchy/subtypes', { class: name });
}
const hits = await ask<SearchResult[]>('search', { query: 'a', types: [], limit: 20 });
await ask('search', { query: 'Keep', types: ['class'], limit: 5 });
if (hits?.[0]) {
    await ask('search/hit', { id: hits[0].id });
}
await ask('stats/generate', {
    types: ['classes', 'methods', 'fields', 'parameters'],
    package: '',
    includeSynthetic: false,
    countFallback: false,
});
await ask('stats/classes', { includeSynthetic: false, countFallback: false });
await ask('stats/classes', { includeSynthetic: false, countFallback: false, classes: ['a', 'd'] });

await ask('entry/rename', { entry: getName, newName: 'getName', validateOnly: true });
await ask('entry/rename', { entry: getName, newName: 'class', validateOnly: true });
await ask('entry/rename', { entry: getName, newName: 'getName' });
await ask('entry/rename', { entry: getName, newName: 'class' });
await ask('entry/rename', { entry: A, newName: 'pkg/BaseClass' });
await ask('entry/rename', { entry: A, newName: 'pkg/BaseClass', confirmWarnings: true });
await ask('entry/rename', { entry: cls('java/lang/String'), newName: 'Text' });
await ask('entry/setJavadoc', { entry: getName, javadoc: 'The name.' });
await ask('entry/setJavadoc', { entry: getName, javadoc: 'bad */ comment' });
await ask('entry/toggleMapping', { entry: D });
await ask('entry/toggleMapping', { entry: D });
await settle();
await ask('entry/info', { entry: getName });
await ask('entry/info', { entry: A });
await ask('class/source', { class: 'a', view: 'source' });
await ask('classes/list');
await ask('edit/undo');
await ask('edit/redo');
await ask('edit/redo');
await ask('package/rename', { from: 'pkg', to: 'lib/core', mode: 'refactor' });
await ask('package/rename', { from: 'pkg', to: 'lib/core', mode: 'refactor', apply: true });
await ask('package/rename', { from: 'lib/core', to: 'moved', mode: 'move' });
await ask('project/state');
await ask('mappings/save');
const mappings = path.join(temp, 'saved.mapping');
await ask('mappings/save', { path: mappings, format: 'enigma:enigma_file' });
await ask('mappings/save', { path: path.join(mappings, 'cannot', 'exist.mapping'), format: 'enigma:enigma_file' });
await ask('mappings/save');
await ask('entry/rename', { entry: field, newName: 'name' });
await ask('mappings/snapshot', { path: path.join(temp, 'snapshot.mapping') });
await ask('mappings/reload');
await ask('mappings/restoreSnapshot', { path: path.join(temp, 'snapshot.mapping') });
await ask('mappings/close');
await ask('mappings/open', { path: mappings });
await ask('mappings/open', { path: path.join(temp, 'missing.mapping') });
fs.writeFileSync(path.join(temp, 'broken.mapping'), 'CLASS a\n\tNONSENSE here\n');
await ask('mappings/open', { path: path.join(temp, 'broken.mapping'), format: 'enigma:enigma_file' });
fs.appendFileSync(mappings, 'CLASS zz/gone Vanished\n');
await ask('mappings/reload');
await ask('mappings/drop');
await ask('export/source', { path: path.join(temp, 'src-out') });
await ask('export/jar', { path: path.join(temp, 'out.jar') });
await ask('decompiler/set', { id: 'enigma:cfr' });
await ask('decompiler/set', { id: 'nope' });
await settle();
await ask('class/reload', { class: 'a', view: 'source' });
await ask('class/close', { class: 'a', view: 'bytecode' });
await ask('collab/state');
await ask('collab/disconnect');
await ask('collab/sendMessage', { text: 'hello' });
await ask('collab/connect', { username: 'x', address: 'localhost:1', password: '' });
await ask('collab/host', { username: 'tester', port: 0, password: '' });
await ask('project/reload', { libraries: [] });
await ask('project/state');
await ask('project/closeJar');
await ask('project/state');
await ask('no/such/method');
await settle();
// progress is told as often as there is time for: only that it began and ended is the same every time
const told = engine.told
    .filter(one => one.name !== 'progress' || one.params.phase !== 'report')
    .map(one =>
        one.name === 'progress' ? { name: one.name, params: { ...one.params, id: 0, done: 0, total: 0, title: null, message: null } } : one,
    );
const recording: Recording = {
    log: sortKeys(log) as Recorded[],
    notifications: told.map(one => JSON.stringify(sortKeys(scrub(one)))).sort(),
};
fs.writeFileSync(out, JSON.stringify(recording, undefined, 1));
console.log(
    `${log.length} requests (${log.filter(entry => entry.error).length} answered with an error), ${recording.notifications.length} notifications -> ${out}`,
);
await engine.close();
fs.rmSync(temp, { recursive: true, force: true });
process.exit(0);
