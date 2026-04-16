import * as vscode from 'vscode';
import { IStatusService } from "../IStatusService";
import { AppServiceContainer, AppServices } from '../AppServices';
import { gnbTaskType } from '../../components/tasks';
import { ISettingsService, Setting } from '../ISettingsService';
import { zmkCommand } from '../../components/constants';
import { IBuilderService } from '../IBuilderService';

const selector: vscode.DocumentSelector = [
    { language: 'c++' },
    { language: 'c' },
    { language: '*' },
]

type StatusServiceDeps = Pick<AppServices, 'initialBuild' | 'buildComplete' | 'argsFile' | 'settings' | 'builder'>;

export function createStatusService(services: AppServiceContainer): StatusService
{
    return new StatusService({
        initialBuild: services.get('initialBuild'),
        buildComplete: services.get('buildComplete'),
        argsFile: services.get('argsFile'),
        settings: services.get('settings'),
        builder: services.get('builder'),
    });
}

export class StatusService implements IStatusService
{
    private readonly settings: ISettingsService;
    private readonly builder: IBuilderService;

    private buildStatus: vscode.LanguageStatusItem | null = null;
    private currentConfig: vscode.LanguageStatusItem | null = null;
    private currentTarget: vscode.LanguageStatusItem | null = null;
    private currentToolchain: vscode.LanguageStatusItem | null = null;
    private buildCount = 0;

    constructor(deps: StatusServiceDeps)
    {
        const initialBuild = deps.initialBuild;
        const buildComplete = deps.buildComplete;
        const argsFile = deps.argsFile;
        this.settings = deps.settings;
        this.builder = deps.builder;

        this.builder.onBuildStarted(() => this.buildStarted());
        this.builder.onBuildFinished((success) => this.buildCompleted(success.success));

        vscode.tasks.onDidStartTaskProcess((e) => (e.execution.task.definition.type === gnbTaskType) && this.buildStarted());
        vscode.tasks.onDidEndTaskProcess( e => (e.execution.task.definition.type === gnbTaskType) && this.buildCompleted(e.exitCode === 0));

        this.settings.onChange(e => (e.affects(Setting.config)) && this.updateCurrentConfig());
        this.settings.onChange(e => (e.affects(Setting.target)) && this.updateCurrentTarget());

        initialBuild.finally(() => this.updateToolchain());
        buildComplete(() => this.updateToolchain());
        argsFile.onChange(() => this.updateToolchain());

        this.updateSettings();
    }

    private async updateToolchain()
    {
        if (!this.currentToolchain)
            return;
        const toolchain = await this.builder.toolchainSelector();
        this.currentToolchain.detail = toolchain ?? 'not set';
    }

    private updateCurrentConfig()
    {
        if (!this.currentConfig)
            return;
        const config = this.settings.get(Setting.config);
        this.currentConfig.detail = config ?? 'not set';
        this.currentConfig.command = {
            title: 'set config',
            command: zmkCommand.setConfig,
        };
    }

    private updateCurrentTarget()
    {
        if (!this.currentTarget)
            return;
        const target = this.settings.get(Setting.target);
        this.currentTarget.detail = target ?? 'not set';

        // command is not implemented yet
        // this.currentTarget.command = {
        //     title: 'set target',
        //     command: zmkCommand.setTarget,
        // };
    }

    private updateSettings()
    {
        const isValhallaProject = this.settings.get(Setting.isValhallaProject);
        // Update status items based on whether it's a Valhalla project
        if (!isValhallaProject) {
            this.buildStatus?.dispose();
            this.buildStatus = null;
            this.currentConfig?.dispose();
            this.currentConfig = null;
            this.currentTarget?.dispose();
            this.currentTarget = null;
            this.currentToolchain?.dispose();
            this.currentToolchain = null;
        } else {
            if (!this.buildStatus) {
                this.buildStatus = vscode.languages.createLanguageStatusItem('zmk-status', selector);
                this.buildStatus.text = 'Valhalla Build';
                this.buildStatus.detail = 'Ready';
                this.buildStatus.command = {
                    title: 'Show build output',
                    command: zmkCommand.showOutput,
                };
            }
            if (!this.currentConfig) {
                this.currentConfig = vscode.languages.createLanguageStatusItem('zmk-current-config', selector);
                this.currentConfig.text = 'Valhalla Config';
                this.updateCurrentConfig();
            }
            if (!this.currentTarget) {
                this.currentTarget = vscode.languages.createLanguageStatusItem('zmk-current-target', selector);
                this.currentTarget.text = 'Valhalla Target';
                this.updateCurrentTarget();
            }
            if (!this.currentToolchain) {
                this.currentToolchain = vscode.languages.createLanguageStatusItem('zmk-current-toolchain', selector);
                this.currentToolchain.text = 'Valhalla Toolchain';
                this.updateToolchain();
            }
        }
    }

    private buildStarted()
    {
        if (this.buildCount++ != 0)
            return;

        if (!this.buildStatus)
            return;

        this.buildStatus.detail = 'Building...';
        this.buildStatus.busy = true;
        this.buildStatus.severity = vscode.LanguageStatusSeverity.Information;
    }

    private buildCompleted(success: boolean)
    {
        if (this.buildCount === 0)
            return;

        if (--this.buildCount > 0)
            return;

        if (!this.buildStatus)
            return;

        this.buildStatus.detail = success ? 'Build completed successfully' : 'Build failed';
        this.buildStatus.busy = false;
        this.buildStatus.severity = success ? vscode.LanguageStatusSeverity.Information : vscode.LanguageStatusSeverity.Error;
    }

}
