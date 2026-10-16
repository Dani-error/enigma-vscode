import { Fragment, render } from 'preact';
import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EmptyMessage, FromEntryPage, PaneEntry, Problem, ToEntryPage } from '../panes/messages';
import { Empty, Icon, ProblemLine, channel, t, useDebounced } from './shared';

// The "Identifier" pane: what Enigma shows in its identifier panel and its javadoc dialog, for the name under the cursor.
// The extension sends a description of the entry (see entryDescription.ts) and this renders it.

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

const { post, useMessages } = channel<ToEntryPage, FromEntryPage>();

/** The entry on display, and what was done to it here. */
interface Shown {
    entry: PaneEntry;
    name: string;
    nameDirty: boolean;
    nameProblem: Problem | null;
    /** How the name field looks: as what is wrong with the name, or as nothing. */
    nameLook: 'invalid' | 'warning' | '';
    renaming: boolean;
    javadoc: string;
    javadocDirty: boolean;
    javadocProblem: Problem | null;
    savingJavadoc: boolean;
}

interface State {
    shown?: Shown;
    /** An entry the extension sent while there were unsaved edits here; shown once they are dealt with. */
    pending?: PaneEntry | null;
    empty: EmptyMessage;
}

const fresh = (entry: PaneEntry): Shown => ({
    entry,
    name: entry.name,
    nameDirty: false,
    nameProblem: null,
    nameLook: '',
    renaming: false,
    javadoc: entry.javadoc,
    javadocDirty: false,
    javadocProblem: null,
    savingJavadoc: false,
});

const isDirty = (shown: Shown | undefined) => !!shown && (shown.nameDirty || shown.javadocDirty);

/** What is on display once the extension sent an entry: unsaved edits keep the entry they belong to. */
function show(state: State, next: PaneEntry | null): State {
    const shown = state.shown;
    if (isDirty(shown) && next?.key !== shown!.entry.key) {
        return { ...state, pending: next };
    }

    if (!next) {
        return { empty: state.empty };
    }

    if (shown?.entry.key !== next.key) {
        return { empty: state.empty, shown: fresh(next) };
    }

    // the same entry: what is being typed stays
    return {
        empty: state.empty,
        shown: {
            ...shown,
            entry: next,
            name: shown.nameDirty ? shown.name : next.name,
            // what was said about a name is about the one being typed: without one, there is nothing to say
            ...(shown.nameDirty ? {} : { nameProblem: null, nameLook: '' as const }),
            javadoc: shown.javadocDirty ? shown.javadoc : next.javadoc,
            javadocDirty: shown.javadocDirty && shown.javadoc !== next.javadoc,
        },
    };
}

/** Shows what waited for unsaved edits, once there are none. */
const showPending = (state: State): State =>
    state.pending !== undefined && !isDirty(state.shown) ? show({ ...state, pending: undefined }, state.pending) : state;

