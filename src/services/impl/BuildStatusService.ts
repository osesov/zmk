import * as vscode from 'vscode';

import { IBuildStatusService } from "../IBuildStatusService";
import { AppServiceContainer, AppServices } from '../AppServices';
import { gnbTaskType } from './ValhallaTaskProvider';
import { Completion } from '../../components/promise';
import { ISettingsService, Setting } from '../ISettingsService';
import { BuildResult, IBuilderService, NeedBuildResult } from '../IBuilderService';
import { expectNever } from '../../components/utils';
import { zmkCommand } from '../../components/constants';

type BuildStatusServiceDeps = Pick<AppServices, 'builder' | 'settings'>;

export function createBuildStatusService(
    services: AppServiceContainer,
    onBuildComplete: vscode.EventEmitter<boolean>,
    onInitialBuildComplete: Completion<boolean>,
): BuildStatusService
{
    return new BuildStatusService(
        {
            builder: services.get('builder'),
            settings: services.get('settings'),
        },
        onBuildComplete,
        onInitialBuildComplete,
    );
}

export class BuildStatusService implements IBuildStatusService
{
    private readonly builder: IBuilderService;
    private readonly settings: ISettingsService;

    public constructor(
        deps: BuildStatusServiceDeps,
        private _onBuildComplete: vscode.EventEmitter<boolean>,
        private _onInitialBuildComplete: Completion<boolean>
    )
    {
        this.builder = deps.builder;
        this.settings = deps.settings;

        this.builder.onBuildFinished((success) => this._onBuildComplete.fire(success.success));

        vscode.tasks.onDidEndTaskProcess( e => {
            if (e.execution.task.definition.type === gnbTaskType) {
                this._onBuildComplete.fire(e.exitCode === 0);
            }
        });

        Promise.resolve().then(() => this.buildIfNecessary())
        .then((status) => this._onInitialBuildComplete.complete(status.success))
        .catch(() => this._onInitialBuildComplete.complete(false))
        ;

        this.settings.onChange(async e => {
            if (e.affects(Setting.outputDir)) {
                await this.buildIfNecessary();
            }
        });
    }

    private async buildIfNecessary(): Promise<BuildResult>
    {
        try {
            while (true) {
                const builder = this.builder;
                const needBuildResult = await builder.needBuild();
                const configureButton = 'Configure';
                const buildMinButton = 'Build Minimal';
                const buildAllButton = 'Build All';

                switch (needBuildResult) {
                    case NeedBuildResult.no:
                        return { success: true, status: 0, output: [] };

                    case NeedBuildResult.configIncomplete:
                        const result = await vscode.window.showWarningMessage('Build configuration is incomplete. Set "zmk.config".', configureButton);
                        if (result === configureButton) {
                            await vscode.commands.executeCommand(zmkCommand.setConfig);
                            continue;

                        }
                        return { success: false, status: 'Build configuration is incomplete', output: [] };

                    case NeedBuildResult.yes:
                        const config = this.settings.get(Setting.config);
                        const answer = await vscode.window.showWarningMessage(`Output directory for '${config}' does not exist. Build is required.`,
                            configureButton, buildMinButton, buildAllButton);

                        switch (answer) {
                            case configureButton:
                                await vscode.commands.executeCommand(zmkCommand.setConfig);
                                continue;

                            case buildMinButton:
                                return await builder.buildDefaultTarget();

                            case buildAllButton:
                                return await builder.buildAllTarget();
                        }

                        return { success: false, status: 'Build cancelled by user', output: [] };

                    default:
                        expectNever(needBuildResult);
                        vscode.window.showErrorMessage('Unexpected result from build check.');
                        return { success: false, status: 'Unexpected result from build check', output: [] };
                }
            }

        } catch (err) {
            vscode.window.showErrorMessage(`Error checking output directory: ${err instanceof Error ? err.message : String(err)}`);
            return { success: false, status: `Error checking output directory: ${err instanceof Error ? err.message : String(err)}`, output: [] };
        }
    }
}
