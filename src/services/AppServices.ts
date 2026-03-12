import * as vscode from 'vscode';
import { IBuilderService } from './IBuilderService';
import { ISettingsService } from './ISettingsService';
import { IValhallaCppToolsProvider } from './IValhallaCppTools';
import { IVirtualDocumentProvider } from './IVirtualDocumentProvider';
import { IStatusService } from './IStatusService';
import { IValhallaTaskProvider } from './IValhallaTaskProvider';
import { IBuildStatusService } from './IBuildStatusService';

export type AppServices =
{
    context: vscode.ExtensionContext;
    buildOutputChannel: vscode.OutputChannel;
    logOutputChannel: vscode.LogOutputChannel;
    settings: ISettingsService;
    virtualDocumentProvider: IVirtualDocumentProvider;
    builder: IBuilderService;
    buildStatus: IBuildStatusService;
    cppToolsProvider: IValhallaCppToolsProvider | null;
    status: IStatusService;
    tasks: IValhallaTaskProvider;
}