/** A name or descriptor that, where it has to be broken into lines, breaks after its separators rather than anywhere. */
const Breakable = ({ text }: { text: string }) => (
    <>
        {text.split(/(?<=[/.$;,(])/).map((part, index) =>
            index === 0 ? (
                part
            ) : (
                <Fragment key={index}>
                    <wbr />
                    {part}
                </Fragment>
            ),
        )}
    </>
);

/** What the entry view does when the user acts, and where its fields are. */
interface Actions {
    onNameInput: (name: string) => void;
    resetName: () => void;
    submitName: () => void;
    onJavadocInput: (javadoc: string) => void;
    saveJavadoc: () => void;
    revertJavadoc: () => void;
    nameField: RefObject<HTMLInputElement | null>;
    javadocField: RefObject<HTMLTextAreaElement | null>;
}

function EntryView({ shown, pending, actions }: { shown: Shown; pending: boolean; actions: Actions }) {
    const { entry } = shown;
    const act = (id: PaneEntry['actions'][number]['id']) => () => post({ type: 'action', key: entry.key, id });

    const insertTag = (tag: Tag) => {
        const area = actions.javadocField.current;
        if (!area || area.disabled) {
            return;
        }

        const { selectionStart: start, selectionEnd: end } = area;
        const selected = area.value.substring(start, end);
        const text =
            'html' in tag
                ? selected
                    ? `<${tag.html}>${selected}</${tag.html}>`
                    : `<${tag.html}>`
                : tag.inline
                  ? `{${tag.tag} ${selected}}`
                  : `${tag.tag} ${selected}`;
        // inline tags leave the cursor inside the braces, ready for what goes there
        const caret = start + text.length - ('html' in tag || !tag.inline ? 0 : 1);
        area.focus();
        area.setRangeText(text, start, end, 'end');
        area.setSelectionRange(caret, caret);
        actions.onJavadocInput(area.value);
    };

    // Sections rather than one column: the pane is laid out by its width (see panes.css). Stacked in a side bar,
    // side by side in the panel at the bottom, where there is width to spare and little height. There, where to go
    // from this entry is a row of icons next to its kind; in a side bar, buttons with their names at the end.
    return (
        <div class="pane entry">
            <div class={pending ? 'banner' : 'banner hidden'}>
                {pending ? (
                    <>
                        <Icon name="pinned" />
                        <span>{t('entryPage.unsavedChangesToSaveOrRevert', entry.displayName)}</span>
                    </>
                ) : null}
            </div>
            <section class="identity">
                <div class="kind">
                    <Icon name={entry.icon} />
                    <span class="label">{entry.kindLabel}</span>
                    <span class="toolbar">
                        {entry.actions.map(action => (
                            <button
                                key={action.id}
                                class="icon"
                                title={action.title || action.label}
                                aria-label={action.label}
                                onClick={act(action.id)}
                            >
                                <Icon name={action.icon} />
                            </button>
                        ))}
                    </span>
                    <span class="spacer" />
                    <span class={`state ${entry.state}`}>{entry.stateLabel}</span>
                </div>
                <input
                    ref={actions.nameField}
                    type="text"
                    class={`mono ${shown.nameLook}`.trim()}
                    spellcheck={false}
                    autocomplete="off"
                    value={shown.name}
                    disabled={!entry.renamable || shown.renaming}
                    aria-label={t('entryPage.name')}
                    title={entry.renamable ? entry.nameHint : entry.lockedReason}
                    onInput={event => actions.onNameInput(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            actions.submitName();
                        } else if (event.key === 'Escape') {
                            actions.resetName();
                            event.currentTarget.blur();
                        }
                    }}
                />
                <ProblemLine problem={shown.nameProblem} />
                {entry.renamable ? (
                    <div class="message info hint">{entry.nameHint}</div>
                ) : (
                    <div class="message info">{entry.lockedReason}</div>
                )}
            </section>
            <section class="details">
                <dl class="facts">
                    {entry.facts.map(fact => (
                        <Fragment key={fact.label}>
                            <dt>{fact.label}</dt>
                            <dd class={fact.mono ? 'mono' : undefined} title={fact.value}>
                                <Breakable text={fact.value} />
                            </dd>
                            <dd class="action">
                                {fact.copy ? (
                                    <button
                                        class="icon"
                                        title={t('entryPage.copy', fact.label)}
                                        aria-label={t('entryPage.copy', fact.label)}
                                        onClick={() => post({ type: 'copy', text: fact.value })}
                                    >
                                        <Icon name="copy" />
                                    </button>
                                ) : null}
                            </dd>
                        </Fragment>
                    ))}
                </dl>
                {entry.toggle ? (
                    <div class="buttons">
                        <button class="secondary" title={entry.toggle.title} onClick={() => post({ type: 'toggle', key: entry.key })}>
                            {entry.toggle.label}
                        </button>
                    </div>
                ) : null}
            </section>
            <hr />
            <section class="javadoc">
                <h2>{t('entryPage.javadoc')}</h2>
                <textarea
                    ref={actions.javadocField}
                    class="mono"
                    spellcheck
                    rows={5}
                    disabled={!entry.documentable}
                    value={shown.javadoc}
                    placeholder={entry.documentable ? t('entryPage.describeWhatThisDoes') : t('entryPage.thisEntryCannotBeDocumented')}
                    aria-label={t('entryPage.javadoc')}
                    onInput={event => actions.onJavadocInput(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            actions.saveJavadoc();
                        } else if (event.key === 'Escape' && shown.javadocDirty) {
                            actions.revertJavadoc();
                        }
                    }}
                />
                {entry.documentable ? (
                    <div class="chips" aria-label={t('entryPage.insertTag')}>
                        {TAGS.map(tag => (
                            <button key={tag.label} title={t('entryPage.insert', tag.label)} onClick={() => insertTag(tag)}>
                                {tag.label}
                            </button>
                        ))}
                    </div>
                ) : null}
                <ProblemLine problem={shown.javadocProblem} />
                {entry.documentable ? (
                    <div class="buttons">
                        <button disabled={!shown.javadocDirty || shown.savingJavadoc} onClick={actions.saveJavadoc}>
                            {t('entryPage.saveJavadoc')}
                        </button>
                        <button class="secondary" disabled={!shown.javadocDirty} onClick={actions.revertJavadoc}>
                            {t('entryPage.revert')}
                        </button>
                        <span class="muted">
                            <kbd>{isMac ? '⌘↵' : t('entryPage.saveShortcut')}</kbd> {t('entryPage.toSave')}
                        </span>
                    </div>
                ) : null}
            </section>
            {entry.actions.length > 0 ? <hr class="actions" /> : null}
            {entry.actions.length > 0 ? (
                <section class="actions">
                    <div class="buttons">
                        {entry.actions.map(action => (
                            <button key={action.id} class="secondary" title={action.title} onClick={act(action.id)}>
                                <Icon name={action.icon} />
                                {action.label}
                            </button>
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    );
}

function EntryPage() {
    const [state, setState] = useState<State>({
        empty: { title: t('common.noNameSelected'), detail: t('common.placeTheCursorOnAHighlighted') },
    });
    const nameField = useRef<HTMLInputElement>(null);
    const javadocField = useRef<HTMLTextAreaElement>(null);
    // only the answer to the latest check of the name counts
    const validation = useRef(0);
    const later = useDebounced(VALIDATION_DELAY_MS);
    const shown = state.shown;
    const dirty = isDirty(shown);

    /** Changes what is on display, if an entry is. */
    const update = (change: (shown: Shown) => Partial<Shown>, then: (state: State) => State = next => next) =>
        setState(current => (current.shown ? then({ ...current, shown: { ...current.shown, ...change(current.shown) } }) : current));

    const validate = (key: string, name: string) => {
        const request = ++validation.current;
        later(() => post({ type: 'validate', key, name: name.trim(), request }));
    };

    useEffect(() => post({ type: 'dirty', dirty }), [dirty]);
    // a name being typed is checked again when what it is checked against changed
    useEffect(() => {
        if (shown?.nameDirty) {
            validate(shown.entry.key, shown.name);
        }
    }, [shown?.entry]);

    useMessages(message => {
        switch (message.type) {
            case 'entry':
                setState(current => show({ ...current, empty: message.empty }, message.entry));
                return;
            case 'validation':
                if (message.request === validation.current) {
                    update(current =>
                        current.nameDirty && current.entry.key === message.key
                            ? {
                                  nameProblem: message.problem,
                                  nameLook:
                                      message.problem?.severity === 'error'
                                          ? 'invalid'
                                          : message.problem?.severity === 'warning'
                                            ? 'warning'
                                            : '',
                              }
                            : {},
                    );
                }

                return;
            case 'renameResult':
                if (message.key !== shown?.entry.key) {
                    return;
                }

                if (message.problem) {
                    update(() => ({ renaming: false, nameLook: 'invalid', nameProblem: message.problem }));
                    setTimeout(() => nameField.current?.focus());
                } else {
                    // the extension follows up with the renamed entry
                    update(() => ({ renaming: false, nameDirty: false, nameProblem: null, nameLook: '' }), showPending);
                }

                return;
            case 'javadocResult':
                if (message.key !== shown?.entry.key) {
                    return;
                }

                update(
                    current =>
                        message.problem
                            ? { savingJavadoc: false, javadocProblem: message.problem }
                            : {
                                  savingJavadoc: false,
                                  javadocDirty: false,
                                  entry: { ...current.entry, javadoc: current.javadoc },
                                  javadocProblem: { severity: 'info', message: t('entryPage.savedToTheMappings') },
                              },
                    message.problem ? undefined : showPending,
                );
                return;
            case 'focus': {
                const field = message.field === 'name' ? nameField.current : javadocField.current;
                if (field && !field.disabled) {
                    field.focus();
                    if (message.field === 'name') {
                        // like Enigma: the part after the package is what one usually wants to replace
                        field.setSelectionRange(field.value.lastIndexOf('/') + 1, field.value.length);
                    }
                }

                return;
            }
        }
    });
    useEffect(() => post({ type: 'ready' }), []);

    if (!shown) {
        return <Empty icon="symbol-field" title={state.empty.title} detail={state.empty.detail} />;
    }

    const actions: Actions = {
        nameField,
        javadocField,
        onNameInput: name => {
            const nameDirty = name !== shown.entry.name;
            update(() => (nameDirty ? { name, nameDirty } : { name, nameDirty, nameProblem: null, nameLook: '' }));
            if (nameDirty) {
                validate(shown.entry.key, name);
            } else {
                validation.current++;
            }
        },
        resetName: () => {
            validation.current++;
            update(current => ({ name: current.entry.name, nameDirty: false, nameProblem: null, nameLook: '' }));
        },
        submitName: () => {
            // what is in the field now: it may have been typed a moment ago, before the page caught up
            const name = (nameField.current?.value ?? shown.name).trim();
            if (name === shown.entry.name) {
                actions.resetName();
                return;
            }

            validation.current++;
            update(() => ({ name, nameDirty: true, renaming: true }));
            post({ type: 'rename', key: shown.entry.key, name });
        },
        onJavadocInput: javadoc => update(current => ({ javadoc, javadocDirty: javadoc !== current.entry.javadoc, javadocProblem: null })),
        saveJavadoc: () => {
            const text = javadocField.current?.value ?? shown.javadoc;
            if (text !== shown.entry.javadoc) {
                update(() => ({ javadoc: text, savingJavadoc: true }));
                post({ type: 'saveJavadoc', key: shown.entry.key, text });
            }
        },
        revertJavadoc: () =>
            update(current => ({ javadoc: current.entry.javadoc, javadocDirty: false, javadocProblem: null }), showPending),
    };

    // another entry gets a new form; the same one keeps its fields, with what is being typed in them
    return <EntryView key={shown.entry.key} shown={shown} pending={state.pending !== undefined} actions={actions} />;
}

render(<EntryPage />, document.getElementById('root')!);
