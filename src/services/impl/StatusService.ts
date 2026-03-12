import * as vscode from 'vscode';
import { IStatusService } from "../IStatusService";
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { gnbTaskType } from '../../components/tasks';

export class StatusService implements IStatusService
{
    private buildStatus: vscode.LanguageStatusItem;

    constructor(private services: ServiceContainer<AppServices>)
    {
        this.buildStatus = vscode.languages.createLanguageStatusItem('zmk-status', { language: '*' });
        this.buildStatus.text = 'Valhalla';
        this.buildStatus.detail = 'Ready';
        this.buildStatus.command = {
            title: 'ZMK',
            command: 'zmk.showOutput',
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
    }
}
