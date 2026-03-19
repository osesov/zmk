import * as fs from 'fs';
import * as vscode from 'vscode';

import { IBuildStatusService } from "../IBuildStatusService";
import { AppServiceContainer } from '../AppServices';
import { gnbTaskType } from '../../components/tasks';
import { Completion } from '../../components/promise';
import { ISettingsService, Setting } from '../ISettingsService';
import { IBuilderService } from '../IBuilderService';

export class BuildStatusService implements IBuildStatusService
{
    private readonly builder: IBuilderService;
    private readonly settings: ISettingsService;

    public constructor(
        private services: AppServiceContainer,
        private _onBuildComplete: vscode.EventEmitter<boolean>,
        private _onInitialBuildComplete: Completion<boolean>
    )
    {
        this.builder = services.get('builder');
        this.settings = services.get('settings');

        this.builder.onBuildFinished((success) => this._onBuildComplete.fire(success));

        vscode.tasks.onDidEndTaskProcess( e => {
            if (e.execution.task.definition.type === gnbTaskType) {
                this._onBuildComplete.fire(e.exitCode === 0);
            }
        });

        Promise.resolve().then(() => this.checkOutputDirExists())
        .then(() => this._onInitialBuildComplete.complete(true))
        .catch(() => this._onInitialBuildComplete.complete(false))
        ;

        this.settings.onChange(async e => {
            if (e.affects(Setting.outputDir)) {
                await this.checkOutputDirExists();
            }
        });
    }

    private async checkOutputDirExists(): Promise<void>
    {
        try {
// return Promise.resolve();
            const builder = this.builder;
            const settings = this.settings;

            const outputDir = settings.get(Setting.outputDir);
            if (outputDir && fs.existsSync(outputDir))
                return Promise.resolve();

            const buildNowButton = 'Build Now';
            const skipButton = 'Skip';
            const answer = await vscode.window.showWarningMessage(`Output directory ${outputDir} does not exist.`, buildNowButton, skipButton);
            ;
            if (answer === buildNowButton) {
                await builder.buildDefaultTarget();
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Error checking output directory: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
