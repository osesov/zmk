import * as vscode from "vscode";
import { ProjectInfo, ProjectJsonFile } from "../components/ProjectInfo";

export interface IProjectInfoService
{
    onChange: vscode.Event<void>;
    getProjectInfo(): ProjectInfo;
    getProjectDescription(): Promise<ProjectJsonFile | null>;
}
