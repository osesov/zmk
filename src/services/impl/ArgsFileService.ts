import * as vscode from "vscode";
import { ServiceContainer } from "../ServiceContainer";
import { AppServices } from "../AppServices";
import { IArgsFileService } from "../IArgsFileService";
import { ArgsFile, ArgsMap, parseArgs } from "../../components/ArgsFile";
import { Setting } from "../ISettingsService";
import { FileWatcher } from "../../components/FileWatcher";

export class ArgsFileService implements IArgsFileService
{
    private _onChange = new vscode.EventEmitter<void>();
    private fileWatcher = new FileWatcher(ArgsFile.fileName);
    private args: ArgsMap | null = null;

    public readonly onChange: vscode.Event<void> = this._onChange.event;

    constructor(services: ServiceContainer<AppServices>)
    {
        // const initialBuild = services.get('initialBuild');
        // const buildComplete = services.get('buildComplete')
        const settings = services.get('settings');

        const resetArgsFile = async () => {
            const outputDir = settings.get(Setting.outputDir);
            this.fileWatcher.setBaseDir(outputDir);

            const content = await this.fileWatcher.getContentAsync()
            this.args = content ? parseArgs(content) : null;
            this._onChange.fire();
        }

        settings.onChange(() => resetArgsFile());
        // initialBuild.then(() => resetArgsFile());
        // buildComplete(() => resetArgsFile());
        vscode.workspace.onDidChangeWorkspaceFolders(() => resetArgsFile());
        this.fileWatcher.onChange(() => resetArgsFile());

        resetArgsFile();
    }

    public getArgs(): ArgsMap | null
    {
        return this.args;
    }
}
