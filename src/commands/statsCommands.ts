import { Enigma } from '../enigma';
import { Register, Targets } from './registry';

/** How much of the jar is mapped: the statistics page, and the progress shown in the class trees. */
export const registerStatsCommands = (register: Register, targets: Targets, { statsPanel, classProgress }: Enigma) => {
    register('enigma.showStats', () => {
        if (targets.requireProject()) {
            statsPanel.show();
        }
    });

    register('enigma.generateClassStats', async () => {
        if (targets.requireProject()) {
            await classProgress.show();
        }
    });
    register('enigma.hideClassStats', () => classProgress.hide());
}
