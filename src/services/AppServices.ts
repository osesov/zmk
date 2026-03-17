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
import { ISourceFileConfigurationItemTreeProvider } from './ISourceFileConfigurationItemTreeProvider';
import { IArgsFileService } from './IArgsFileService';
import { ServiceContainer } from './ServiceContainer';
import { IArgsTreeProvider } from './IArgsTreeProvider';

export type AppServices =
{
    context: vscode.ExtensionContext;
    buildOutputChannel: vscode.OutputChannel;
    logOutputChannel: vscode.LogOutputChannel;
    buildComplete: vscode.Event<boolean>; // some build has completed (maybe run by user), with success or failure
    initialBuild: Promise<boolean>; // initial valhalla build complete

    argsFile: IArgsFileService;
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
    sourceFileConfigurationTree: ISourceFileConfigurationItemTreeProvider;
    argsTree: IArgsTreeProvider;
}

export type AppServiceContainer = ServiceContainer<AppServices>;
