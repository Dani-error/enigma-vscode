import type { CollabPageState, FromCollabPage, LoggedMessage, Problem, ToCollabPage } from '../panes/messages';
import { Attributes, Child, connect, h, icon, root, t } from './dom';

// The "Collaboration" pane: joining or hosting a session, who is connected, and the chat and edit log.

type FormField = 'username' | 'address' | 'port' | 'password';

/** The parts of the page that are read after they were built: the fields of the form, or the log and the chat box. */
interface Elements extends Partial<Record<FormField, HTMLInputElement>> {
    log?: HTMLDivElement;
    chat?: HTMLInputElement;
}

const FORM_FIELDS: FormField[] = ['username', 'address', 'port', 'password'];
const DEFAULT_PORT = 34712;
/** Within this many pixels of its end, the log follows what is added to it. */
const FOLLOW_DISTANCE = 24;
const EVENT_ICONS: Partial<Record<LoggedMessage['type'], string>> = {
    connect: 'arrow-right', disconnect: 'arrow-left', rename: 'edit', edit_docs: 'book', mark_deobf: 'check', remove_mapping: 'discard',
};

let state: CollabPageState = { projectOpen: false, connection: 'not_connected', users: [], messages: [], defaults: {} };
/** What was typed into the forms, kept across re-renders. */
const form: { mode: 'join' | 'host' } & Partial<Record<FormField, string>> = { mode: 'join', password: '' };
let busy = false;
let problem: Problem | undefined;
let elements: Elements = {};

const post = connect<ToCollabPage, FromCollabPage>(receive);

// the rule of Enigma's server
const validUsername = (name: string) => /^[A-Za-z_][^(;:"<>*+=\\|?,)]{2,31}$/.test(name);

function field(label: string, input: HTMLElement, hint?: string): Child[] {
    return [h('label', {}, label, hint ? h('span', { class: 'muted', text: ` ${hint}` }) : undefined), input];
}

/** Says what is wrong with what was entered, next to the field that is to blame. */
function reject(message: string, input: FormField): void {
    problem = { severity: 'error', message };
    render();
    elements[input]?.focus();
}

function submit(): void {
    const value = (input: FormField) => elements[input]?.value ?? '';
    const username = value('username').trim();
    if (!validUsername(username)) {
        reject(t('collabPage.use3To32CharactersFor'), 'username');
        return;
    }

    if (form.mode === 'join') {
        const address = value('address').trim();
        if (!address) {
            reject(t('collabPage.enterTheAddressOfTheServer'), 'address');
            return;
        }

        post({ type: 'connect', username, address, password: value('password') });
    } else {
        const port = Number(value('port'));
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            reject(t('collabPage.enterAPortBetween1And'), 'port');
            return;
        }

        post({ type: 'host', username, port, password: value('password') });
    }

    problem = undefined;
    busy = true;
    render();
}

function remember(): void {
    for (const key of FORM_FIELDS) {
        const input = elements[key];
        if (input) {
            form[key] = input.value;
        }
    }
}

function renderForm(): HTMLElement {
    const onEnter = (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            submit();
        }
    };
    const text = (key: FormField, fallback: string | undefined, attributes: Attributes = {}) => {
        const input = h('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', value: form[key] ?? fallback ?? '', disabled: busy, onkeydown: onEnter, ...attributes });
        elements[key] = input;
        return input;
    };
    const switchTo = (mode: 'join' | 'host') => () => {
        remember();
        form.mode = mode;
        problem = undefined;
        render();
    };

    const join = form.mode === 'join';
    const password = elements.password = h('input', {
        type: 'password', autocomplete: 'off', value: form.password, disabled: busy, onkeydown: onEnter,
        placeholder: join ? t('collabPage.leaveEmptyIfTheServerHas') : t('collabPage.optional'),
    });

    return h('div', { class: 'pane' },
        h('p', { class: 'muted', style: 'margin-top:0', text: t('collabPage.mapAJarTogetherWithOther') }),
        h('div', { class: 'segmented', role: 'tablist' },
            h('button', { class: join ? 'selected' : '', role: 'tab', 'aria-selected': String(join), disabled: busy, text: t('collabPage.join'), onclick: switchTo('join') }),
            h('button', { class: join ? '' : 'selected', role: 'tab', 'aria-selected': String(!join), disabled: busy, text: t('collabPage.host'), onclick: switchTo('host') })),
        field(t('collabPage.yourName'), text('username', state.defaults.username)),
        join
            ? field(t('collabPage.server'), text('address', state.defaults.address, { placeholder: t('collabPage.hostOrHostPort') }))
            : field(t('collabPage.port'), text('port', String(state.defaults.port ?? DEFAULT_PORT), { inputmode: 'numeric' }), t('collabPage.othersConnectToYourAddressOn')),
        field(t('collabPage.password'), password),
        problem ? h('div', { class: `message ${problem.severity}`, role: 'alert', text: problem.message }) : undefined,
        h('div', { class: 'buttons' },
            h('button', { class: 'wide', disabled: busy, onclick: submit },
                busy
                    ? [h('span', { class: 'codicon codicon-loading spinner' }), join ? t('collabPage.connecting') : t('collabPage.starting')]
                    : [icon(join ? 'plug' : 'broadcast'), join ? t('collabPage.connect') : t('collabPage.startServer')])),
        join
            ? h('p', { class: 'muted', text: t('collabPage.joiningReplacesYourMappingsWithThose') })
            : h('p', { class: 'muted', text: t('collabPage.yourCurrentMappingsAreSharedWith') }));
}

