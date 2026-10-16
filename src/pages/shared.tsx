import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { TextKey } from '../l10n/keys';
import type { Problem } from '../panes/messages';

// What the pages of the panes share: their texts, the way to their pane in the extension, and small pieces of UI.
// The pages are Preact components (https://preactjs.com): they describe what is shown for their state, and Preact
// brings the page in line with that, leaving alone what did not change, like the field being typed in.

declare global {
    interface Window {
        /** The texts this page uses, in the language of the editor: put there when the page is made (see webview.ts). */
        L10N?: Partial<Record<TextKey, string>>;
    }

    /** What the editor gives a web view to reach its extension with. Can be asked for only once. */
    function acquireVsCodeApi(): { postMessage(message: unknown): void };
}

/** Says something in the language of the editor, by the key of the text (see l10n/). */
export const t = (key: TextKey, ...values: unknown[]): string => {
    const text = window.L10N?.[key] ?? key;
    return text.replace(/\{(\d+)\}/g, (match, index: string) => (Number(index) < values.length ? String(values[Number(index)]) : match));
};

const vscode = acquireVsCodeApi();

/**
 * The way between a page and its pane in the extension. What each side may send is in panes/messages.ts.
 * @returns post, which sends something to the pane; and useMessages, with which a component hears what the pane sends
 */
export function channel<To, From>() {
    const post = (message: From): void => vscode.postMessage(message);

    const useMessages = (receive: (message: To) => void): void => {
        // the listener stays; what it calls is always the latest render's, which sees the latest state
        const latest = useRef(receive);
        latest.current = receive;
        useEffect(() => {
            const listener = (event: MessageEvent<To>) => latest.current(event.data);
            window.addEventListener('message', listener);
            return () => window.removeEventListener('message', listener);
        }, []);
    };

    return { post, useMessages };
}

/** An icon of the editor, by its name in the codicon font. */
export const Icon = ({ name, spin }: { name: string; spin?: boolean }) => (
    <span class={`codicon codicon-${name}${spin ? ' spinner' : ''}`} aria-hidden="true" />
);

/** What is wrong, or that all went well, under a field. Hidden while there is nothing to say. */
export const ProblemLine = ({ problem, alert }: { problem: Problem | null | undefined; alert?: boolean }) => (
    <div class={problem ? `message ${problem.severity}` : 'message hidden'} role={alert ? 'alert' : 'status'}>
        {problem?.message ?? ''}
    </div>
);

/** What a pane shows while it has nothing to show. */
export const Empty = ({ icon, title, detail }: { icon: string; title: string; detail: string }) => (
    <div class="pane">
        <div class="empty">
            <Icon name={icon} />
            <p>{title}</p>
            <p class="muted">{detail}</p>
        </div>
    </div>
);

/** A form field with its label, and a hint next to the label. */
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) => (
    <>
        <label>
            {label}
            {hint ? <span class="muted"> {hint}</span> : null}
        </label>
        {children}
    </>
);

/** Calls something once typing has paused for a while; calling it again starts the wait anew. */
export function useDebounced(milliseconds: number): (action: () => void) => void {
    const timer = useRef<number | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    return action => {
        clearTimeout(timer.current);
        timer.current = window.setTimeout(action, milliseconds);
    };
}
