import * as fs from 'fs';
import * as vscode from 'vscode';

import { IBuildStatusService } from "../IBuildStatusService";
import { AppServiceContainer } from '../AppServices';
import { gnbTaskType } from '../../components/tasks';
import { Completion } from '../../components/promise';
import { ISettingsService, Setting } from '../ISettingsService';
import { IBuilderService, NeedBuildResult } from '../IBuilderService';
import { expectNever } from '../../components/utils';

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

        Promise.resolve().then(() => this.buildIfNecessary())
        .then((status) => this._onInitialBuildComplete.complete(status))
        .catch(() => this._onInitialBuildComplete.complete(false))
        ;

        this.settings.onChange(async e => {
            if (e.affects(Setting.outputDir)) {
                await this.buildIfNecessary();
            }
        });
    }

    private async buildIfNecessary(): Promise<boolean>
    {
        try {
// return Promise.resolve();
            const builder = this.builder;
            const needBuildResult = await builder.needBuild();

            switch (needBuildResult) {
                case NeedBuildResult.no:
                    return true;

                case NeedBuildResult.configIncomplete:
                    vscode.window.showWarningMessage('Build configuration is incomplete. Check "zmk.config" setting.');
                    return false;

                case NeedBuildResult.yes:
                    const buildMinButton = 'Build Minimal';
                    const buildAllButton = 'Build All';
                    const skipButton = 'Skip';
                    const answer = await vscode.window.showWarningMessage(`Output directory does not exist. Build is required.`, buildMinButton, buildAllButton, skipButton);

                    if (answer === buildMinButton) {
                        return await builder.buildDefaultTarget();
                    }
                    if (answer === buildAllButton) {
                        return await builder.buildAllTarget();
                    }

                    return false;

                default:
                    expectNever(needBuildResult);
                    vscode.window.showErrorMessage('Unexpected result from build check.');
                    return false;
            }

        } catch (err) {
            vscode.window.showErrorMessage(`Error checking output directory: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }
}
