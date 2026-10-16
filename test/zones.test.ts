// Unit tests of the constrained editor's rules (src/editor/zones.ts).
// Run with: npm run test:unit
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    ParsedText,
    RefTuple,
    ZoneGroup,
    ZoneModel,
    changesBetween,
    difference,
    insertedText,
    judge,
    newNameOf,
} from '../src/editor/zones';

const SOURCE = [
    'public class Base extends a {', // 0: Base (class, deobfuscated), a (class, obfuscated)
    '    private final String a;', // 1: String (library), a (field)
    '',
    '    public String a() {', // 3: String, a (method)
    '        return this.a + super.a();', // 4: a (field), a (method)
    '    }',
    '}',
    '',
].join('\n');

const DECL = 1,
    RENAMABLE = 2;
const GROUPS: [ZoneGroup, ZoneGroup, ZoneGroup, ZoneGroup, ZoneGroup] = [
    { entry: { kind: 'class', name: 'c' }, kind: 'class', name: 'com/example/Base' },
    { entry: { kind: 'class', name: 'a' }, kind: 'class', name: 'a' },
    { entry: { kind: 'class', name: 'java/lang/String' }, kind: 'class', name: 'java/lang/String' },
    { entry: { kind: 'field', owner: 'c', name: 'a', desc: 'Ljava/lang/String;' }, kind: 'field', name: 'a' },
    { entry: { kind: 'method', owner: 'c', name: 'a', desc: '()Ljava/lang/String;' }, kind: 'method', name: 'a' },
];
// [line, character, length, group, flags, category]
const REFS: RefTuple[] = [
    [0, 13, 4, 0, DECL | RENAMABLE, 2],
    [0, 26, 1, 1, RENAMABLE, 1],
    [1, 18, 6, 2, 0, 0],
    [1, 25, 1, 3, DECL | RENAMABLE, 1],
    [3, 11, 6, 2, 0, 0],
    [3, 18, 1, 4, DECL | RENAMABLE, 1],
    [4, 20, 1, 3, RENAMABLE, 1],
    [4, 30, 1, 4, RENAMABLE, 1],
];

const model = () => new ZoneModel(SOURCE, REFS, GROUPS);
/** A text as the model reads it; the tests that use this only edit names, which can always be read. */
function parsed(m: ZoneModel, text: string): ParsedText {
    const read = m.parse(text);
    assert.ok(read, 'the text is no longer the source with other names');
    return read;
}

/** Replaces the text of some zones, like the editor would. */
function edit(m: ZoneModel, replacements: Record<number, string>): string {
    let text = '';
    let position = 0;
    for (const zone of m.zones) {
        text += SOURCE.substring(position, zone.start) + (replacements[zone.index] ?? zone.text);
        position = zone.end;
    }

    return text + SOURCE.substring(position);
}

