import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

// Runs the end-to-end tests, measuring what of the extension they run, and fails when that is less than it was.
// ENIGMA_E2E_FILES runs part of them; what they leave out would only count as untested, so nothing is checked then.

const root = path.resolve(import.meta.dirname, '..');
const raw = path.join(root, 'build', 'coverage', 'e2e', 'raw');
/** A little below what the tests reach now, in percent; see build/coverage/e2e/index.html. */
const FLOORS = { lines: 90, branches: 79, functions: 87 };

const run = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env): number =>
    spawnSync(command, args, { cwd: root, env, stdio: 'inherit' }).status ?? 1;

fs.rmSync(raw, { recursive: true, force: true });
const status = run(process.execPath, [path.join(root, 'build', 'extension', 'test', 'e2e', 'runTest.js')], {
    ...process.env,
    ENIGMA_E2E_COVERAGE: raw,
});
if (status !== 0 || process.env.ENIGMA_E2E_FILES) {
    process.exit(status);
}

const c8 = createRequire(import.meta.url).resolve('c8/bin/c8.js');
const floors = Object.entries(FLOORS).map(([counter, minimum]) => `--${counter}=${minimum}`);
process.exit(run(process.execPath, [c8, 'report', '--check-coverage', ...floors]));
