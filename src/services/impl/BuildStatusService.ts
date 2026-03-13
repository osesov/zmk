import * as fs from 'fs';
import * as vscode from 'vscode';

import { IBuildStatusService } from "../IBuildStatusService";
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { gnbTaskType } from '../../components/tasks';
import { CompletableFeature } from '../../components/promise';

export class BuildStatusService implements IBuildStatusService
{
    private _onBuildComplete = new vscode.EventEmitter<boolean>()
    public readonly onBuildComplete: vscode.Event<boolean> = this._onBuildComplete.event;
    public readonly initialBuildStatus = new CompletableFeature<boolean>('initialBuildStatus');

    public constructor(private services: ServiceContainer<AppServices>)
    {
        const builder = services.get('builder');
        builder.onBuildFinished((success) => this._onBuildComplete.fire(success));

        vscode.tasks.onDidEndTaskProcess( e => {
            if (e.execution.task.definition.type === gnbTaskType) {
                this._onBuildComplete.fire(e.exitCode === 0);
            }
        });

        Promise.resolve().then(() => this.checkOutputDirExists())
        .then(() => this.initialBuildStatus.complete(true))
        .catch(() => this.initialBuildStatus.complete(false));
    }

    private async checkOutputDirExists(): Promise<void>
    {
        const builder = this.services.get('builder');

        const outputDir = builder.getOutputDir();
        if (!outputDir)
            return Promise.resolve();

        if (fs.existsSync(outputDir))
            return Promise.resolve();

        const buildNowButton = 'Build Now';
        const skipButton = 'Skip';
        const answer = await vscode.window.showWarningMessage(`Output directory ${outputDir} does not exist.`, buildNowButton, skipButton);
        ;
        if (answer === buildNowButton) {
            await builder.buildDefaultTarget();
        }
    }
}
