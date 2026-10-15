import type { StatType, StatsResult, StatsTreeNode } from '../engine/protocol';
import type { FromStatsPage, StatsOptions, ToStatsPage } from '../panes/messages';
import { Child, connect, h, icon, root, t } from './dom';

// The "Mapping Statistics" page: how much of the jar is mapped, and where the unmapped names are.

interface State {
    jarName: string;
    options: StatsOptions;
    loading: boolean;
    stats?: StatsResult;
    error?: string;
}

const TYPES: [StatType, string][] = [
    ['classes', t('statsPage.classes')], ['methods', t('statsPage.methods')], ['fields', t('statsPage.fields')], ['parameters', t('statsPage.parameters')],
];
/** How long typing a package has to pause before it is counted. */
const PACKAGE_DELAY_MS = 450;

let state: State = { jarName: '', options: { types: TYPES.map(([type]) => type), package: '', includeSynthetic: false, countFallback: false }, loading: true };
/** Packages the user opened or closed, by path, and whether they are closed; everything else follows the default. */
const toggled = new Map<string, boolean>();
let packageTimer: number | undefined;
let packageInput: HTMLInputElement | undefined;

const post = connect<ToStatsPage, FromStatsPage>(receive);

const percent = (mapped: number, mappable: number) => mappable === 0 ? 100 : mapped / mappable * 100;
const total = (node: StatsTreeNode): number => (node.value ?? 0) + node.children.reduce((sum, child) => sum + total(child), 0);
const bySize = (a: StatsTreeNode, b: StatsTreeNode) => total(b) - total(a) || a.name.localeCompare(b.name);

function request(): void {
    state.loading = true;
    post({ type: 'generate', options: state.options });
    render();
}

function check(label: string, checked: boolean, onchange: (checked: boolean) => void, title?: string): HTMLElement {
    const box = h('input', { type: 'checkbox', checked, onchange: () => onchange(box.checked) });
    return h('label', { class: 'check', title }, box, label);
}

function bar(mapped: number, mappable: number): HTMLElement {
    return h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(Math.round(percent(mapped, mappable))), 'aria-valuemin': '0', 'aria-valuemax': '100' },
        h('span', { style: `width:${percent(mapped, mappable).toFixed(2)}%` }));
}

/**
 * @param node
 * @param path the packages the node is in, with dots
 * @param depth
 * @param largest the most unmapped names of a node next to this one, which the bars are measured against
 */
function renderNode(node: StatsTreeNode, path: string, depth: number, largest: number): HTMLElement {
    const count = total(node);
    const name = node.name || t('statsPage.defaultPackage');
    const fullPath = path ? `${path}.${node.name}` : node.name;
    const share = h('div', { class: 'share' }, h('span', { style: `width:${largest > 0 ? Math.max(2, count / largest * 100).toFixed(1) : 0}%` }));

    if (node.children.length === 0) {
        return h('div', { class: 'node leaf' },
            h('div', { class: 'line' }, icon('symbol-class'),
                h('span', { class: 'name', title: fullPath },
                    h('button', { class: 'link', title: t('statsPage.open', fullPath), onclick: () => post({ type: 'open', name: fullPath }), text: name })),
                share, h('span', { class: 'count', text: String(count) })));
    }

    const children = [...node.children].sort(bySize);
    const childLargest = children[0] ? total(children[0]) : 0;
    const collapsed = toggled.get(fullPath) ?? depth >= 1;
    const element = h('div', { class: `node branch${collapsed ? ' collapsed' : ''}` });
    const chevron = icon(collapsed ? 'chevron-right' : 'chevron-down');
    const body = h('div', { class: 'children' });
    let filled = false;
    const fill = () => {
        // large jars have thousands of classes: only build what is opened
        if (!filled) {
            filled = true;
            body.append(...children.map(child => renderNode(child, fullPath, depth + 1, childLargest)));
        }
    };
    const toggle = () => {
        const nowCollapsed = !element.classList.contains('collapsed');
        toggled.set(fullPath, nowCollapsed);
        fill();
        element.classList.toggle('collapsed', nowCollapsed);
        chevron.className = `codicon codicon-${nowCollapsed ? 'chevron-right' : 'chevron-down'}`;
    };

    if (!collapsed) {
        fill();
    }

    element.append(
        h('div', {
            class: 'line', role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed), onclick: toggle,
            onkeydown: event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle();
                }
            },
        }, chevron, h('span', { class: 'name', title: fullPath }, icon('symbol-namespace'), ` ${name}`), share, h('span', { class: 'count', text: String(count) })),
        body);
    return element;
}

