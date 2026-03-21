import * as vscode from 'vscode';
import { AppServiceContainer } from "../AppServices";
import { IFileDecorationProvider } from "../IFileDecorationProvider";
import { symbols } from '../../components/symbols';
import { ICompileCommandsService } from '../ICompileCommandsService';
import { Setting } from '../ISettingsService';

export class FileDecorationProvider implements vscode.FileDecorationProvider, IFileDecorationProvider
{
    private static readonly reachableFile = new vscode.FileDecoration(
            symbols.badge.inSet,
            "File is in the valhalla build set",
            //new vscode.ThemeColor("charts.green")
        );

    private static readonly notReachableFile = new vscode.FileDecoration(
            symbols.badge.notInSet,
            "File is not in Valhalla build set",
            //new vscode.ThemeColor("charts.green")
        );

    private readonly compileCommands: ICompileCommandsService;
    private onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    onDidChangeFileDecorations = this.onDidChangeFileDecorationsEmitter.event;
    private isValhallaProject = false;

    constructor(services: AppServiceContainer)
    {
        const context = services.get('context');
        const settings = services.get('settings');
        this.compileCommands = services.get('compileCommands');
        context.subscriptions.push(vscode.window.registerFileDecorationProvider(this));

        settings.onChange(e => {
            if (e.affects(Setting.isValhallaProject)) {
                this.isValhallaProject = settings.get(Setting.isValhallaProject);
                this.onDidChangeFileDecorationsEmitter.fire(undefined);
            }
        });

        this.compileCommands.onChange(() => {
            this.onDidChangeFileDecorationsEmitter.fire(undefined);
        });

        this.isValhallaProject = settings.get(Setting.isValhallaProject);
    }

    async provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): Promise<vscode.FileDecoration | undefined>
    {
        if (!this.isValhallaProject) {
            return undefined;
        }

        const isListed = this.compileCommands.isFileListed(uri);

        if (isListed) {
            return FileDecorationProvider.reachableFile;
        }

        return FileDecorationProvider.notReachableFile;
    }
}
