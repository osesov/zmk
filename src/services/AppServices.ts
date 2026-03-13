import * as vscode from 'vscode';
import { IBuilderService } from './IBuilderService';
import { ISettingsService } from './ISettingsService';
import { IValhallaCppToolsProvider } from './IValhallaCppTools';
import { IVirtualDocumentProvider } from './IVirtualDocumentProvider';
import { IStatusService } from './IStatusService';
import { IValhallaTaskProvider } from './IValhallaTaskProvider';
import { IBuildStatusService } from './IBuildStatusService';
import { IUIService } from './IUIService';
import { IConfigTreeProvider } from './IConfigTreeProvider';
import { ITargetTreeProvider } from './ITargetTreeProvider';
import { IProjectInfoService } from './IProjectInfoService';

export type AppServices =
{
    context: vscode.ExtensionContext;
    buildOutputChannel: vscode.OutputChannel;
    logOutputChannel: vscode.LogOutputChannel;
    settings: ISettingsService;
    virtualDocumentProvider: IVirtualDocumentProvider;
    builder: IBuilderService;
    buildStatus: IBuildStatusService;
    projectInfo: IProjectInfoService;
    cppToolsProvider: IValhallaCppToolsProvider | null;
    status: IStatusService;
    tasks: IValhallaTaskProvider;
    ui: IUIService;
    configTree: IConfigTreeProvider;
    targetTree: ITargetTreeProvider;
}
