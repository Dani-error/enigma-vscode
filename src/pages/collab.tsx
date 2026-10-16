import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CollabPageState, FromCollabPage, LoggedMessage, Problem, ToCollabPage } from '../panes/messages';
import { Empty, Field, Icon, channel, t } from './shared';

// The "Collaboration" pane: joining or hosting a session, who is connected, and the chat and edit log.

type Mode = 'join' | 'host';

/** What was typed into the form; what was not typed yet comes from the defaults the extension remembers. */
interface Form {
    username?: string;
    address?: string;
    port?: string;
    password: string;
}

const DEFAULT_PORT = 34712;
/** Within this many pixels of its end, the log follows what is added to it. */
const FOLLOW_DISTANCE = 24;
const EVENT_ICONS: Partial<Record<LoggedMessage['type'], string>> = {
    connect: 'arrow-right', disconnect: 'arrow-left', rename: 'edit', edit_docs: 'book', mark_deobf: 'check', remove_mapping: 'discard',
};

const { post, useMessages } = channel<ToCollabPage, FromCollabPage>();

// the rule of Enigma's server
const validUsername = (name: string) => /^[A-Za-z_][^(;:"<>*+=\\|?,)]{2,31}$/.test(name);

function JoinOrHost({ state, mode, form, busy, problem, onChange, onSubmit }: {
    state: CollabPageState; mode: Mode; form: Form; busy: boolean; problem?: Problem;
    onChange: (mode: Mode, form: Form) => void; onSubmit: (mode: Mode, form: Required<Form>) => void;
}) {
    const join = mode === 'join';
    const values: Required<Form> = {
        username: form.username ?? state.defaults.username ?? '',
        address: form.address ?? state.defaults.address ?? '',
        port: form.port ?? String(state.defaults.port ?? DEFAULT_PORT),
        password: form.password,
    };
    const set = (key: keyof Form) => (event: { currentTarget: HTMLInputElement }) => onChange(mode, { ...form, [key]: event.currentTarget.value });
    const onEnter = (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit(mode, values);
        }
    };
    const text = { type: 'text', spellcheck: false, autocomplete: 'off', disabled: busy, onKeyDown: onEnter } as const;

    return (
        <div class="pane">
            <p class="muted" style="margin-top:0">{t('collabPage.mapAJarTogetherWithOther')}</p>
            <div class="segmented" role="tablist">
                <button class={join ? 'selected' : ''} role="tab" aria-selected={join} disabled={busy} onClick={() => onChange('join', form)}>{t('collabPage.join')}</button>
                <button class={join ? '' : 'selected'} role="tab" aria-selected={!join} disabled={busy} onClick={() => onChange('host', form)}>{t('collabPage.host')}</button>
            </div>
            <Field label={t('collabPage.yourName')}>
                <input {...text} id="username" value={values.username} onInput={set('username')} />
            </Field>
            {join
                ? <Field label={t('collabPage.server')}>
                    <input {...text} id="address" value={values.address} placeholder={t('collabPage.hostOrHostPort')} onInput={set('address')} />
                </Field>
                : <Field label={t('collabPage.port')} hint={t('collabPage.othersConnectToYourAddressOn')}>
                    <input {...text} id="port" value={values.port} inputMode="numeric" onInput={set('port')} />
                </Field>}
            <Field label={t('collabPage.password')}>
                <input type="password" autocomplete="off" value={values.password} disabled={busy} onKeyDown={onEnter} onInput={set('password')}
                    placeholder={join ? t('collabPage.leaveEmptyIfTheServerHas') : t('collabPage.optional')} />
            </Field>
            {problem ? <div class={`message ${problem.severity}`} role="alert">{problem.message}</div> : null}
            <div class="buttons">
                <button class="wide" disabled={busy} onClick={() => onSubmit(mode, values)}>
                    {busy
                        ? <><Icon name="loading" spin />{join ? t('collabPage.connecting') : t('collabPage.starting')}</>
                        : <><Icon name={join ? 'plug' : 'broadcast'} />{join ? t('collabPage.connect') : t('collabPage.startServer')}</>}
                </button>
            </div>
            <p class="muted">{join ? t('collabPage.joiningReplacesYourMappingsWithThose') : t('collabPage.yourCurrentMappingsAreSharedWith')}</p>
        </div>
    );
}

function Message({ message, self }: { message: LoggedMessage; self?: string }) {
    const time = <span class="time">{message.time}</span>;
    if (message.type === 'chat') {
        return (
            <div class={`entry chat${message.user === self ? ' self' : ''}`}>
                {time}<span class="who">{`${message.user}: `}</span><span>{message.body ?? message.text}</span>
            </div>
        );
    }

    const entry = message.entry;
    return (
        <div class="entry event">
            {time}
            <Icon name={EVENT_ICONS[message.type] ?? 'info'} />
            {entry
                ? <button class="link" title={t('collabPage.goToThisEntry')} onClick={() => post({ type: 'navigate', entry })}>{message.text}</button>
                : <span>{message.text}</span>}
        </div>
    );
}

function Session({ state }: { state: CollabPageState }) {
    const [draft, setDraft] = useState('');
    const log = useRef<HTMLDivElement>(null);
    const chat = useRef<HTMLInputElement>(null);
    // whether the log is scrolled to its end, so that it keeps following what is added
    const following = useRef(true);
    const hosting = state.connection === 'hosting';

    useLayoutEffect(() => {
        if (following.current && log.current) {
            log.current.scrollTop = log.current.scrollHeight;
        }
    }, [state.messages.length]);

    const send = () => {
        const text = draft.trim();
        if (text) {
            post({ type: 'chat', text });
            setDraft('');
        }

        chat.current?.focus();
    };
    const status = hosting
        ? (state.port ? t('collabPage.hostingOnPort', state.port) : t('collabPage.hosting'))
        : (state.address ? t('collabPage.connectedTo', state.address) : t('collabPage.connected'));

    return (
        <div class="pane fill">
            <div class="status">
                <span class="dot" />
                <span>{status}</span>
                <span class="spacer" />
                <button class="secondary" onClick={() => post({ type: 'disconnect' })}>{hosting ? t('collabPage.stopServer') : t('collabPage.disconnect')}</button>
            </div>
            <h2>{t('collabPage.people', state.users.length)}</h2>
            <div class="users">
                {state.users.length > 0
                    ? state.users.map(user => (
                        <span key={user} class={`user${user === state.self ? ' self' : ''}`} title={user === state.self ? t('collabPage.you') : user}>
                            <Icon name="account" />{user}
                        </span>))
                    : <span class="muted">{t('collabPage.nobodyElseIsHereYet')}</span>}
            </div>
            <h2 style="margin-top:14px">{t('collabPage.activity')}</h2>
            <div class="log grow" role="log" aria-live="polite" ref={log} onScroll={event => {
                const element = event.currentTarget;
                following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_DISTANCE;
            }}>
                {state.messages.length > 0
                    ? state.messages.map((message, index) => <Message key={index} message={message} self={state.self} />)
                    : <div class="placeholder">{t('collabPage.messagesAndEditsOfThisSession')}</div>}
            </div>
            <div class="composer">
                <input type="text" ref={chat} value={draft} placeholder={t('collabPage.message')} aria-label={t('collabPage.message')} maxLength={2000}
                    onInput={event => setDraft(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            send();
                        }
                    }} />
                <button title={t('collabPage.send')} aria-label={t('collabPage.send')} onClick={send}><Icon name="send" /></button>
            </div>
        </div>
    );
}

