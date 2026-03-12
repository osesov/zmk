import * as vscode from 'vscode';
import { IStatusService } from "../IStatusService";
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { gnbTaskType } from '../../components/tasks';
import { ISettingsService, Setting } from '../ISettingsService';
import { zmkCommand } from '../../components/constants';

const selector: vscode.DocumentSelector = [
    { language: 'c++' },
    { language: 'c' },
    { language: '*' },
]

export class StatusService implements IStatusService
{
    private buildStatus: vscode.LanguageStatusItem;
    private currentConfig: vscode.LanguageStatusItem;
    private currentTarget: vscode.LanguageStatusItem;
    private readonly settings: ISettingsService;

    constructor(private services: ServiceContainer<AppServices>)
    {
        this.settings = services.get('settings');

        this.buildStatus = vscode.languages.createLanguageStatusItem('zmk-status', selector);
        this.buildStatus.text = 'Valhalla';
        this.buildStatus.detail = 'Ready';
        this.buildStatus.command = {
            title: 'ZMK',
            command: zmkCommand.showOutput,
        };

        let buildCount = 0;

        const buildStarted = () => {
            if (buildCount++ != 0)
                return;

            this.buildStatus.detail = 'Building...';
            this.buildStatus.busy = true;
            this.buildStatus.severity = vscode.LanguageStatusSeverity.Information;
        };

        const buildCompleted = (success: boolean) => {
            if (buildCount === 0)
                return;

            if (--buildCount > 0)
                return;

            this.buildStatus.detail = success ? 'Build completed successfully' : 'Build failed';
            this.buildStatus.busy = false;
            this.buildStatus.severity = success ? vscode.LanguageStatusSeverity.Information : vscode.LanguageStatusSeverity.Error;
        };

        const builder = services.get('builder');

        builder.onBuildStarted(() => buildStarted());
        builder.onBuildFinished((success) => buildCompleted(success));

        vscode.tasks.onDidStartTaskProcess((e) => (e.execution.task.definition.type === gnbTaskType) && buildStarted());
        vscode.tasks.onDidEndTaskProcess( e => (e.execution.task.definition.type === gnbTaskType) && buildCompleted(e.exitCode === 0));

        //
        this.currentConfig = vscode.languages.createLanguageStatusItem('zmk-current-config', selector);
        this.settings.onChange(e => (e.affects(Setting.config)) && this.updateCurrentConfig());
        this.updateCurrentConfig();

        this.currentTarget = vscode.languages.createLanguageStatusItem('zmk-current-target', selector);
        this.settings.onChange(e => (e.affects(Setting.target)) && this.updateCurrentTarget());
        this.updateCurrentTarget();
    }

    private updateCurrentConfig()
    {
        const config = this.settings.get(Setting.config);
        this.currentConfig.text = `Config: ${config ?? 'not set'}`;
        this.currentConfig.command = {
            title: 'set config',
            command: zmkCommand.setConfig,
        };
    }

    private updateCurrentTarget()
    {
        const target = this.settings.get(Setting.target);
        this.currentTarget.text = `Target: ${target ?? 'not set'}`;
        this.currentTarget.command = {
            title: 'set target',
            command: zmkCommand.setTarget,
        };
    }

}
