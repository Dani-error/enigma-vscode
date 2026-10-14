import * as vscode from 'vscode';
import { View } from '../engine/protocol';
import { settings } from '../config';

/** A jar and the mappings it was worked on with. */
export interface ProjectDescriptor {
    jar: string;
    mappings?: string;
    format?: string;
}

/** Tabs of classes that were closed because their jar was not open, to be opened again with it. */
export interface SetAsideTabs {
    jar: string;
    tabs: { class: string; view: View; column: number; active: boolean }[];
}

const WORKSPACE_KEY = 'enigma.project';
const RECENT_KEY = 'enigma.recentProjects';
const TABS_KEY = 'enigma.tabs';

/**
 * What is remembered between sessions: the projects that were worked on, which of them each window had open, and the
 * tabs that were set aside for it. Only remembers; what to do with it is decided by the project.
 */
export class ProjectMemory {
    constructor(private readonly context: vscode.ExtensionContext) {
    }

    /** Notes what is open: in this window, and as the most recent project. */
    remember(descriptor: ProjectDescriptor): void {
        void this.context.workspaceState.update(WORKSPACE_KEY, descriptor);

        const recent = this.recent().filter(project => project.jar !== descriptor.jar || (project.mappings ?? '') !== (descriptor.mappings ?? ''));
        // a project without mappings is replaced by the same jar with mappings, not listed twice
        const withoutBare = descriptor.mappings ? recent.filter(project => project.jar !== descriptor.jar || project.mappings) : recent;
        void this.context.globalState.update(RECENT_KEY, [descriptor, ...withoutBare].slice(0, settings.maxRecentProjects));
    }

    /** The projects that were worked on, the latest first. */
    recent(): ProjectDescriptor[] {
        return this.context.globalState.get<ProjectDescriptor[]>(RECENT_KEY) ?? [];
    }

    /** What this window had open the last time. */
    get ofWindow(): ProjectDescriptor | undefined {
        return this.context.workspaceState.get<ProjectDescriptor>(WORKSPACE_KEY);
    }

    /** The jar of this window was closed on purpose: it is not what the window has open any more. */
    async forgetWindow(): Promise<void> {
        await this.context.workspaceState.update(WORKSPACE_KEY, undefined);
    }

    async setAside(tabs: SetAsideTabs): Promise<void> {
        await this.context.workspaceState.update(TABS_KEY, tabs);
    }

    /** The tabs that were set aside. They are handed out once: whatever is opened next, they are not kept for later. */
    async takeAside(): Promise<SetAsideTabs | undefined> {
        const aside = this.context.workspaceState.get<SetAsideTabs>(TABS_KEY);
        if (aside) {
            await this.context.workspaceState.update(TABS_KEY, undefined);
        }

        return aside;
    }
}
