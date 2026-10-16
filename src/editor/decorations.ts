import * as vscode from 'vscode';
import { TOKEN_CATEGORIES, TokenCategory } from '../engine/protocol';
import { State } from './state';
import { CATEGORY_NAMES } from './zones';
import { t } from '../l10n';

export class Decorations implements vscode.Disposable {
    private readonly categories: Record<TokenCategory, vscode.TextEditorDecorationType>;

    /** The occurrences of the name that is being typed. */
    private readonly editing: vscode.TextEditorDecorationType;
    private readonly hint: vscode.TextEditorDecorationType;
    private readonly error: vscode.TextEditorDecorationType;
    private readonly warning: vscode.TextEditorDecorationType;

    constructor() {
        const category = (name: TokenCategory, overview: boolean) =>
            vscode.window.createTextEditorDecorationType({
                backgroundColor: new vscode.ThemeColor(`enigma.${name}Background`),
                border: '1px solid',
                borderColor: new vscode.ThemeColor(`enigma.${name}Border`),
                borderRadius: '2px',
                // a name grows when typing at either of its ends
                rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
                // where names are still obfuscated shows in the scroll bar
                overviewRulerColor: overview ? new vscode.ThemeColor(`enigma.${name}Border`) : undefined,
                overviewRulerLane: overview ? vscode.OverviewRulerLane.Right : undefined,
            });

        this.categories = {
            obfuscated: category('obfuscated', true),
            deobfuscated: category('deobfuscated', false),
            proposed: category('proposed', false),
            fallback: category('fallback', false),
            debug: category('debug', false),
        };

        this.editing = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('enigma.editingBackground'),
            border: '1px solid',
            borderColor: new vscode.ThemeColor('enigma.editingBorder'),
            borderRadius: '2px',
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
        });
        this.hint = vscode.window.createTextEditorDecorationType({ rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed });
        this.error = vscode.window.createTextEditorDecorationType({
            textDecoration: 'underline wavy var(--vscode-editorError-foreground)',
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
        });
        this.warning = vscode.window.createTextEditorDecorationType({
            textDecoration: 'underline wavy var(--vscode-editorWarning-foreground)',
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
        });
    }

    /**
     * Shows the names of a document in an editor.
     * @param state what is known about the document; nothing is shown without it
     */
    apply(editor: vscode.TextEditor, state: State | undefined): void {
        const document = editor.document;
        // decorations computed for another text would be misplaced
        const parsed = state && document.getText() === state.expected ? state.parsed : undefined;
        const ranges: Record<TokenCategory, vscode.Range[]> = { obfuscated: [], deobfuscated: [], proposed: [], fallback: [], debug: [] };
        const typed: vscode.Range[] = [];
        const session = state?.session;

        if (state && parsed) {
            for (const zone of state.model.zones) {
                if (zone.category === 0) {
                    continue;
                }

                const range = new vscode.Range(
                    document.positionAt(parsed.starts[zone.index]),
                    document.positionAt(parsed.ends[zone.index]),
                );
                if (session && zone.group === session.group && zone.inline) {
                    typed.push(range);
                } else {
                    ranges[CATEGORY_NAMES[zone.category] as TokenCategory].push(range);
                }
            }
        }

        for (const name of TOKEN_CATEGORIES) {
            editor.setDecorations(this.categories[name], ranges[name]);
        }

        editor.setDecorations(this.editing, typed);

        const hints: vscode.DecorationOptions[] = [];
        const errors: vscode.Range[] = [];
        const warnings: vscode.Range[] = [];
        if (state && parsed && session) {
            const primary = new vscode.Range(
                document.positionAt(parsed.starts[session.primary]),
                document.positionAt(parsed.ends[session.primary]),
            );
            const problem = session.problem;
            const colour =
                problem?.severity === 'error'
                    ? 'editorError.foreground'
                    : problem?.severity === 'warning'
                      ? 'editorWarning.foreground'
                      : 'editorCodeLens.foreground';
            const text = problem
                ? `${problem.severity === 'error' ? '✗' : '⚠'} ${problem.message}${problem.severity === 'warning' ? ` — ${t('decorations.enterToRenameAnyway')}` : ''}`
                : session.busy
                  ? t('decorations.renaming')
                  : t('decorations.enterToRenameEscToCancel');
            // at the end of the line rather than next to the name, so that the code does not move while typing
            hints.push({
                range: document.lineAt(primary.end.line).range.with(document.lineAt(primary.end.line).range.end),
                renderOptions: {
                    after: { contentText: text, color: new vscode.ThemeColor(colour), margin: '0 0 0 3ch', fontStyle: 'italic' },
                },
            });
            if (problem) {
                (problem.severity === 'error' ? errors : warnings).push(primary);
            }
        }

        editor.setDecorations(this.hint, hints);
        editor.setDecorations(this.error, errors);
        editor.setDecorations(this.warning, warnings);
    }

    dispose(): void {
        Object.values(this.categories).forEach(decoration => decoration.dispose());
        this.editing.dispose();
        this.hint.dispose();
        this.error.dispose();
        this.warning.dispose();
    }
}
