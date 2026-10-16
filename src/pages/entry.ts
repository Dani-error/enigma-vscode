import type { EmptyMessage, EntryField, FromEntryPage, PaneEntry, Problem, ToEntryPage } from '../panes/messages';
import { Child, connect, h, icon, root, t } from './dom';

// The "Identifier" pane: what Enigma shows in its identifier panel and its javadoc dialog, for the name under the cursor.
// Plain DOM code, no framework: the extension sends a description of the entry and this renders it.

/** The parts of the page that are read or changed after they were built. There are none while no entry is shown. */
interface Elements {
    name: HTMLInputElement;
    nameMessage: HTMLDivElement;
    javadoc: HTMLTextAreaElement;
    javadocMessage: HTMLDivElement;
    saveJavadoc: HTMLButtonElement;
    revertJavadoc: HTMLButtonElement;
    banner: HTMLDivElement;
}

/** A tag of Enigma's javadoc dialog. Inline tags wrap the selection and leave the cursor inside the braces. */
type Tag = { label: string } & ({ tag: string; inline: boolean } | { html: string });

const TAGS: Tag[] = [
    { label: '{@code}', tag: '@code', inline: true },
    { label: '{@link}', tag: '@link', inline: true },
    { label: '{@linkplain}', tag: '@linkplain', inline: true },
    { label: '{@value}', tag: '@value', inline: true },
    { label: '@return', tag: '@return', inline: false },
    { label: '@see', tag: '@see', inline: false },
    { label: '@throws', tag: '@throws', inline: false },
    { label: '<p>', html: 'p' },
    { label: '<code>', html: 'code' },
    { label: '<b>', html: 'b' },
    { label: '<i>', html: 'i' },
    { label: '<ul>', html: 'ul' },
    { label: '<li>', html: 'li' },
];

/** How long typing has to pause before the name is checked. */
const VALIDATION_DELAY_MS = 180;
const isMac = navigator.platform.toUpperCase().includes('MAC');

/** The entry on display, as sent by the extension. */
let entry: PaneEntry | null = null;
/** An entry the extension sent while there were unsaved edits here; shown once they are dealt with. */
let pending: PaneEntry | null | undefined;
let nameDirty = false;
let javadocDirty = false;
let validationRequest = 0;
let validationTimer: number | undefined;
let elements: Elements | undefined;
let emptyMessage: EmptyMessage = { title: t('common.noNameSelected'), detail: t('common.placeTheCursorOnAHighlighted') };

const post = connect<ToEntryPage, FromEntryPage>(receive);

