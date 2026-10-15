import type { TextKey } from '../l10n/keys';

// What the pages of the panes share: building their DOM without a framework, and talking to the extension.

declare global {
    interface Window {
        /** The texts this page uses, in the language of the editor: put there when the page is made (see webview.ts). */
        L10N?: Partial<Record<TextKey, string>>;
    }

    /** What the editor gives a web view to reach its extension with. Can be asked for only once. */
    function acquireVsCodeApi(): { postMessage(message: unknown): void };
}

/** Says something in the language of the editor, by the key of the text (see src/l10n). */
export const t = (key: TextKey, ...values: unknown[]) => {
    const text = window.L10N?.[key] ?? key;
    return text.replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match);
}

type Handlers = { [E in keyof HTMLElementEventMap as `on${E}`]?: (event: HTMLElementEventMap[E]) => void };
/** Attributes of an element. "class" and "text" set what they say; "on..." listens; false, null and undefined are left out. */
export type Attributes = Handlers & { [name: string]: string | number | boolean | null | undefined | ((event: never) => void) };
export type Child = Node | string | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes?: Attributes, ...children: Child[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes ?? {})) {
        if (value === undefined || value === null || value === false) {
            continue;
        }

        if (typeof value === 'function') {
            element.addEventListener(key.substring(2), value as EventListener);
        } else if (key === 'class') {
            element.className = String(value);
        } else if (key === 'text') {
            element.textContent = String(value);
        } else {
            element.setAttribute(key, value === true ? '' : String(value));
        }
    }

    append(element, children);
    return element;
}

const append = (parent: HTMLElement, children: Child[]) => {
    for (const child of children) {
        if (Array.isArray(child)) {
            append(parent, child);
        } else if (child !== undefined && child !== null && child !== false) {
            parent.append(child);
        }
    }
}

/** An icon of the editor, by its name in the codicon font. */
export const icon = (name: string): HTMLSpanElement => h('span', { class: `codicon codicon-${name}`, 'aria-hidden': 'true' });

/** Where a page puts what it shows. */
export const root = document.getElementById('root') as HTMLDivElement;

/**
 * Connects a page to its pane in the extension.
 * @param receive what to do with what the pane sends
 * @returns sends something to the pane
 */
export function connect<To, From>(receive: (message: To) => void): (message: From) => void {
    const vscode = acquireVsCodeApi();
    window.addEventListener('message', (event: MessageEvent<To>) => receive(event.data));
    return message => vscode.postMessage(message);
}
