import * as vscode from "vscode";
import { ProjectInfo, ProjectJsonFile } from "../../components/ProjectInfo";
import { IProjectInfoService } from "../IProjectInfoService";
import { ServiceContainer } from "../ServiceContainer";
import { AppServices } from "../AppServices";

export class ProjectInfoService implements IProjectInfoService
{
    private _projectInfo = new ProjectInfo();
    private _onChange = new vscode.EventEmitter<void>();

    public readonly onChange: vscode.Event<void> = this._onChange.event;

    constructor(private services: ServiceContainer<AppServices>)
    {
        const buildStatus = services.get('buildStatus')
        buildStatus.initialBuildStatus.promise.then(() => this.updateProjectInfo());
        buildStatus.onBuildComplete(() => this.updateProjectInfo());
    }

    public async getProjectInfo(): Promise<ProjectJsonFile | null>
    {
        const builder = this.services.get('builder');
        const outputDir = builder.getOutputDir();
        if (!outputDir)
            return null;
        return this._projectInfo.load(outputDir);
    }

    private async updateProjectInfo(): Promise<void>
    {
        const builder = this.services.get('builder');
        const outputDir = builder.getOutputDir();
        this._projectInfo.reset();

        if (outputDir) {
            await this._projectInfo.load(outputDir);
        }
        this._onChange.fire();
    }
}