/** A name or descriptor that, where it has to be broken into lines, breaks after its separators rather than anywhere. */
function breakable(text: string): Child[] {
    return text.split(/(?<=[/.$;,(])/).flatMap((part, index) => index === 0 ? [part] : [document.createElement('wbr'), part]);
}

function setMessage(target: HTMLElement, problem: Problem | null | undefined): void {
    target.className = problem ? `message ${problem.severity}` : 'message hidden';
    target.textContent = problem ? problem.message : '';
}

function updateDirty(): void {
    post({ type: 'dirty', dirty: nameDirty || javadocDirty });
    if (elements) {
        elements.saveJavadoc.disabled = !javadocDirty;
        elements.revertJavadoc.disabled = !javadocDirty;
    }
}


function resetName(shown: PaneEntry, page: Elements): void {
    page.name.value = shown.name;
    page.name.classList.remove('invalid', 'warning');
    nameDirty = false;
    setMessage(page.nameMessage, undefined);
    updateDirty();
}

function onNameInput(shown: PaneEntry, page: Elements): void {
    nameDirty = page.name.value !== shown.name;
    updateDirty();
    clearTimeout(validationTimer);
    const request = ++validationRequest;
    if (!nameDirty) {
        page.name.classList.remove('invalid', 'warning');
        setMessage(page.nameMessage, undefined);
        return;
    }

    validationTimer = window.setTimeout(() => post({ type: 'validate', key: shown.key, name: page.name.value.trim(), request }), VALIDATION_DELAY_MS);
}

function submitName(shown: PaneEntry, page: Elements): void {
    const name = page.name.value.trim();
    if (name === shown.name) {
        resetName(shown, page);
        return;
    }

    clearTimeout(validationTimer);
    validationRequest++;
    page.name.disabled = true;
    post({ type: 'rename', key: shown.key, name });
}


function insertTag(tag: Tag, shown: PaneEntry, page: Elements): void {
    const area = page.javadoc;
    if (area.disabled) {
        return;
    }

    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = area.value.substring(start, end);
    let text: string;
    let caret: number;
    if ('html' in tag) {
        text = selected ? `<${tag.html}>${selected}</${tag.html}>` : `<${tag.html}>`;
        caret = start + text.length;
    } else if (tag.inline) {
        text = `{${tag.tag} ${selected}}`;
        caret = start + text.length - 1;
    } else {
        text = `${tag.tag} ${selected}`;
        caret = start + text.length;
    }

    area.focus();
    area.setRangeText(text, start, end, 'end');
    area.setSelectionRange(caret, caret);
    onJavadocInput(shown, page);
}

function onJavadocInput(shown: PaneEntry, page: Elements): void {
    javadocDirty = page.javadoc.value !== shown.javadoc;
    setMessage(page.javadocMessage, undefined);
    updateDirty();
}

function saveJavadoc(shown: PaneEntry, page: Elements): void {
    if (javadocDirty) {
        page.saveJavadoc.disabled = true;
        post({ type: 'saveJavadoc', key: shown.key, text: page.javadoc.value });
    }
}

function revertJavadoc(shown: PaneEntry, page: Elements): void {
    page.javadoc.value = shown.javadoc;
    javadocDirty = false;
    setMessage(page.javadocMessage, undefined);
    updateDirty();
    showPending();
}

function showPending(): void {
    if (pending !== undefined && !nameDirty && !javadocDirty) {
        const next = pending;
        pending = undefined;
        show(next);
    }
}

function renderEmpty(message: EmptyMessage): void {
    elements = undefined;
    root.replaceChildren(h('div', { class: 'pane' },
        h('div', { class: 'empty' },
            icon('symbol-field'),
            h('p', { text: message.title }),
            h('p', { class: 'muted', text: message.detail }))));
}

function render(shown: PaneEntry): Elements {
    const page: Elements = {
        name: h('input', {
            type: 'text', class: 'mono', spellcheck: 'false', autocomplete: 'off', value: shown.name,
            disabled: !shown.renamable, 'aria-label': t('entryPage.name'), title: shown.renamable ? shown.nameHint : shown.lockedReason,
            oninput: () => onNameInput(shown, page),
            onkeydown: event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    submitName(shown, page);
                } else if (event.key === 'Escape') {
                    resetName(shown, page);
                    page.name.blur();
                }
            },
        }),
        nameMessage: h('div', { class: 'message hidden', role: 'status' }),
        javadoc: h('textarea', {
            class: 'mono', spellcheck: 'true', rows: '5', disabled: !shown.documentable,
            placeholder: shown.documentable ? t('entryPage.describeWhatThisDoes') : t('entryPage.thisEntryCannotBeDocumented'),
            'aria-label': t('entryPage.javadoc'),
            oninput: () => onJavadocInput(shown, page),
            onkeydown: event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    saveJavadoc(shown, page);
                } else if (event.key === 'Escape' && javadocDirty) {
                    revertJavadoc(shown, page);
                }
            },
        }),
        javadocMessage: h('div', { class: 'message hidden', role: 'status' }),
        saveJavadoc: h('button', { disabled: true, onclick: () => saveJavadoc(shown, page), text: t('entryPage.saveJavadoc') }),
        revertJavadoc: h('button', { class: 'secondary', disabled: true, onclick: () => revertJavadoc(shown, page), text: t('entryPage.revert') }),
        banner: h('div', { class: 'banner hidden' }),
    };
    page.javadoc.value = shown.javadoc;

    const facts = h('dl', { class: 'facts' }, shown.facts.map(fact => [
        h('dt', { text: fact.label }),
        h('dd', { class: fact.mono ? 'mono' : undefined, title: fact.value }, breakable(fact.value)),
        h('dd', { class: 'action' },
            fact.copy ? h('button', {
                class: 'icon', title: t('entryPage.copy', fact.label), 'aria-label': t('entryPage.copy', fact.label),
                onclick: () => post({ type: 'copy', text: fact.value }),
            }, icon('copy')) : undefined),
    ]));

    const act = (action: PaneEntry['actions'][number]) => () => post({ type: 'action', key: shown.key, id: action.id });
    const saveKey = isMac ? '⌘↵' : 'Ctrl+Enter';

    // Sections rather than one column: the pane is laid out by its width (see panes.css). Stacked in a side bar,
    // side by side in the panel at the bottom, where there is width to spare and little height. There, where to go
    // from this entry is a row of icons next to its kind; in a side bar, buttons with their names at the end.
    root.replaceChildren(h('div', { class: 'pane entry' },
        page.banner,
        h('section', { class: 'identity' },
            h('div', { class: 'kind' }, icon(shown.icon), h('span', { class: 'label', text: shown.kindLabel }),
                h('span', { class: 'toolbar' }, shown.actions.map(action =>
                    h('button', { class: 'icon', title: action.title || action.label, 'aria-label': action.label, onclick: act(action) }, icon(action.icon)))),
                h('span', { class: 'spacer' }),
                h('span', { class: `state ${shown.state}`, text: shown.stateLabel })),
            page.name,
            page.nameMessage,
            shown.renamable
                ? h('div', { class: 'message info hint', text: shown.nameHint })
                : h('div', { class: 'message info', text: shown.lockedReason })),
        h('section', { class: 'details' }, facts,
            shown.toggle ? h('div', { class: 'buttons' },
                h('button', { class: 'secondary', title: shown.toggle.title, onclick: () => post({ type: 'toggle', key: shown.key }), text: shown.toggle.label })) : undefined),
        h('hr'),
        h('section', { class: 'javadoc' },
            h('h2', { text: t('entryPage.javadoc') }),
            page.javadoc,
            shown.documentable ? h('div', { class: 'chips', 'aria-label': t('entryPage.insertTag') }, TAGS.map(tag =>
                h('button', { title: t('entryPage.insert', tag.label), onclick: () => insertTag(tag, shown, page), text: tag.label }))) : undefined,
            page.javadocMessage,
            shown.documentable ? h('div', { class: 'buttons' },
                page.saveJavadoc, page.revertJavadoc,
                h('span', { class: 'muted' }, h('kbd', { text: saveKey }), ` ${t('entryPage.toSave')}`)) : undefined),
        shown.actions.length > 0 ? h('hr', { class: 'actions' }) : undefined,
        shown.actions.length > 0 ? h('section', { class: 'actions' },
            h('div', { class: 'buttons' }, shown.actions.map(action =>
                h('button', { class: 'secondary', title: action.title, onclick: act(action) }, icon(action.icon), action.label)))) : undefined));
    return page;
}

