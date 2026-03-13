import * as vscode from "vscode";
import { ProjectJsonFile } from "../components/ProjectInfo";

export interface IProjectInfoService
{
    onChange: vscode.Event<void>;
    getProjectInfo(): Promise<ProjectJsonFile | null>;
}
