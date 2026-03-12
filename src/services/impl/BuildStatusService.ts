import * as vscode from 'vscode';

import { IBuildStatusService } from "../IBuildStatusService";
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { gnbTaskType } from '../../components/tasks';

export class BuildStatusService implements IBuildStatusService
{
    private _onBuildComplete = new vscode.EventEmitter<boolean>()
    public onBuildComplete: vscode.Event<boolean> = this._onBuildComplete.event;

    public constructor(private services: ServiceContainer<AppServices>)
    {
        const builder = services.get('builder');
        builder.onBuildFinished((success) => this._onBuildComplete.fire(success));

        vscode.tasks.onDidEndTaskProcess( e => {
            if (e.execution.task.definition.type === gnbTaskType) {
                this._onBuildComplete.fire(e.exitCode === 0);
            }
        });
    }
}
