import { EntryRef, SymbolKind } from '../engine/protocol';

/** A token as sent by the engine: [line, character, length, group, flags, category]. */
export type RefTuple = [line: number, character: number, length: number, group: number, flags: number, category: number];

export const FLAG_DECLARATION = 1;
export const FLAG_RENAMABLE = 2;

export const CATEGORY_NAMES = ['none', 'obfuscated', 'deobfuscated', 'proposed', 'fallback', 'debug'] as const;
export const CATEGORY_OBFUSCATED = 1;

export interface ZoneGroup {
    /** The entry that is renamed by editing a name of this group. */
    entry: EntryRef;
    kind: SymbolKind;
    /** Its full editable name: with the package, for top-level classes. */
    name: string;
}

/** A name in the source. */
export interface Zone {
    index: number;
    /** Offsets in the text the engine produced. */
    start: number;
    end: number;
    text: string;
    group: number;
    category: number;
    declaration: boolean;
    /** Whether the engine allows renaming it at all. */
    renamable: boolean;
    /** Whether it can be renamed by typing on it. */
    inline: boolean;
    /** What precedes the visible text in the full name: "com/example/" for the class com/example/Name. */
    prefix: string;
}

/** Where the zones are in a text that was edited. */
export interface ParsedText {
    starts: number[];
    ends: number[];
    /** Indices of the zones whose text differs from the original. */
    changed: number[];
}

// characters that may be part of a Java identifier
const IDENTIFIER_RUN = /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Sc}]*/uy;
const IDENTIFIER = /^[\p{L}\p{Nl}\p{Pc}\p{Sc}][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Sc}]*$/u;
const IDENTIFIER_CHAR = /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Sc}]/u;

const isIdentifierChar = (character: string | undefined) => {
    return character !== undefined && character.length > 0 && IDENTIFIER_CHAR.test(character);
}

/**
 * The text of a class as the engine produced it, cut into names and everything in between.
 *
 * Only names may change. An edited text is valid if it is the original text with some names replaced by other
 * identifiers, which {@link parse} checks. That makes validation independent of how the text was changed: typing,
 * pasting, undo, several cursors, or the editor mirroring an edit onto other occurrences.
 */
export class ZoneModel {
    readonly zones: Zone[] = [];
    /** The text between zones: gaps[i] precedes zone i, and the last one follows the last zone. */
    private readonly gaps: string[] = [];
    /** Whether the text can be edited in place at all. */
    readonly editable: boolean;

    constructor(readonly text: string, refs: RefTuple[], readonly groups: ZoneGroup[]) {
        const lineStarts = [0];
        for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
            lineStarts.push(i + 1);
        }

        let position = 0;
        for (const [line, character, length, group, flags, category] of refs) {
            if (line >= lineStarts.length || length <= 0) {
                continue;
            }

            const start = lineStarts[line] + character;
            const end = start + length;
            // names never overlap; anything else would make it impossible to tell which one was edited
            if (start < position || end > text.length) {
                continue;
            }

            const zoneText = text.substring(start, end);
            const renamable = (flags & FLAG_RENAMABLE) !== 0;
            const name = this.groups[group]?.name ?? '';
            // The visible text must be the end of the name that is edited, so that typing changes exactly that part:
            // "Name" of "com/example/Name". Anything else (a name shown differently than it is stored) is left to the
            // rename command.
            const prefixLength = name.length - zoneText.length;
            const prefix = prefixLength >= 0 && name.endsWith(zoneText) ? name.substring(0, prefixLength) : undefined;
            const inline = renamable
                && IDENTIFIER.test(zoneText)
                && prefix !== undefined && (prefix.length === 0 || prefix.endsWith('/'))
                // a name must be delimited by something that cannot be part of a name
                && !isIdentifierChar(text[start - 1]) && !isIdentifierChar(text[end]);

            this.gaps.push(text.substring(position, start));
            this.zones.push({
                index: this.zones.length, start, end, text: zoneText, group, category,
                declaration: (flags & FLAG_DECLARATION) !== 0, renamable, inline, prefix: prefix ?? '',
            });
            position = end;
        }

        this.gaps.push(text.substring(position));

