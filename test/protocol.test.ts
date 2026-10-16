// Drives the packaged backend jar as a real child process over stdio, the way the extension does.
// Run with: bun run test:protocol
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorCode, type ErrorData, type Problem } from '../src/engine/protocol';
import { Engine, fixtures, isResponseError, methodEntry } from './engine';

/** The code of JSON-RPC for a request nobody answers. */
const METHOD_NOT_FOUND = -32601;

const temp = mkdtempSync(join(tmpdir(), 'enigma-vscode-'));
const engine = new Engine(temp);
/** Whether an error names what happened, with this key. */
function said(error: unknown, key: Problem): boolean {
    const data = isResponseError(error, ErrorCode.UserError) ? (error.data as ErrorData | undefined) : undefined;
    return data !== undefined && 'key' in data && data.key === key;
}

let failed = false;
try {
    const info = await engine.request('initialize', { language: 'en_us' });
    console.log(`backend up: Enigma ${info.enigmaVersion} on Java ${info.javaVersion}`);
    assert.ok(info.decompilers.some(decompiler => decompiler.id === 'enigma:vineflower'));
    assert.ok(info.formats.some(format => format.id === 'enigma:enigma_directory' && format.directory && format.read && format.write));
    assert.ok(info.vineflowerPreferences.length > 10);

    const state = await engine.request('project/openJar', { jar: join(fixtures, 'inheritance_tree.jar') });
    assert.equal(state.dirty, false);
    assert.ok(
        engine.told.some(told => told.name === 'progress' && told.params.phase === 'begin'),
        'progress is reported while opening',
    );
    assert.ok(engine.told.some(told => told.name === 'progress' && told.params.phase === 'end'));

    const classes = await engine.request('classes/list');
    assert.ok(classes.some(item => item.obf === 'a' && item.obfuscated));

    const before = await engine.request('class/source', { class: 'd' });
    assert.match(before.text, /class d extends a/);
    assert.ok(before.tokens.obfuscated.length > 0);

    // rename BaseClass.doBaseThings through the subclass that overrides it
    const seen = engine.told.length;
    const rename = await engine.request('entry/rename', { entry: methodEntry('d', 'a', '()V'), newName: 'doBaseThings' });
    assert.equal(rename.applied, true, JSON.stringify(rename));

    // open classes are refreshed through a notification, then re-read
    await engine.waitFor(
        'sourceChanged notification for the open class',
        told => told.name === 'sourceChanged' && told.params.class === 'd',
        seen,
    );
    const after = await engine.request('class/source', { class: 'd' });
    assert.match(after.text, /void doBaseThings\(\)/);
    assert.match((await engine.request('class/source', { class: 'a' })).text, /void doBaseThings\(\)/);
    assert.equal(after.tokens.deobfuscated.length > 0, true);

    // positions use lines and characters; the declaration can be found and queried back
    const declaration = await engine.request('nav/declaration', { entry: methodEntry('a', 'a', '()V') });
    assert.ok(declaration?.range, 'the declaration is found');
    const [line, character, length] = declaration.range;
    assert.equal(length, 'doBaseThings'.length);
    const lineText = (await engine.request('class/source', { class: 'a' })).text.split('\n')[line];
    assert.equal(lineText?.substring(character, character + length), 'doBaseThings');
    const at = await engine.request('class/entryAt', { class: 'a', line, character: character + 1 });
    assert.equal(at?.renameName, 'doBaseThings');

    // save, and check what ended up on disk
    const mappings = join(temp, 'out.mapping');
    const saved = await engine.request('mappings/save', { path: mappings, format: 'enigma:enigma_file' });
    assert.equal(saved.dirty, false);
    assert.match(readFileSync(mappings, 'utf8'), /METHOD a doBaseThings \(\)V/);

    // errors come back as JSON-RPC errors with a code
    await assert.rejects(engine.request('mappings/open', { path: join(temp, 'missing.mapping') }), error =>
        isResponseError(error, ErrorCode.UserError),
    );
    await assert.rejects(engine.send('no/such/method'), error => isResponseError(error, METHOD_NOT_FOUND));

    // The engine only logs failed saves. They must still surface as errors, which relies on the log capturing
    // writer being registered in the packaged jar next to tinylog's own writers.
    const unwritable = join(mappings, 'cannot', 'exist.mapping');
    await engine.request('entry/rename', { entry: methodEntry('a', 'a', '()Ljava/lang/String;'), newName: 'getName' });
    // named, not worded: the words are the client's
    await assert.rejects(engine.request('mappings/save', { path: unwritable, format: 'enigma:enigma_file' }), error =>
        said(error, 'save-failed'),
    );
    assert.equal((await engine.request('project/state')).dirty, true, 'a failed save must leave the project dirty');
    assert.equal((await engine.request('mappings/save')).dirty, false);
    assert.match(readFileSync(mappings, 'utf8'), /METHOD a getName \(\)Ljava\/lang\/String;/);

    // engine logs go to stderr, never to stdout
    writeFileSync(join(temp, 'stale.mapping'), 'CLASS zzz com/example/Gone\n');
    await engine.request('mappings/open', { path: join(temp, 'stale.mapping') });
    const dropped = await engine.request('mappings/drop');
    assert.equal(dropped.dropped.length, 1);
    assert.match(engine.log, /\[WARN]: Couldn't find zzz/, 'engine warnings are logged to stderr');

    await engine.request('shutdown');
    assert.deepEqual(engine.protocolErrors, [], 'nothing but protocol messages may be written to stdout');
    // the engine's default logging configuration would create build/logs in the working directory
    assert.equal(existsSync(join(temp, 'build')), false, 'the backend must not write log files into the working directory');
    console.log('protocol test passed');
} catch (error) {
    failed = true;
    console.error(error);
    console.error(`--- backend stderr ---\n${engine.log}`);
} finally {
    if (!(await engine.close())) {
        failed = true;
        console.error('the backend did not exit after its input was closed');
    }

    rmSync(temp, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
}