describe('zones', () => {
    it('reads the names of a source', () => {
        const m = model();
        assert.deepEqual(
            m.zones.map(zone => zone.text),
            ['Base', 'a', 'String', 'a', 'String', 'a', 'a', 'a'],
        );
        assert.deepEqual(
            m.zones.map(zone => zone.inline),
            [true, true, false, true, false, true, true, true],
        );
        assert.equal(m.editable, true);
        assert.deepEqual(judge(m, m.parse(SOURCE)), { kind: 'unchanged' });
        assert.deepEqual(m.original.starts, parsed(m, SOURCE).starts);
    });

    it('accepts edits of a name, and tracks where everything moved to', () => {
        const m = model();
        const text = edit(m, { 3: 'name' });
        const read = parsed(m, text);
        assert.deepEqual(judge(m, read), { kind: 'rename', group: 3, zones: [3] });
        for (const zone of m.zones) {
            assert.equal(text.substring(read.starts[zone.index], read.ends[zone.index]), zone.index === 3 ? 'name' : zone.text);
        }

        // all occurrences changing together is the same rename: that is what the editor's linked editing produces
        assert.deepEqual(judge(m, m.parse(edit(m, { 3: 'name', 6: 'name' }))), { kind: 'rename', group: 3, zones: [3, 6] });
        // ... as is the state in between, when only some of them have been updated yet
        assert.deepEqual(judge(m, m.parse(edit(m, { 5: 'getNa', 7: 'getName' }))), { kind: 'rename', group: 4, zones: [5, 7] });
    });

    it('keeps different things with the same name apart', () => {
        const m = model();
        // the field "a" and the method "a" look the same; changing both at once is not one rename
        assert.deepEqual(judge(m, m.parse(edit(m, { 3: 'x', 5: 'x' }))), { kind: 'invalid' });
        assert.deepEqual(m.siblings(3), [3, 6]);
        assert.deepEqual(m.siblings(5), [5, 7]);
    });

    it('allows a name to be emptied or extended at either end while typing', () => {
        const m = model();
        assert.deepEqual(judge(m, m.parse(edit(m, { 1: '' }))), { kind: 'rename', group: 1, zones: [1] });
        assert.deepEqual(judge(m, m.parse(edit(m, { 1: 'Parent' }))).kind, 'rename');
        const prepended = SOURCE.replace('String a;', 'String xa;');
        assert.deepEqual(judge(m, m.parse(prepended)), { kind: 'rename', group: 3, zones: [3] });
        const appended = SOURCE.replace('String a;', 'String ax;');
        assert.deepEqual(judge(m, m.parse(appended)), { kind: 'rename', group: 3, zones: [3] });
        assert.deepEqual(judge(m, m.parse(SOURCE.replace('String a;', 'String a_1$é;'))).kind, 'rename');
    });

    it('refuses everything that is not an editable name', () => {
        const m = model();
        const invalid = (text: string) =>
            assert.deepEqual(judge(m, m.parse(text)), { kind: 'invalid' }, text.split('\n').slice(0, 5).join(' / '));
        invalid(SOURCE.replace('public class', 'publicx class')); // a keyword
        invalid(SOURCE.replace('private final', 'private  final')); // whitespace
        invalid(SOURCE.replace('String a;', 'Strin a;')); // a library class
        invalid(SOURCE.replace('String a;', 'String a;\n')); // a new line
        invalid(SOURCE.replace('String a;', 'String a b;')); // a space inside a name
        invalid(SOURCE.replace('String a;', 'String a.b;')); // punctuation inside a name
        invalid(SOURCE.replace('    }\n', '')); // deleted code
        invalid(SOURCE + ' '); // trailing text
        invalid('');
        invalid(SOURCE.replace('String a;', 'String a;x')); // right after the delimiter of a name
    });

    it('edits only the visible part of a class name, keeping its package', () => {
        const m = model();
        assert.equal(m.zones[0].prefix, 'com/example/');
        assert.equal(newNameOf(m.zones[0], 'BaseClass'), 'com/example/BaseClass');
        assert.equal(newNameOf(m.zones[3], 'name'), 'name');
    });

    it('leaves names that cannot be edited safely to the rename command', () => {
        // shown differently than it is stored
        const renamed = new ZoneModel(
            SOURCE,
            REFS,
            GROUPS.map((group, i) => (i === 0 ? { ...group, name: 'com/example/Other' } : group)),
        );
        assert.equal(renamed.zones[0]?.inline, false);
        assert.equal(renamed.zones[0]?.renamable, true);
        assert.deepEqual(judge(renamed, renamed.parse(edit(renamed, { 0: 'Base2' }))), { kind: 'invalid' });

        // two names without anything between them could not be told apart after an edit
        const adjacent = new ZoneModel(
            'ab = 1;',
            [
                [0, 0, 1, 0, RENAMABLE, 1],
                [0, 1, 1, 1, RENAMABLE, 1],
            ],
            [GROUPS[3], GROUPS[4]],
        );
        assert.deepEqual(
            adjacent.zones.map(zone => zone.inline),
            [false, false],
        );
        assert.equal(adjacent.editable, false);
        assert.deepEqual(judge(adjacent, adjacent.parse('ab = 1;')), { kind: 'unchanged' });

        // tokens that are not identifiers, out of order, overlapping or out of range are ignored rather than trusted
        const odd = new ZoneModel(
            'a b',
            [
                [0, 2, 1, 3, RENAMABLE, 1],
                [0, 0, 1, 3, RENAMABLE, 1],
                [5, 0, 1, 3, RENAMABLE, 1],
                [0, 2, 9, 3, RENAMABLE, 1],
            ],
            GROUPS,
        );
        assert.deepEqual(
            odd.zones.map(zone => zone.text),
            ['b'],
        );

        // bytecode and sources without renamable names are not editable at all
        const fixed = new ZoneModel(
            SOURCE,
            REFS.map((ref): RefTuple => [ref[0], ref[1], ref[2], ref[3], ref[4] & ~RENAMABLE, ref[5]]),
            GROUPS,
        );
        assert.equal(fixed.editable, false);
        assert.deepEqual(judge(fixed, fixed.parse(edit(fixed, { 3: 'x' }))), { kind: 'invalid' });
    });

    it('finds the name at a position of an edited text', () => {
        const m = model();
        const text = edit(m, { 3: 'name', 6: 'name' });
        const read = parsed(m, text);
        const offset = text.indexOf('String name;') + 'String '.length;
        assert.equal(m.zoneAt(read, offset), 3); // at its start
        assert.equal(m.zoneAt(read, offset + 2), 3); // inside
        assert.equal(m.zoneAt(read, offset + 4), 3); // at its end: typing there extends it
        assert.equal(m.zoneAt(read, offset + 5), -1);
        assert.equal(m.zoneAt(read, 0), -1);
        assert.equal(m.zoneAt(read, text.indexOf('super.a()') + 6), 7);
    });

    it('detects what was typed on a name', () => {
        assert.equal(insertedText('a', 'ax'), 'x');
        assert.equal(insertedText('a', 'xa'), 'x');
        assert.equal(insertedText('a', 'aa'), 'a');
        assert.equal(insertedText('method_12', 'method_x12'), 'x');
        assert.equal(insertedText('ab', 'axyb'), 'xy');
        assert.equal(insertedText('ab', 'b'), undefined);
        assert.equal(insertedText('ab', 'xy'), undefined);
        assert.equal(insertedText('ab', 'ab'), undefined);
        assert.equal(insertedText('ab', 'axc'), undefined);
    });

    it('computes minimal replacements', () => {
        assert.equal(difference('same', 'same'), undefined);
        assert.deepEqual(difference('abcdef', 'abXYef'), { start: 2, end: 4, text: 'XY' });
        assert.deepEqual(difference('abc', 'abcd'), { start: 3, end: 3, text: 'd' });
        assert.deepEqual(difference('abcd', 'abc'), { start: 3, end: 4, text: '' });
        assert.deepEqual(difference('aaa', 'aa'), { start: 2, end: 3, text: '' });
        assert.deepEqual(difference('', 'x'), { start: 0, end: 0, text: 'x' });
    });

    it('is fast enough to run on every keystroke of a large class', () => {
        const lines: string[] = [];
        const refs: RefTuple[] = [];
        for (let i = 0; i < 20000; i++) {
            lines.push(`        this.field_${i} = other.method_${i}(argument);`);
            refs.push([i, 13, `field_${i}`.length, 0, RENAMABLE, 1]);
        }

        const text = lines.join('\n');
        const large = new ZoneModel(text, refs, [{ ...GROUPS[3], name: '' }]);
        // names differ per line here, so none is "inline"; give each its own exact name instead
        const exact = new ZoneModel(
            text,
            refs.map((ref, i): RefTuple => [ref[0], ref[1], ref[2], i, ref[4], ref[5]]),
            refs.map((_, i) => ({ ...GROUPS[3], name: `field_${i}` })),
        );
        assert.equal(exact.editable, true);
        assert.equal(large.editable, false);

        const edited = text.replace('field_19999', 'renamed');
        // the fastest of several runs: what the work takes, rather than what else the machine is doing meanwhile
        let milliseconds = Infinity;
        for (let i = 0; i < 20; i++) {
            const started = process.hrtime.bigint();
            assert.equal(judge(exact, exact.parse(edited)).kind, 'rename');
            milliseconds = Math.min(milliseconds, Number(process.hrtime.bigint() - started) / 1e6);
        }

        assert.ok(milliseconds < 25, `parsing ${text.length} characters with 20000 names took ${milliseconds.toFixed(2)} ms`);
        console.log(
            `    parsing a ${Math.round(text.length / 1024)} KB class with 20000 names: ${milliseconds.toFixed(2)} ms per keystroke`,
        );
    });
});