function show(next: PaneEntry | null): void {
    // unsaved edits belong to the entry they were made on: keep it on display until they are saved or discarded
    if ((nameDirty || javadocDirty) && entry && next?.key !== entry.key) {
        pending = next;
        if (elements) {
            elements.banner.replaceChildren(icon('pinned'), h('span', { text: t('entryPage.unsavedChangesToSaveOrRevert', entry.displayName) }));
            elements.banner.classList.remove('hidden');
        }

        return;
    }

    pending = undefined;
    const previous = entry && next && entry.key === next.key ? elements : undefined;
    if (previous && JSON.stringify(entry) === JSON.stringify(next)) {
        // the cursor moved within the name, or onto another occurrence of it: there is nothing new to show
        previous.banner.classList.add('hidden');
        return;
    }

    const keepName = previous && nameDirty ? previous.name.value : undefined;
    const keepJavadoc = previous && javadocDirty ? previous.javadoc.value : undefined;
    // What was focused here only counts while the pane has the keyboard. A page remembers its last focused field
    // also after the keyboard went elsewhere, and focusing it again would take the keyboard away from where it
    // is now: the code, or the find box that is moving the cursor from match to match.
    const focused = previous && document.hasFocus() ? document.activeElement : undefined;
    const refocus: EntryField | undefined = focused === previous?.name ? 'name' : focused === previous?.javadoc ? 'javadoc' : undefined;
    const selection = previous && refocus ? [previous[refocus].selectionStart, previous[refocus].selectionEnd] as const : undefined;

    entry = next;
    if (!next) {
        nameDirty = javadocDirty = false;
        renderEmpty(emptyMessage);
        updateDirty();
        return;
    }

    const page = elements = render(next);
    if (keepName !== undefined) {
        page.name.value = keepName;
        onNameInput(next, page);
    } else {
        nameDirty = false;
    }

    if (keepJavadoc !== undefined) {
        page.javadoc.value = keepJavadoc;
        javadocDirty = keepJavadoc !== next.javadoc;
    } else {
        javadocDirty = false;
    }

    if (refocus) {
        page[refocus].focus();
        if (selection) {
            page[refocus].setSelectionRange(selection[0], selection[1]);
        }
    }

    updateDirty();
}

function receive(message: ToEntryPage): void {
    if (message.type === 'entry') {
        emptyMessage = message.empty;
        show(message.entry);
        return;
    }

    // everything else is about the entry on display
    const shown = entry;
    const page = elements;
    if (!shown || !page || (message.type !== 'focus' && message.key !== shown.key)) {
        return;
    }

    switch (message.type) {
        case 'validation':
            if (message.request === validationRequest && nameDirty) {
                page.name.classList.toggle('invalid', message.problem?.severity === 'error');
                page.name.classList.toggle('warning', message.problem?.severity === 'warning');
                setMessage(page.nameMessage, message.problem);
            }

            break;
        case 'renameResult':
            page.name.disabled = !shown.renamable;
            if (message.problem) {
                page.name.classList.add('invalid');
                setMessage(page.nameMessage, message.problem);
                page.name.focus();
            } else {
                // the extension follows up with the renamed entry
                nameDirty = false;
                updateDirty();
                showPending();
            }

            break;
        case 'javadocResult':
            if (message.problem) {
                setMessage(page.javadocMessage, message.problem);
                page.saveJavadoc.disabled = false;
            } else {
                shown.javadoc = page.javadoc.value;
                javadocDirty = false;
                setMessage(page.javadocMessage, { severity: 'info', message: t('entryPage.savedToTheMappings') });
                updateDirty();
                showPending();
            }

            break;
        case 'focus': {
            const field = page[message.field];
            if (!field.disabled) {
                field.focus();
                if (message.field === 'name') {
                    // like Enigma: the part after the package is what one usually wants to replace
                    field.setSelectionRange(field.value.lastIndexOf('/') + 1, field.value.length);
                }
            }

            break;
        }
    }
}

renderEmpty(emptyMessage);
post({ type: 'ready' });
