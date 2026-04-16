import * as vscode from "vscode";
import { AppServices, AppServiceContainer } from "../AppServices";
import { IArgsFileService } from "../IArgsFileService";
import { ArgsFile, ArgsMap, parseArgs } from "../../components/ArgsFile";
import { Setting, SettingChangeEvent } from "../ISettingsService";
import { FileWatcher } from "../../components/FileWatcher";

export class ArgsFileService implements IArgsFileService, vscode.Disposable
{
    private readonly _onChange = new vscode.EventEmitter<void>();
    private readonly fileWatcher = new FileWatcher(ArgsFile.fileName);
    private readonly settings: AppServices['settings'];
    private readonly disposables: vscode.Disposable[] = [];
    private args: ArgsMap | null = null;
    private disposed = false;
    private reloadVersion = 0;

    public readonly onChange: vscode.Event<void> = this._onChange.event;

    constructor(services: AppServiceContainer)
    {
        this.settings = services.get('settings');

        this.disposables.push(
            this.fileWatcher,
            this._onChange,
            this.settings.onChange((event: SettingChangeEvent) => {
                if (event.affects(Setting.outputDir)) {
                    void this.resetFile();
                }
            }),
            this.fileWatcher.onChange(() => {
                void this.resetFile();
            }),
        );

        void this.resetFile();
        services.get('context').subscriptions.push(this);
    }

    public dispose(): void
    {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.reloadVersion += 1;

        for (const disposable of this.disposables.splice(0).reverse()) {
            disposable.dispose();
        }
    }

    private async resetFile(): Promise<void>
    {
        const currentReload = ++this.reloadVersion;
        const outputDir = this.settings.get(Setting.outputDir);
        this.fileWatcher.setBaseDir(outputDir);

        const content = await this.fileWatcher.getContentAsync();
        if (this.disposed || currentReload !== this.reloadVersion) {
            return;
        }

        this.args = content ? parseArgs(content) : null;
        this._onChange.fire();
    }

    public getArgs(): ArgsMap | null
    {
        return this.args;
    }
}