function renderMessage(message: LoggedMessage): HTMLElement {
    const time = h('span', { class: 'time', text: message.time });
    if (message.type === 'chat') {
        return h('div', { class: `entry chat${message.user === state.self ? ' self' : ''}` }, time,
            h('span', { class: 'who', text: `${message.user}: ` }), h('span', { text: message.body ?? message.text }));
    }

    const entry = message.entry;
    const content = entry
        ? h('button', { class: 'link', title: t('collabPage.goToThisEntry'), onclick: () => post({ type: 'navigate', entry }), text: message.text })
        : h('span', { text: message.text });
    return h('div', { class: 'entry event' }, time, icon(EVENT_ICONS[message.type] ?? 'info'), content);
}

function renderSession(): { pane: HTMLElement; log: HTMLDivElement; chat: HTMLInputElement } {
    const hosting = state.connection === 'hosting';
    const sendChat = () => {
        const text = chat.value.trim();
        if (text) {
            post({ type: 'chat', text });
            chat.value = '';
        }

        chat.focus();
    };
    const log = h('div', { class: 'log grow', role: 'log', 'aria-live': 'polite' },
        state.messages.length > 0 ? state.messages.map(renderMessage) : h('div', { class: 'placeholder', text: t('collabPage.messagesAndEditsOfThisSession') }));
    const chat = h('input', {
        type: 'text', placeholder: t('collabPage.message'), 'aria-label': t('collabPage.message'), maxlength: '2000',
        onkeydown: event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                sendChat();
            }
        },
    });
    const status = hosting
        ? (state.port ? t('collabPage.hostingOnPort', state.port) : t('collabPage.hosting'))
        : (state.address ? t('collabPage.connectedTo', state.address) : t('collabPage.connected'));

    const pane = h('div', { class: 'pane fill' },
        h('div', { class: 'status' },
            h('span', { class: 'dot' }),
            h('span', { text: status }),
            h('span', { class: 'spacer' }),
            h('button', { class: 'secondary', onclick: () => post({ type: 'disconnect' }), text: hosting ? t('collabPage.stopServer') : t('collabPage.disconnect') })),
        h('h2', { text: t('collabPage.people', state.users.length) }),
        h('div', { class: 'users' }, state.users.length > 0
            ? state.users.map(user => h('span', { class: `user${user === state.self ? ' self' : ''}`, title: user === state.self ? t('collabPage.you') : user }, icon('account'), user))
            : h('span', { class: 'muted', text: t('collabPage.nobodyElseIsHereYet') })),
        h('h2', { style: 'margin-top:14px', text: t('collabPage.activity') }),
        log,
        h('div', { class: 'composer' }, chat, h('button', { title: t('collabPage.send'), 'aria-label': t('collabPage.send'), onclick: sendChat }, icon('send'))));
    return { pane, log, chat };
}

function render(): void {
    const previous = elements;
    const atBottom = !previous.log || previous.log.scrollHeight - previous.log.scrollTop - previous.log.clientHeight < FOLLOW_DISTANCE;
    const draft = previous.chat?.value ?? '';
    const hadFocus = previous.chat !== undefined && document.activeElement === previous.chat;
    if (state.connection === 'not_connected') {
        remember();
    }

    elements = {};
    if (!state.projectOpen) {
        root.replaceChildren(h('div', { class: 'pane' },
            h('div', { class: 'empty' }, icon('organization'), h('p', { text: t('common.noJarIsOpen') }), h('p', { class: 'muted', text: t('collabPage.openAJarToMapIt') }))));
    } else if (state.connection === 'not_connected') {
        root.replaceChildren(renderForm());
    } else {
        const { pane, log, chat } = renderSession();
        elements = { log, chat };
        root.replaceChildren(pane);
        chat.value = draft;
        if (hadFocus) {
            chat.focus();
        }

        if (atBottom) {
            log.scrollTop = log.scrollHeight;
        }
    }
}

function receive(message: ToCollabPage): void {
    switch (message.type) {
        case 'state': {
            const wasConnected = state.connection !== 'not_connected';
            state = message.state;
            if (state.connection !== 'not_connected') {
                // the password is not kept once it has served
                form.password = '';
                busy = false;
                problem = undefined;
            } else if (wasConnected) {
                busy = false;
            }

            break;
        }

        case 'failed':
            busy = false;
            problem = { severity: 'error', message: message.message };
            break;
    }

    render();
}

render();
post({ type: 'ready' });
