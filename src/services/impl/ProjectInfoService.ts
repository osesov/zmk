import * as vscode from "vscode";
import { ProjectInfo, ProjectJsonFile } from "../../components/ProjectInfo";
import { IProjectInfoService } from "../IProjectInfoService";
import { AppServiceContainer } from "../AppServices";
import { Setting } from "../ISettingsService";

export class ProjectInfoService implements IProjectInfoService
{
    private _projectInfo = new ProjectInfo();
    private _onChange = new vscode.EventEmitter<void>();

    public readonly onChange: vscode.Event<void> = this._onChange.event;

    constructor(private services: AppServiceContainer)
    {
        const settings = services.get('settings');
        const initialBuild = services.get('initialBuild');
        const buildComplete = services.get('buildComplete')

        initialBuild.then(() => this.updateProjectInfo());
        buildComplete(() => this.updateProjectInfo());
        settings.onChange(() => this.updateProjectInfo());
    }

    public getProjectInfo(): ProjectInfo
    {
        return this._projectInfo;
    }

    public async getProjectDescription(): Promise<ProjectJsonFile | null>
    {
        const outputDir = this.services.get('settings').get(Setting.outputDir);
        if (!outputDir)
            return null;
        return this._projectInfo.load(outputDir);
    }

    private async updateProjectInfo(): Promise<void>
    {
        const outputDir = this.services.get('settings').get(Setting.outputDir);
        this._projectInfo.reset();

        if (outputDir) {
            await this._projectInfo.load(outputDir);
        }
        this._onChange.fire();
    }
}
