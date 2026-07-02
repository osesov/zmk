import * as vscode from 'vscode';
import { IStatusService } from "../IStatusService";
import { AppServiceContainer, AppServices } from '../AppServices';
import { gnbTaskType } from './ValhallaTaskProvider';
import { ISettingsService, Setting } from '../ISettingsService';
import { zmkCommand } from '../../components/constants';
import { BuildResult, IBuilderService } from '../IBuilderService';
import { ISourceFileConfigurationService } from '../ISourceFileConfigurationService';

const selector: vscode.DocumentSelector = [
    { language: 'c++' },
    { language: 'c' },
    { language: '*' },
]

type StatusServiceDeps = Pick<AppServices, 'initialBuild' | 'buildComplete' | 'argsFile' | 'settings' | 'builder' | 'sourceFileInfo'>;

enum EventType {
    InitialUpdate = 'initialUpdate',
    BuildStarted = 'buildStarted',
    BuildCompleted = 'buildCompleted',
    EditorChanged = 'editorChanged'
}

export function createStatusService(services: AppServiceContainer): StatusService
{
    return new StatusService({
        initialBuild: services.get('initialBuild'),
        buildComplete: services.get('buildComplete'),
        argsFile: services.get('argsFile'),
        settings: services.get('settings'),
        builder: services.get('builder'),
        sourceFileInfo: services.get('sourceFileInfo'),
    });
}

export class StatusService implements IStatusService
{
    private readonly settings: ISettingsService;
    private readonly builder: IBuilderService;
    private readonly sourceFileInfo: ISourceFileConfigurationService;
    private buildStatus: vscode.LanguageStatusItem | null = null;
    private currentConfig: vscode.LanguageStatusItem | null = null;
    private currentTarget: vscode.LanguageStatusItem | null = null;
    private currentToolchain: vscode.LanguageStatusItem | null = null;
    private statusButton: vscode.StatusBarItem | null = null;
    private buildCount = 0;
    private currentUri: vscode.Uri | null = null;

    constructor(deps: StatusServiceDeps)
    {
        const initialBuild = deps.initialBuild;
        const buildComplete = deps.buildComplete;
        const argsFile = deps.argsFile;
        this.settings = deps.settings;
        this.builder = deps.builder;
        this.sourceFileInfo = deps.sourceFileInfo;

        this.builder.onBuildStarted(() => (this.buildStarted(), this.updateStatusButton(EventType.BuildStarted)));
        this.builder.onBuildFinished((success) => (this.buildCompleted(success.success), this.updateStatusButton(EventType.BuildCompleted, success)));

        vscode.tasks.onDidStartTaskProcess((e) => (e.execution.task.definition.type === gnbTaskType) && this.buildStarted());
        vscode.tasks.onDidEndTaskProcess( e => (e.execution.task.definition.type === gnbTaskType) && this.buildCompleted(e.exitCode === 0));
        vscode.window.onDidChangeActiveTextEditor((e) => (this.updateCurrentFile(e), this.updateStatusButton(EventType.EditorChanged, e)));
        this.currentUri = vscode.window.activeTextEditor?.document.uri ?? null;

        this.settings.onChange(e => (e.affects(Setting.config)) && this.updateCurrentConfig());
        this.settings.onChange(e => (e.affects(Setting.target)) && this.updateCurrentTarget());

        initialBuild.finally(() => this.updateToolchain());
        buildComplete(() => this.updateToolchain());
        argsFile.onChange(() => this.updateToolchain());

        this.updateSettings();
    }

    private async updateToolchain()
    {
        if (!this.currentToolchain)
            return;
        const toolchain = await this.builder.toolchainSelector();
        this.currentToolchain.detail = toolchain ?? 'not set';
    }

    private updateCurrentConfig()
    {
        if (!this.currentConfig)
            return;
        const config = this.settings.get(Setting.config);
        this.currentConfig.detail = config ?? 'not set';
        this.currentConfig.command = {
            title: 'set config',
            command: zmkCommand.setConfig,
        };
    }

    private updateCurrentTarget()
    {
        if (!this.currentTarget)
            return;
        const target = this.settings.get(Setting.target);
        this.currentTarget.detail = target ?? 'not set';

        // command is not implemented yet
        // this.currentTarget.command = {
        //     title: 'set target',
        //     command: zmkCommand.setTarget,
        // };
    }

