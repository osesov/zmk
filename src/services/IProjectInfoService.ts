import * as vscode from "vscode";
import { ProjectJsonFile } from "../components/ProjectInfo";
import { MutableSourceFileConfiguration, MutableWorkspaceBrowseConfiguration } from "../components/SourceFileConfiguration";

export interface IProjectInfoService
{
    onChange: vscode.Event<void>;
    getProjectDescription(): ProjectJsonFile | null;
    // TODO: Should remove 'cpp' parameter?
    // it is being loaded from compile_commands.json nowm since project.json
    // has 'ccache', and the tool itself is has no path
    getSourceFileConfiguration(uri: vscode.Uri, cpp: string | null): MutableSourceFileConfiguration | null;
    getBrowseConfiguration(): MutableWorkspaceBrowseConfiguration | null;
}