        // if the original text itself does not read back as unchanged, something about it is unexpected: do not allow edits
        const self = this.parse(text);
        this.editable = self !== undefined && self.changed.length === 0 && this.zones.some(zone => zone.inline);
        if (self === undefined || self.changed.length > 0) {
            this.zones.forEach(zone => {
                zone.inline = false;
            });
        }
    }

    /** Positions of the zones in the unedited text. */
    get original(): ParsedText {
        return { starts: this.zones.map(zone => zone.start), ends: this.zones.map(zone => zone.end), changed: [] };
    }

    /**
     * Reads an edited text.
     * @returns where each zone is now and which ones changed, or undefined if anything but an editable name was changed
     */
    parse(current: string): ParsedText | undefined {
        const starts: number[] = new Array(this.zones.length);
        const ends: number[] = new Array(this.zones.length);
        const changed: number[] = [];
        let position = 0;

        for (let i = 0; i < this.zones.length; i++) {
            const gap = this.gaps[i];
            if (!current.startsWith(gap, position)) {
                return undefined;
            }

            position += gap.length;
            const zone = this.zones[i];
            starts[i] = position;
            if (zone.inline) {
                IDENTIFIER_RUN.lastIndex = position;
                const length = IDENTIFIER_RUN.exec(current)?.[0].length ?? 0;
                position += length;
                if (length !== zone.text.length || !current.startsWith(zone.text, starts[i])) {
                    changed.push(i);
                }
            } else {
                if (!current.startsWith(zone.text, position)) {
                    return undefined;
                }

                position += zone.text.length;
            }

            ends[i] = position;
        }

        const last = this.gaps[this.zones.length];
        if (current.length - position !== last.length || !current.startsWith(last, position)) {
            return undefined;
        }

        return { starts, ends, changed };
    }

    /** The zone at an offset of an edited text, counting both of its edges; -1 if there is none. */
    zoneAt(parsed: ParsedText, offset: number): number {
        let low = 0;
        let high = this.zones.length - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (parsed.ends[middle] < offset) {
                low = middle + 1;
            } else if (parsed.starts[middle] > offset) {
                high = middle - 1;
            } else {
                return middle;
            }
        }

        return -1;
    }

    /** The zones that show the same name as the given one and can be edited with it. */
    siblings(index: number): number[] {
        const group = this.zones[index].group;
        return this.zones.filter(zone => zone.group === group && zone.inline).map(zone => zone.index);
    }
}

export type EditVerdict =
    | { kind: 'unchanged' }
    /** Something that is not an editable name was changed, or names of different things were. */
    | { kind: 'invalid' }
    | { kind: 'rename'; group: number; zones: number[] };

/** Decides what an edited text means. */
export const judge = (model: ZoneModel, parsed: ParsedText | undefined): EditVerdict => {
    if (!parsed) {
        return { kind: 'invalid' };
    }

    if (parsed.changed.length === 0) {
        return { kind: 'unchanged' };
    }

    const group = model.zones[parsed.changed[0]].group;
    if (parsed.changed.some(index => model.zones[index].group !== group)) {
        return { kind: 'invalid' };
    }

    return { kind: 'rename', group, zones: parsed.changed };
}

/**
 * If {@code current} is {@code original} with text inserted somewhere, returns what was inserted.
 *
 * Used to give obfuscated names the behaviour of Enigma: typing on one replaces it instead of adding to it, as nobody
 * wants to keep part of "a" or "method_1234".
 */
export const insertedText = (original: string, current: string) => {
    if (current.length <= original.length) {
        return undefined;
    }

    let prefix = 0;
    while (prefix < original.length && original[prefix] === current[prefix]) {
        prefix++;
    }

    const suffix = original.length - prefix;
    return current.endsWith(original.substring(prefix)) ? current.substring(prefix, current.length - suffix) : undefined;
}

/** The smallest replacement that turns {@code from} into {@code to}. */
export const difference = (from: string, to: string) => {
    if (from === to) {
        return undefined;
    }

    let start = 0;
    const limit = Math.min(from.length, to.length);
    while (start < limit && from.charCodeAt(start) === to.charCodeAt(start)) {
        start++;
    }

    let fromEnd = from.length;
    let toEnd = to.length;
    while (fromEnd > start && toEnd > start && from.charCodeAt(fromEnd - 1) === to.charCodeAt(toEnd - 1)) {
        fromEnd--;
        toEnd--;
    }

    return { start, end: fromEnd, text: to.substring(start, toEnd) };
}

/**
 * The changes that turn one text of a class into another. Where only names differ, each name is replaced on its own,
 * which leaves the cursor and the scroll position of an editor where they are; otherwise it is one replacement.
 * @param model the names of the class, if known and editable
 * @param current
 * @param target
 */
export const changesBetween = (model: ZoneModel | undefined, current: string, target: string) => {
    if (model?.editable) {
        const from = model.parse(current);
        const to = from && (target === model.text ? model.original : model.parse(target));
        if (from && to) {
            const changes: { start: number; end: number; text: string }[] = [];
            for (let i = 0; i < model.zones.length; i++) {
                const text = target.substring(to.starts[i], to.ends[i]);
                if (current.substring(from.starts[i], from.ends[i]) !== text) {
                    changes.push({ start: from.starts[i], end: from.ends[i], text });
                }
            }

            return changes;
        }
    }

    const change = difference(current, target);
    return (change ? [change] : []) as { start: number; end: number; text: string }[];
}

/** The full name to rename to, given what was typed on a zone. */
export const newNameOf = (zone: Zone, typed: string) => {
    return zone.prefix + typed;
}