    private updateSettings()
    {
        const isValhallaProject = this.settings.get(Setting.isValhallaProject);
        // Update status items based on whether it's a Valhalla project
        if (!isValhallaProject) {
            this.buildStatus?.dispose();
            this.buildStatus = null;
            this.currentConfig?.dispose();
            this.currentConfig = null;
            this.currentTarget?.dispose();
            this.currentTarget = null;
            this.currentToolchain?.dispose();
            this.currentToolchain = null;

            this.statusButton?.dispose();
            this.statusButton = null;
        } else {
            if (!this.buildStatus) {
                this.buildStatus = vscode.languages.createLanguageStatusItem('zmk-status', selector);
                this.buildStatus.text = 'Valhalla Build';
                this.buildStatus.detail = 'Ready';
                this.buildStatus.command = {
                    title: 'Show build output',
                    command: zmkCommand.showOutput,
                };
            }
            if (!this.currentConfig) {
                this.currentConfig = vscode.languages.createLanguageStatusItem('zmk-current-config', selector);
                this.currentConfig.text = 'Valhalla Config';
                this.updateCurrentConfig();
            }
            if (!this.currentTarget) {
                this.currentTarget = vscode.languages.createLanguageStatusItem('zmk-current-target', selector);
                this.currentTarget.text = 'Valhalla Target';
                this.updateCurrentTarget();
            }
            if (!this.currentToolchain) {
                this.currentToolchain = vscode.languages.createLanguageStatusItem('zmk-current-toolchain', selector);
                this.currentToolchain.text = 'Valhalla Toolchain';
                this.updateToolchain();
            }

            if (!this.statusButton) {
                this.statusButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
                this.statusButton.text = 'Valhalla';
                this.statusButton.command = {
                    title: 'Show Valhalla commands',
                    command: zmkCommand.zmkShowCommands,
                };
                this.statusButton.show();
                this.updateStatusButton(EventType.InitialUpdate);
            }
        }
    }

    private buildStarted()
    {
        if (this.buildCount++ != 0)
            return;

        if (!this.buildStatus)
            return;

        this.buildStatus.detail = 'Building...';
        this.buildStatus.busy = true;
        this.buildStatus.severity = vscode.LanguageStatusSeverity.Information;
    }

    private buildCompleted(success: boolean)
    {
        if (this.buildCount === 0)
            return;

        if (--this.buildCount > 0)
            return;

        if (!this.buildStatus)
            return;

        this.buildStatus.detail = success ? 'Build completed successfully' : 'Build failed';
        this.buildStatus.busy = false;
        this.buildStatus.severity = success ? vscode.LanguageStatusSeverity.Information : vscode.LanguageStatusSeverity.Error;
    }

    private async updateCurrentFile(editor: vscode.TextEditor | undefined): Promise<void>
    {
        const uri = vscode.window.activeTextEditor?.document.uri;
        this.currentUri = uri ?? null;
        // const config = uri ? await this.sourceFileInfo.getSourceFileConfiguration(uri) : null;
                // const compileCommand = uri ? await this.compileCommands.getSourceFileConfiguration(uri) : null;
                // this.setConfiguration(config, compileCommand);
    }

    private updateStatusButton(eventType: EventType.BuildStarted): void;
    private updateStatusButton(eventType: EventType.InitialUpdate): void;
    private updateStatusButton(eventType: EventType.BuildCompleted, result: BuildResult): void;
    private updateStatusButton(eventType: EventType.EditorChanged, editor: vscode.TextEditor | undefined): void;
    private async updateStatusButton(event: EventType, arg?: true | BuildResult | vscode.TextEditor): Promise<void>
    {
        if (!this.settings.get(Setting.isValhallaProject) || !this.statusButton) {
            return;
        }

        // show build status and if the current file is a part of the build

        const sourceFileConfig = this.currentUri ? await this.sourceFileInfo.getSourceFileConfiguration(this.currentUri) : null;
        const config = this.settings.get(Setting.config);
        const target = this.settings.get(Setting.target);

        // this.currentConfig.detail = config ?? 'not set';

        let text = '';
        let tooltip = new vscode.MarkdownString();

        tooltip.appendMarkdown(`- **config:** ${config ?? 'not set'}\n\n`);
        tooltip.appendMarkdown(`- **target:** ${target ?? 'not set'}\n\n`);

        if (this.buildCount > 0) {
            text += '$(sync~spin)';
            tooltip.appendMarkdown('- *Build in progress...*\n\n');
        }

        text += ' Valhalla';

        if (sourceFileConfig) {
            text += ' (+)';
            tooltip.appendMarkdown(`- *Current file is part of Valhalla build*\n\n`);
        }
        else {
            text += ' (-)';
            tooltip.appendMarkdown('- *Current file is not part of Valhalla build*\n\n');
        }

        this.statusButton.text = text;
        this.statusButton.tooltip = tooltip;
    }
}
