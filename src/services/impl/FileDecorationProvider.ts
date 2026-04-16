import * as vscode from 'vscode';
import { AppServiceContainer, AppServices } from "../AppServices";
import { IFileDecorationProvider } from "../IFileDecorationProvider";
import { symbols } from '../../components/symbols';
import { ICompileCommandsService } from '../ICompileCommandsService';
import { Setting } from '../ISettingsService';

type FileDecorationProviderDeps = Pick<AppServices, 'context' | 'settings' | 'compileCommands'>;

export function createFileDecorationProvider(services: AppServiceContainer): FileDecorationProvider
{
    return new FileDecorationProvider({
        context: services.get('context'),
        settings: services.get('settings'),
        compileCommands: services.get('compileCommands'),
    });
}

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

    constructor(deps: FileDecorationProviderDeps)
    {
        const settings = deps.settings;
        this.compileCommands = deps.compileCommands;
        deps.context.subscriptions.push(vscode.window.registerFileDecorationProvider(this));

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