function CollabPage() {
    const [state, setState] = useState<CollabPageState>({ projectOpen: false, connection: 'not_connected', users: [], messages: [], defaults: {} });
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<Problem | undefined>(undefined);
    // what was typed into the form, kept while a session is on
    const [mode, setMode] = useState<Mode>('join');
    const [form, setForm] = useState<Form>({ password: '' });

    useMessages(message => {
        switch (message.type) {
            case 'state':
                if (message.state.connection !== 'not_connected') {
                    // the password is not kept once it has served
                    setForm({ ...form, password: '' });
                    setBusy(false);
                    setProblem(undefined);
                } else if (state.connection !== 'not_connected') {
                    setBusy(false);
                }

                setState(message.state);
                break;
            case 'failed':
                setBusy(false);
                setProblem({ severity: 'error', message: message.message });
                break;
        }
    });
    useEffect(() => post({ type: 'ready' }), []);

    const submit = (mode: Mode, form: Required<Form>) => {
        const username = form.username.trim();
        const reject = (message: string, field: string) => {
            setProblem({ severity: 'error', message });
            document.getElementById(field)?.focus();
        };
        if (!validUsername(username)) {
            reject(t('collabPage.use3To32CharactersFor'), 'username');
            return;
        }

        if (mode === 'join') {
            const address = form.address.trim();
            if (!address) {
                reject(t('collabPage.enterTheAddressOfTheServer'), 'address');
                return;
            }

            post({ type: 'connect', username, address, password: form.password });
        } else {
            const port = Number(form.port);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                reject(t('collabPage.enterAPortBetween1And'), 'port');
                return;
            }

            post({ type: 'host', username, port, password: form.password });
        }

        setProblem(undefined);
        setBusy(true);
    };

    if (!state.projectOpen) {
        return <Empty icon="organization" title={t('common.noJarIsOpen')} detail={t('collabPage.openAJarToMapIt')} />;
    }

    return state.connection === 'not_connected'
        ? <JoinOrHost state={state} mode={mode} form={form} busy={busy} problem={problem} onSubmit={submit} onChange={(nextMode, nextForm) => {
            if (nextMode !== mode) {
                setProblem(undefined);
            }

            setMode(nextMode);
            setForm(nextForm);
        }} />
        : <Session state={state} />;
}

render(<CollabPage />, document.getElementById('root')!);
