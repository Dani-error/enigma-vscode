import * as vscode from 'vscode'
import { describeTask } from './messages'
import { ProgressParams } from "./protocol";

/** A quick task is not worth a notification. */
const SHOW_AFTER_MS = 400;
const MAX_MESSAGE_LENGTH = 120;

/** One task of the engine, and the notification that shows how far it is. */
class ShownTask {

    private latest: ProgressParams;
    private reporter?: vscode.Progress<{ message?: string; increment?: number }>;
    private finish?: () => void;
    private reported = 0;
    private ended = false;
    private readonly timer: NodeJS.Timeout;

    constructor(begin: ProgressParams) {
        this.latest = begin;
        this.timer = setTimeout(() => this.show(begin), SHOW_AFTER_MS)
    }

    private show(begin: ProgressParams): void {
        const title = `Enigma: ${describeTask(begin.task, begin.taskArgs)}`;

        void vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, reporter => {
            this.reporter = reporter;
            this.update();

            // it may have ended while the notification was coming up
            return this.ended ? Promise.resolve() : new Promise<void>(resolve => {
                this.finish = resolve;
            });
        })
    }

    report(next: ProgressParams): void {
        // each phase of the engine starts from zero again
        if (next.title !== this.latest.title) {
            this.reported = 0;
        }

        this.latest = next;
        this.update();
    }

    private update(): void {
        if (!this.reporter) {
            return;
        }

        const { done, total, title, message } = this.latest;
        const percent = Math.min(100, Math.round(done / Math.max(total, 1) * 100));
        const text = [title, message].filter(part => part).join(' - ');

        // the bar only ever moves forward within a phase
        const increment = Math.max(0, percent - this.reported);
        this.reported = Math.max(this.reported, percent);
        this.reporter.report({ message: text.length > MAX_MESSAGE_LENGTH ? `${text.substring(0, MAX_MESSAGE_LENGTH - 3)}...` : text, increment });
    }

    end(): void {
        this.ended = true;
        clearTimeout(this.timer);
        this.finish?.();
    }

}

/** Shows what the engine is busy with as notifications of the editor. */
export class TaskProgress {
    private readonly tasks = new Map<number, ShownTask>();

    handle(params: ProgressParams): void {
        switch(params.phase) {
            case 'begin':
                this.tasks.set(params.id, new ShownTask(params));
                break;
            case 'report':
                this.tasks.get(params.id)?.report(params);
                break;
            case 'end':
                this.tasks.get(params.id)?.end();
                this.tasks.delete(params.id);
                break;
        }
    }

    endAll(): void {
        this.tasks.forEach(task => task.end());
        this.tasks.clear();
    }

}