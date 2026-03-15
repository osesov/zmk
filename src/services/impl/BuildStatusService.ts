import * as fs from 'fs';
import * as vscode from 'vscode';

import { IBuildStatusService } from "../IBuildStatusService";
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { gnbTaskType } from '../../components/tasks';
import { Completion } from '../../components/promise';
import { Setting } from '../ISettingsService';

export class BuildStatusService implements IBuildStatusService
{
    public constructor(
        private services: ServiceContainer<AppServices>,
        private _onBuildComplete: vscode.EventEmitter<boolean>,
        private _onInitialBuildComplete: Completion<boolean>
    )
    {
        const builder = services.get('builder');
        builder.onBuildFinished((success) => this._onBuildComplete.fire(success));

        vscode.tasks.onDidEndTaskProcess( e => {
            if (e.execution.task.definition.type === gnbTaskType) {
                this._onBuildComplete.fire(e.exitCode === 0);
            }
        });

        Promise.resolve().then(() => this.checkOutputDirExists())
        .then(() => this._onInitialBuildComplete.complete(true))
        .catch(() => this._onInitialBuildComplete.complete(false))
        ;
    }

    private async checkOutputDirExists(): Promise<void>
    {
        const builder = this.services.get('builder');
        const settings = this.services.get('settings');

        const outputDir = settings.get(Setting.outputDir);
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
