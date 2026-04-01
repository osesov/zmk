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
import { ICompileCommandsService } from './ICompileCommandsService';
import { IReviewService } from './IReviewService';
import { ISourceFileConfigurationService } from './ISourceFileConfigurationService';
import { IFileDecorationProvider } from './IFileDecorationProvider';
import { ITestController } from './ITestController';

export type AppServices =
{
    context: vscode.ExtensionContext;
    buildOutputChannel: vscode.OutputChannel;
    logOutputChannel: vscode.LogOutputChannel;
    buildComplete: vscode.Event<boolean>; // some build has completed (maybe run by user), with success or failure
    initialBuild: Promise<boolean>; // initial valhalla build complete

    settings: ISettingsService;
    argsFile: IArgsFileService;
    projectInfo: IProjectInfoService;
    compileCommands: ICompileCommandsService;

    virtualDocumentProvider: IVirtualDocumentProvider;

    builder: IBuilderService;
    buildStatus: IBuildStatusService;
    sourceFileInfo: ISourceFileConfigurationService;
    cppToolsProvider: IValhallaCppToolsProvider | null;
    status: IStatusService;
    tasks: IValhallaTaskProvider;
    ui: IUIService;
    configTree: IConfigTreeProvider;
    targetTree: ITargetTreeProvider;
    sourceFileConfigurationTree: ISourceFileConfigurationItemTreeProvider;
    argsTree: IArgsTreeProvider;
    review: IReviewService;
    fileDecorations: IFileDecorationProvider;
    testController: ITestController;
}

export type AppServiceContainer = ServiceContainer<AppServices>;
