import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { StatType, StatsResult, StatsTreeNode } from '../engine/protocol';
import type { FromStatsPage, StatsOptions, ToStatsPage } from '../panes/messages';
import { Icon, channel, t, useDebounced } from './shared';

// The "Mapping Statistics" page: how much of the jar is mapped, and where the unmapped names are.

const TYPES: [StatType, string][] = [
    ['classes', t('statsPage.classes')], ['methods', t('statsPage.methods')], ['fields', t('statsPage.fields')], ['parameters', t('statsPage.parameters')],
];
/** How long typing a package has to pause before it is counted. */
const PACKAGE_DELAY_MS = 450;
const DIMMED = 'opacity:0.55';

const { post, useMessages } = channel<ToStatsPage, FromStatsPage>();

/** Packages the user opened or closed, by path, and whether they are closed; everything else follows the default. */
const toggled = new Map<string, boolean>();

const percent = (mapped: number, mappable: number) => mappable === 0 ? 100 : mapped / mappable * 100;
const total = (node: StatsTreeNode): number => (node.value ?? 0) + node.children.reduce((sum, child) => sum + total(child), 0);
const bySize = (a: StatsTreeNode, b: StatsTreeNode) => total(b) - total(a) || a.name.localeCompare(b.name);

const Check = ({ label, checked, title, onChange }: { label: string; checked: boolean; title?: string; onChange: (checked: boolean) => void }) => (
    <label class="check" title={title}>
        <input type="checkbox" checked={checked} onChange={event => onChange(event.currentTarget.checked)} />
        {label}
    </label>
);

const Bar = ({ mapped, mappable }: { mapped: number; mappable: number }) => (
    <div class="bar" role="progressbar" aria-valuenow={Math.round(percent(mapped, mappable))} aria-valuemin={0} aria-valuemax={100}>
        <span style={`width:${percent(mapped, mappable).toFixed(2)}%`} />
    </div>
);

/** One line of the totals: a kind of name, how much of it is mapped. */
const Row = ({ label, mapped, mappable, overall }: { label: string; mapped: number; mappable: number; overall?: boolean }) => (
    <>
        <span class={overall ? 'overall' : undefined}>{label}</span>
        <Bar mapped={mapped} mappable={mappable} />
        <span class={`number${overall ? ' overall' : ''}`}>{`${mapped.toLocaleString()} / ${mappable.toLocaleString()}`}</span>
        <span class={`number${overall ? ' overall' : ''}`}>{`${percent(mapped, mappable).toFixed(1)}%`}</span>
    </>
);

/**
 * A package and what is in it, or a class.
 * @param path the packages the node is in, with dots
 * @param largest the most unmapped names of a node next to this one, which the bars are measured against
 */
function Node({ node, path, depth, largest }: { node: StatsTreeNode; path: string; depth: number; largest: number }) {
    const fullPath = path ? `${path}.${node.name}` : node.name;
    const [open, setOpen] = useState(() => !(toggled.get(fullPath) ?? depth >= 1));
    const count = total(node);
    const name = node.name || t('statsPage.defaultPackage');
    const share = (
        <div class="share">
            <span style={`width:${largest > 0 ? Math.max(2, count / largest * 100).toFixed(1) : 0}%`} />
        </div>
    );

    if (node.children.length === 0) {
        return (
            <div class="node leaf">
                <div class="line">
                    <Icon name="symbol-class" />
                    <span class="name" title={fullPath}>
                        <button class="link" title={t('statsPage.open', fullPath)} onClick={() => post({ type: 'open', name: fullPath })}>{name}</button>
                    </span>
                    {share}
                    <span class="count">{count}</span>
                </div>
            </div>
        );
    }

    const toggle = () => {
        toggled.set(fullPath, open);
        setOpen(!open);
    };
    // large jars have thousands of classes: only what is opened is built
    const children = open ? [...node.children].sort(bySize) : [];
    const childLargest = children[0] ? total(children[0]) : 0;
    return (
        <div class={`node branch${open ? '' : ' collapsed'}`}>
            <div class="line" role="button" tabIndex={0} aria-expanded={open} onClick={toggle} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle();
                }
            }}>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} />
                <span class="name" title={fullPath}><Icon name="symbol-namespace" /> {name}</span>
                {share}
                <span class="count">{count}</span>
            </div>
            <div class="children">
                {children.map(child => <Node key={child.name} node={child} path={fullPath} depth={depth + 1} largest={childLargest} />)}
            </div>
        </div>
    );
}