function renderResults(): Child {
    const stats = state.stats;
    if (state.error) {
        return h('div', { class: 'message error', role: 'alert', text: state.error });
    }

    if (!stats) {
        return h('p', { class: 'muted' }, h('span', { class: 'codicon codicon-loading spinner' }), ` ${t('statsPage.counting')}`);
    }

    const row = (label: string, mapped: number, mappable: number, emphasis = '') => [
        h('span', { class: emphasis, text: label }), bar(mapped, mappable),
        h('span', { class: `number ${emphasis}`, text: `${mapped.toLocaleString()} / ${mappable.toLocaleString()}` }),
        h('span', { class: `number ${emphasis}`, text: `${percent(mapped, mappable).toFixed(1)}%` }),
    ];
    const rows = TYPES.flatMap(([key, label]) => {
        const type = stats.types[key];
        return type ? row(label, type.mapped, type.mappable) : [];
    });
    rows.push(...row(t('statsPage.overall'), stats.mapped, stats.mappable, 'overall'));

    // the tree starts at the package that was asked for, if any, and otherwise at what is in the jar
    const tree = stats.tree;
    const top = tree.name ? [tree] : [...tree.children].sort(bySize);
    const shown = tree.children.length > 0 || tree.value ? top : [];
    const largest = Math.max(0, ...shown.map(total));
    const dimmed = state.loading ? 'opacity:0.55' : undefined;

    return [
        h('h2', { text: t('common.mapped') }),
        h('div', { class: 'totals', style: dimmed }, rows),
        h('h2', { style: 'margin-top:26px', text: t('statsPage.stillUnmapped', stats.unmapped.toLocaleString()) }),
        shown.length > 0
            ? h('div', { class: 'tree', style: dimmed }, shown.map(child => renderNode(child, '', 0, largest)))
            : h('p', { class: 'muted' }, icon('check'), ` ${t('statsPage.everythingInScopeIsMapped')}`),
    ];
}

function render(): void {
    const options = state.options;
    const previous = packageInput;
    const caret = previous && document.activeElement === previous ? [previous.selectionStart, previous.selectionEnd] as const : undefined;
    const input = packageInput = h('input', {
        type: 'text', class: 'mono', spellcheck: 'false', placeholder: t('statsPage.theWholeJar'), value: options.package, 'aria-label': t('statsPage.package'),
        oninput: () => {
            options.package = input.value.trim();
            clearTimeout(packageTimer);
            packageTimer = window.setTimeout(request, PACKAGE_DELAY_MS);
        },
    });
    const countType = (type: StatType) => (checked: boolean) => {
        const types = checked ? [...options.types, type] : options.types.filter(candidate => candidate !== type);
        // something has to be counted
        options.types = types.length > 0 ? types : [type];
        request();
    };

    root.replaceChildren(h('div', { class: 'stats' },
        h('h1', { text: t('common.mappingStatistics') }),
        h('div', { class: 'muted', text: state.jarName }),
        h('div', { class: 'controls' },
            h('div', { class: 'group' }, h('div', { class: 'title', text: t('statsPage.count') }),
                h('div', { class: 'checks' }, TYPES.map(([type, label]) => check(label, options.types.includes(type), countType(type))))),
            h('div', { class: 'group' }, h('div', { class: 'title', text: t('statsPage.onlyInPackage') }), input),
            h('div', { class: 'group' }, h('div', { class: 'title', text: t('statsPage.options') }),
                h('div', { class: 'checks' },
                    check(t('statsPage.syntheticEntries'), options.includeSynthetic, checked => {
                        options.includeSynthetic = checked;
                        request();
                    }, t('statsPage.countEntriesGeneratedByTheCompiler')),
                    check(t('statsPage.fallbackNamesCountAsMapped'), options.countFallback, checked => {
                        options.countFallback = checked;
                        request();
                    }, t('statsPage.treatLowQualityNamesProposedBy')))),
            h('span', { class: 'spacer' }),
            h('button', { class: 'secondary', title: t('statsPage.countAgain'), disabled: state.loading, onclick: request },
                h('span', { class: `codicon codicon-${state.loading ? 'loading spinner' : 'refresh'}` }), t('statsPage.refresh'))),
        renderResults()));

    if (caret) {
        input.focus();
        input.setSelectionRange(caret[0], caret[1]);
    }
}

function receive(message: ToStatsPage): void {
    switch (message.type) {
        case 'state':
            // once something was counted here, the options are those it was counted with
            state = { ...state, ...message.state, options: state.stats === undefined ? message.state.options : state.options };
            render();
            break;
        case 'result':
            state.loading = false;
            state.error = message.error;
            state.stats = message.stats ?? state.stats;
            render();
            break;
        case 'stale':
            // mappings changed while the page was open
            request();
            break;
    }
}

render();
post({ type: 'ready' });
