import * as fs from 'node:fs';
import * as path from 'node:path';
import Mocha from 'mocha';

// The console of the extension host is not reliably flushed when the editor exits, so results are also written to a
// file that the launcher prints.
export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'bdd', color: false, timeout: 120000, bail: false });
    // in the order of their names: the files build on each other
    for (const file of fs.readdirSync(__dirname).sort()) {
        if (file.endsWith('.test.js')) {
            mocha.addFile(path.join(__dirname, file));
        }
    }

    const resultsFile = process.env.ENIGMA_E2E_RESULTS;
    const lines: string[] = [];
    const record = (line: string) => {
        lines.push(line);
        if (resultsFile) {
            fs.writeFileSync(resultsFile, lines.join('\n') + '\n');
        }
    };

    return new Promise((resolve, reject) => {
        try {
            const runner = mocha.run(failures => {
                const notes: string[] = ((globalThis as any).enigmaTestTrace ?? []).filter((line: string) => line.startsWith('[test] keys do not reach'));
                notes.forEach(note => record(`  note ${note.substring('[test] '.length)}`));
                record(`${failures === 0 ? 'PASSED' : 'FAILED'}: ${runner.stats?.passes ?? 0} passing, ${failures} failing`);
                if (failures > 0) {
                    reject(new Error(`${failures} test(s) failed`));
                } else {
                    resolve();
                }
            });
            runner.on('pass', test => record(`  ok   ${test.title} (${test.duration}ms)`));
            runner.on('fail', (test, error) => {
                // what the extension logged while the test ran explains most failures
                const trace: string[] = (globalThis as any).enigmaTestTrace ?? [];
                const text = `${error?.stack ?? error}\n--- log ---\n${trace.slice(-30).join('\n')}`;
                record(`  FAIL ${test.fullTitle()}\n${text.split('\n').map(line => `         ${line}`).join('\n')}`);
            });
        } catch (error) {
            record(`FAILED to start: ${error instanceof Error ? error.stack : error}`);
            reject(error);
        }
    });
}
