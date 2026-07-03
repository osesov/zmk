import * as vscode from 'vscode';
import { IStatusService } from "../IStatusService";
import { AppServiceContainer, AppServices } from '../AppServices';
import { gnbTaskType } from './ValhallaTaskProvider';
import { ISettingsService, Setting } from '../ISettingsService';
import { zmkCommand } from '../../components/constants';
import { IBuilderService } from '../IBuilderService';
import { ICompileCommandsService } from '../ICompileCommandsService';
import { IDepsFileService } from '../IDepsFileService';
import { assertNever } from '../../components/utils';
import { IArgsFileService } from '../IArgsFileService';
import { IProjectInfoService } from '../IProjectInfoService';

const selector: vscode.DocumentSelector = [
    { language: 'c++' },
    { language: 'c' },
    { language: '*' },
]

enum KnownAs
{
    UnknownFile,
    KnownSourceFile,
    KnownDependencyFile,
    MaybeDependencyFile,
}

type StatusServiceDeps = Pick<AppServices, 'initialBuild' | 'buildComplete' | 'argsFile' | 'projectInfo' | 'settings' | 'builder' | 'compileCommands' | 'depsFile'>;

export function createStatusService(services: AppServiceContainer): StatusService
{
    return new StatusService({
        initialBuild: services.get('initialBuild'),
        buildComplete: services.get('buildComplete'),
        settings: services.get('settings'),
        builder: services.get('builder'),
        argsFile: services.get('argsFile'),
        compileCommands: services.get('compileCommands'),
        projectInfo: services.get('projectInfo'),
        depsFile: services.get('depsFile'),
    });
}

export class StatusService implements IStatusService
{
    private readonly settings: ISettingsService;
    private readonly builder: IBuilderService;
    private readonly compileCommands: ICompileCommandsService;
    private readonly depsFileService: IDepsFileService;
    private readonly argsFile: IArgsFileService;
    private readonly projectInfo: IProjectInfoService;
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
        this.settings = deps.settings;
        this.builder = deps.builder;
        this.compileCommands = deps.compileCommands;
        this.depsFileService = deps.depsFile;
        this.argsFile = deps.argsFile;
        this.projectInfo = deps.projectInfo;

        this.builder.onBuildStarted(() => (this.buildStarted(), this.updateStatusButton()));
        this.builder.onBuildFinished((success) => (this.buildCompleted(success.success), this.updateStatusButton()));

        vscode.tasks.onDidStartTaskProcess((e) => (e.execution.task.definition.type === gnbTaskType) && this.buildStarted());
        vscode.tasks.onDidEndTaskProcess( e => (e.execution.task.definition.type === gnbTaskType) && this.buildCompleted(e.exitCode === 0));
        vscode.window.onDidChangeActiveTextEditor((e) => (this.updateCurrentFile(e), this.updateStatusButton()));
        this.currentUri = vscode.window.activeTextEditor?.document.uri ?? null;

        this.settings.onChange(e => (e.affects(Setting.config)) && this.updateCurrentConfig());
        this.settings.onChange(e => (e.affects(Setting.target)) && this.updateCurrentTarget());

        initialBuild.finally(() => this.updateToolchain());
        buildComplete(() => this.updateToolchain());
        this.argsFile.onChange(() => this.updateToolchain());

        this.argsFile.onChange(() => this.updateStatusButton());
        this.projectInfo.onChange(() => this.updateStatusButton());
        this.compileCommands.onChange(() => this.updateStatusButton());
        this.depsFileService.onChange(() => this.updateStatusButton());

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
                this.updateStatusButton();
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
    }

    private async isKnownFile(uri: vscode.Uri | null): Promise<KnownAs>
    {
        if (!uri) {
            return KnownAs.UnknownFile;
        }

        const sourceFileConfig = await this.compileCommands.getSourceFileConfiguration(uri);
        if (sourceFileConfig) {
            return KnownAs.KnownSourceFile;
        }

        if (!this.depsFileService.loaded) {
            return KnownAs.MaybeDependencyFile;
        }

        return this.depsFileService.isKnownFile(uri) ? KnownAs.KnownDependencyFile : KnownAs.UnknownFile;
    }

    private async updateStatusButton(): Promise<void>
    {
        if (!this.settings.get(Setting.isValhallaProject) || !this.statusButton) {
            return;
        }

        // show build status and if the current file is a part of the build

        const knownFile = await this.isKnownFile(this.currentUri);
        const config = this.settings.get(Setting.config);
        const target = this.settings.get(Setting.target);

        // this.currentConfig.detail = config ?? 'not set';

        let text = '';
        let tooltip = new vscode.MarkdownString();
        const loadedFiles: string[] = [];
        const notLoadedFiles: string[] = [];

        tooltip.supportHtml = true;

        tooltip.appendMarkdown('<table>');
        tooltip.appendMarkdown('<tr><td><b>Config:</b></td><td>' + (config ?? 'not set') + '</td></tr>');
        tooltip.appendMarkdown('<tr><td><b>Target:</b></td><td>' + (target ?? 'not set') + '</td></tr>');
        tooltip.appendMarkdown('<tr><td><b>Toolchain:</b></td><td>' + (await this.builder.toolchainSelector() ?? 'not set') + '</td></tr>');
        tooltip.appendMarkdown('<tr><td><b>Build status:</b></td><td>' + (this.buildCount > 0 ? '$(sync~spin) building...' : (this.buildStatus?.detail ?? 'unknown')) + '</td></tr>');

        for (const [name, service] of Object.entries({
            'args.gn': this.argsFile,
            'compile_commands.json': this.compileCommands,
            'project.json': this.projectInfo,
            '.ninja_deps': this.depsFileService,
        })) {
            if (service.loaded) {
                loadedFiles.push(name);
            } else {
                notLoadedFiles.push(name);
            }
        }

        // if (loadedFiles.length > 0) {
        //     tooltip.appendMarkdown('<tr><td><b>Loaded files:</b></td><td>' + loadedFiles.join(', ') + '</td></tr>');
        // }

        if (notLoadedFiles.length > 0) {
            tooltip.appendMarkdown('<tr><td><b>Not loaded files:</b></td><td>' + notLoadedFiles.join(', ') + '</td></tr>');
        }
        tooltip.appendMarkdown('</table>\n\n');

        text += ' Valhalla';

        switch (knownFile) {
            case KnownAs.KnownSourceFile:
                text += ' (S)';
                tooltip.appendMarkdown(`*Current file is a source file in Valhalla build*\n\n`);
                break;

            case KnownAs.KnownDependencyFile:
                text += ' (D)';
                tooltip.appendMarkdown(`*Current file is a dependency file in Valhalla build*\n\n`);
                break;

            case KnownAs.MaybeDependencyFile:
                text += ' (?)';
                tooltip.appendMarkdown(`*Current file may be a dependency file in Valhalla build*\n\n`);
                break;

            case KnownAs.UnknownFile:
                text += ' (-)';
                tooltip.appendMarkdown(`*Current file is not part of Valhalla build*\n\n`);
                break;

            default:
                assertNever(knownFile);
        }

        this.statusButton.text = text;
        this.statusButton.tooltip = tooltip;
    }
}
