import * as vscode from 'vscode';
import { Enigma } from '../enigma';
import { AnalysisMode } from '../views/analysis';
import { STRUCTURE_OPTIONS, StructureOptions } from '../views/structure';
import { Register, Targets } from './registry';

/** The views about the code: structure of a class, inheritance, implementations and calls of an entry. */
export const registerAnalysisCommands = (register: Register, targets: Targets, { analysis, structure }: Enigma) => {
    const analyse = (mode: AnalysisMode) => async (argument?: unknown) => {
        const target = await targets.entry(argument);
        if (target) {
            await analysis.show(mode, target.entry, target.simpleName || target.name);
        }
    };

    register('enigma.showInheritance', analyse('inheritance'));
    register('enigma.showImplementations', analyse('implementations'));
    register('enigma.showCalls', analyse('calls'));
    register('enigma.showCallsSpecific', analyse('callsSpecific'));

    // the buttons of the view: look at the same entry in another way, or at what is under the cursor if it is empty
    for (const mode of ['inheritance', 'implementations', 'calls'] as const) {
        register(`enigma.analysis.${mode}`, async () => {
            if (!(await analysis.switchTo(mode))) {
                await analyse(mode)();
            }
        });
    }

    register('enigma.analysis.clear', () => analysis.clear());

    register('enigma.showStructure', async () => {
        await structure.refresh();
        await vscode.commands.executeCommand('enigma.structure.focus');
    });

    // Each option of the structure view is a pair of menu entries, one of which is shown checked.
    for (const key of Object.keys(STRUCTURE_OPTIONS) as (keyof StructureOptions)[]) {
        for (const value of STRUCTURE_OPTIONS[key]) {
            const apply = () => structure.setOption(key, value);
            register(`enigma.structure.${key}.${value}`, apply);
            register(`enigma.structure.${key}.${value}.checked`, apply);
        }
    }
};