describe('bringing a text in line with another', () => {
    const apply = (text: string, changes: { start: number; end: number; text: string }[]) =>
        [...changes]
            .sort((a, b) => b.start - a.start)
            .reduce((result, change) => result.substring(0, change.start) + change.text + result.substring(change.end), text);

    it('replaces each name on its own where only names differ', () => {
        const m = model();
        // the method is being typed: its declaration and its call show another name
        const typed = edit(m, { 5: 'getName', 7: 'getName' });
        const changes = changesBetween(m, typed, SOURCE);
        assert.deepEqual(
            changes.map(change => change.text),
            ['a', 'a'],
        );
        assert.ok(changes.every(change => typed.substring(change.start, change.end) === 'getName'));
        assert.equal(apply(typed, changes), SOURCE);
    });

    it('goes from one typed state to another', () => {
        const m = model();
        const from = edit(m, { 5: 'get', 7: 'a' });
        const to = edit(m, { 5: 'get', 7: 'get' });
        const changes = changesBetween(m, from, to);
        assert.equal(changes.length, 1);
        assert.equal(apply(from, changes), to);
    });

    it('falls back to one replacement when more than names differ, or nothing is known about the names', () => {
        const m = model();
        const broken = SOURCE.replace('private final', 'private  final');
        assert.equal(changesBetween(m, broken, SOURCE).length, 1);
        assert.equal(apply(broken, changesBetween(m, broken, SOURCE)), SOURCE);

        const typed = edit(m, { 5: 'getName', 7: 'getName' });
        assert.equal(changesBetween(undefined, typed, SOURCE).length, 1);
        assert.equal(apply(typed, changesBetween(undefined, typed, SOURCE)), SOURCE);
    });

    it('has nothing to do for equal texts', () => {
        assert.deepEqual(changesBetween(model(), SOURCE, SOURCE), []);
        assert.deepEqual(changesBetween(undefined, SOURCE, SOURCE), []);
    });
});
