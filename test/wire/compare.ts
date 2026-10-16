// Compares two recordings of test/wire/record.ts: what the engine said before a change of its code and after.
//
// Usage: bun test/wire/compare.ts before.json after.json   (fails if a request is answered differently)
import * as fs from 'node:fs';
import type { Recorded, Recording } from './record';

/** Fields that mean the same absent as with nothing for a value. */
const OPTIONAL = new Set(['outerClass', 'superClass', 'context', 'type', 'range']);
/** How many differences are shown in full. */
const MAX_SHOWN = 6;

const sorted = (value: unknown): string => JSON.stringify(value, (_, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : inner);
const isStatsNodes = (value: unknown): value is object[] => Array.isArray(value) && typeof value[0] === 'object' && value[0] !== null && 'value' in value[0];

/** Brings what may differ without meaning anything into one form: absent fields, and lists whose order is not kept. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.fromEntries(Object.entries(value)
        .filter(([key, inner]) => !(inner === null && OPTIONAL.has(key)))
        .map(([key, inner]) => {
            if (key === 'editable' && Array.isArray(inner)) {
                return [key, [...inner].sort()];
            }

            // the packages of the statistics come in the order of a hash map
            return [key, key === 'children' && isStatsNodes(inner) ? inner.map(canonical).sort((a, b) => sorted(a).localeCompare(sorted(b))) : canonical(inner)];
        }));
}

function read(file: string): Recording {
    const recording = JSON.parse(fs.readFileSync(file, 'utf8')) as Recording;
    return {
        log: canonical(recording.log) as Recorded[],
        notifications: recording.notifications.map(one => sorted(canonical(JSON.parse(one)))),
    };
}

const [beforeFile, afterFile] = process.argv.slice(2);
if (!beforeFile || !afterFile) {
    console.error('Usage: bun test/wire/compare.ts <before> <after>');
    process.exit(2);
}

const before = read(beforeFile);
const after = read(afterFile);
let different = Math.abs(before.log.length - after.log.length);
before.log.forEach((asked, index) => {
    const was = sorted(asked);
    const is = sorted(after.log[index]);
    if (was === is || after.log[index] === undefined) {
        return;
    }

    if (++different <= MAX_SHOWN) {
        const at = [...was].findIndex((character, position) => character !== is[position]);
        console.log('DIFFERS', asked.method, JSON.stringify(asked.params).substring(0, 80));
        console.log('   before:', was.substring(Math.max(0, at - 90), at + 110));
        console.log('   after: ', is.substring(Math.max(0, at - 90), at + 110));
    }
});

const onlyBefore = before.notifications.filter(one => !after.notifications.includes(one));
const onlyAfter = after.notifications.filter(one => !before.notifications.includes(one));
console.log(`${before.log.length} requests, ${different} answered differently; kinds of notification only before: ${new Set(onlyBefore).size}, only after: ${new Set(onlyAfter).size}`);
[...onlyBefore.slice(0, 3), ...onlyAfter.slice(0, 3)].forEach(one => console.log('   ', one.substring(0, 260)));
process.exit(different > 0 ? 1 : 0);