function Results({ stats, error, loading }: { stats?: StatsResult; error?: string; loading: boolean }) {
    if (error) {
        return <div class="message error" role="alert">{error}</div>;
    }

    if (!stats) {
        return <p class="muted"><Icon name="loading" spin /> {t('statsPage.counting')}</p>;
    }

    // the tree starts at the package that was asked for, if any, and otherwise at what is in the jar
    const tree = stats.tree;
    const top = tree.name ? [tree] : [...tree.children].sort(bySize);
    const shown = tree.children.length > 0 || tree.value ? top : [];
    const largest = Math.max(0, ...shown.map(total));
    return (
        <>
            <h2>{t('common.mapped')}</h2>
            <div class="totals" style={loading ? DIMMED : undefined}>
                {TYPES.map(([key, label]) => {
                    const type = stats.types[key];
                    return type ? <Row key={key} label={label} mapped={type.mapped} mappable={type.mappable} /> : null;
                })}
                <Row label={t('statsPage.overall')} mapped={stats.mapped} mappable={stats.mappable} overall />
            </div>
            <h2 style="margin-top:26px">{t('statsPage.stillUnmapped', stats.unmapped.toLocaleString())}</h2>
            {shown.length > 0
                ? <div class="tree" style={loading ? DIMMED : undefined}>
                    {shown.map(child => <Node key={child.name} node={child} path="" depth={0} largest={largest} />)}
                </div>
                : <p class="muted"><Icon name="check" /> {t('statsPage.everythingInScopeIsMapped')}</p>}
        </>
    );
}

function StatsPage() {
    const [jarName, setJarName] = useState('');
    const [options, setOptions] = useState<StatsOptions>({ types: TYPES.map(([type]) => type), package: '', includeSynthetic: false, countFallback: false });
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<StatsResult | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const later = useDebounced(PACKAGE_DELAY_MS);

    const count = (next: StatsOptions) => {
        setOptions(next);
        setLoading(true);
        post({ type: 'generate', options: next });
    };

    useMessages(message => {
        switch (message.type) {
            case 'state':
                setJarName(message.state.jarName);
                setLoading(message.state.loading);
                // once something was counted here, the options are those it was counted with
                if (stats === undefined) {
                    setOptions(message.state.options);
                }

                break;
            case 'result':
                setLoading(false);
                setError(message.error);
                if (message.stats) {
                    setStats(message.stats);
                }

                break;
            case 'stale':
                // mappings changed while the page was open
                count(options);
                break;
        }
    });
    useEffect(() => post({ type: 'ready' }), []);

    const countType = (type: StatType) => (checked: boolean) => {
        const types = checked ? [...options.types, type] : options.types.filter(candidate => candidate !== type);
        // something has to be counted
        count({ ...options, types: types.length > 0 ? types : [type] });
    };

    return (
        <div class="stats">
            <h1>{t('common.mappingStatistics')}</h1>
            <div class="muted">{jarName}</div>
            <div class="controls">
                <div class="group">
                    <div class="title">{t('statsPage.count')}</div>
                    <div class="checks">
                        {TYPES.map(([type, label]) => <Check key={type} label={label} checked={options.types.includes(type)} onChange={countType(type)} />)}
                    </div>
                </div>
                <div class="group">
                    <div class="title">{t('statsPage.onlyInPackage')}</div>
                    <input type="text" class="mono" spellcheck={false} placeholder={t('statsPage.theWholeJar')} value={options.package} aria-label={t('statsPage.package')}
                        onInput={event => {
                            const next = { ...options, package: event.currentTarget.value.trim() };
                            setOptions(next);
                            later(() => count(next));
                        }} />
                </div>
                <div class="group">
                    <div class="title">{t('statsPage.options')}</div>
                    <div class="checks">
                        <Check label={t('statsPage.syntheticEntries')} title={t('statsPage.countEntriesGeneratedByTheCompiler')} checked={options.includeSynthetic}
                            onChange={checked => count({ ...options, includeSynthetic: checked })} />
                        <Check label={t('statsPage.fallbackNamesCountAsMapped')} title={t('statsPage.treatLowQualityNamesProposedBy')} checked={options.countFallback}
                            onChange={checked => count({ ...options, countFallback: checked })} />
                    </div>
                </div>
                <span class="spacer" />
                <button class="secondary" title={t('statsPage.countAgain')} disabled={loading} onClick={() => count(options)}>
                    <Icon name={loading ? 'loading' : 'refresh'} spin={loading} />{t('statsPage.refresh')}
                </button>
            </div>
            <Results stats={stats} error={error} loading={loading} />
        </div>
    );
}

render(<StatsPage />, document.getElementById('root')!);
