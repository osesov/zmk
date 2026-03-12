// Integrate with CppTools to provide IntelliSense for Valhalla
import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';
import path from 'path';
import fs from 'fs';
import { ProjectJson } from '../../components/ProjectJson';
import { CompileCommands } from '../../components/CompileCommands';
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { ISettingsService, Setting } from '../ISettingsService';
import { IValhallaCppToolsProvider } from '../IValhallaCppTools';
import { IVirtualDocumentProvider } from '../IVirtualDocumentProvider';
import { IBuilderService } from '../IBuilderService';
import { IBuildStatusService } from '../IBuildStatusService';

export class ValhallaCppToolsProviderService implements cpptools.CustomConfigurationProvider, IValhallaCppToolsProvider
{
    private cppToolsApi: cpptools.CppToolsApi | undefined;
    private settings: ISettingsService;
    private virtualDocumentProvider: IVirtualDocumentProvider;
    private logOutputChannel: vscode.LogOutputChannel;
    private builder: IBuilderService;
    private buildStatus: IBuildStatusService;

    private projectJson: ProjectJson = new ProjectJson();
    private compileCommands = new CompileCommands();

    private statusBarItem: vscode.StatusBarItem;

    static async create(container: ServiceContainer<AppServices>): Promise<ValhallaCppToolsProviderService | null> {
        const cppToolsApi = await cpptools.getCppToolsApi(cpptools.Version.latest);

        if (!cppToolsApi) {
            vscode.window.showErrorMessage('C/C++ extension is not installed. Please install it to enable IntelliSense for Valhalla.');
            return null;
        }

        const provider = new ValhallaCppToolsProviderService(container, cppToolsApi);
        return provider;
    }

    public constructor(private container: ServiceContainer<AppServices>, cppToolsApi: cpptools.CppToolsApi) {
        const settings: ISettingsService = container.get('settings');
        const context: vscode.ExtensionContext = container.get('context');

        this.cppToolsApi = cppToolsApi;
        this.extensionId = context.extension.id;
        this.settings = settings;
        this.builder = container.get('builder');
        this.buildStatus = container.get('buildStatus');
        this.virtualDocumentProvider = container.get('virtualDocumentProvider');
        this.logOutputChannel = container.get('logOutputChannel');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

        this.statusBarItem.text = 'Valhalla: Ready';
        this.statusBarItem.show();

        settings.onChange(event => {
            if (event.affects(Setting.config)
                || event.affects(Setting.target)
                || event.affects(Setting.gnbFlags)
                || event.affects(Setting.gnFlags)
                || event.affects(Setting.workspaceFolders)
            ) {
                this.logOutputChannel.info('Configuration changed. Invalidating caches...');
                this.projectJson.reset();
                this.compileCommands.reset();
                cppToolsApi.didChangeCustomConfiguration(this);
            }
        });

        this.buildStatus.onBuildComplete(success => {
            if (success) {
                this.logOutputChannel.info('Build completed successfully. Updating IntelliSense configuration...');
            } else {
                this.logOutputChannel.error('Build failed. IntelliSense configuration may be outdated.');
            }
            cppToolsApi.didChangeCustomConfiguration(this);
        });

        context.subscriptions.push(this.statusBarItem);
        context.subscriptions.push(this);

        cppToolsApi.registerCustomConfigurationProvider(this);

        this.checkOutputDirExists().then(() => cppToolsApi.notifyReady(this));
    }

    public readonly name = 'Valhalla';
    public readonly extensionId: string;

    async canProvideConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<boolean> {
        // TODO: provide configuration withing valhalla only
        const hasConfig = (await this.getSourceFileConfiguration(uri)) !== null;
        if (!hasConfig) {
            this.logOutputChannel.error(`No configuration found for ${uri.fsPath}.`);
        }
        return hasConfig;
    }

    async provideConfigurations(uris: vscode.Uri[], token?: vscode.CancellationToken): Promise<cpptools.SourceFileConfigurationItem[]>
    {
        const result: cpptools.SourceFileConfigurationItem[] = [];

        for (const uri of uris) {
            this.logOutputChannel.info(`Provide configuration for ${uri.fsPath}`);
            const config = await this.getSourceFileConfiguration(uri);
            if (config) {
                result.push(config);
                this.setProvidedConfig(uri, config);
            }
        }
        return Promise.resolve(result);
    }

    canProvideBrowseConfiguration(token?: vscode.CancellationToken): Thenable<boolean>
    {
        return Promise.resolve(false);
    }

    provideBrowseConfiguration(token?: vscode.CancellationToken): Thenable<cpptools.WorkspaceBrowseConfiguration | null> {
        return Promise.resolve(null);
    }

    canProvideBrowseConfigurationsPerFolder(token?: vscode.CancellationToken): Thenable<boolean> {
        return Promise.resolve(false);
    }

    async provideFolderBrowseConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<cpptools.WorkspaceBrowseConfiguration | null> {
        return Promise.resolve(null);
    }

    dispose() {
        // throw new Error('Method not implemented.');
    }

    ///////////////////////////////////////////////////////////////////

    private setProvidedConfig(uri: vscode.Uri, config: cpptools.SourceFileConfigurationItem)
    {
        const configText = new vscode.MarkdownString();

        configText.appendMarkdown(`# \`${uri.fsPath}\`\n\n`);
        configText.appendMarkdown(`**C++ Standard:** \`${config.configuration.standard ?? "not set"}\`\n\n`);
        configText.appendMarkdown(`**Compiler Path:** \`${config.configuration.compilerPath ?? "not set"}\`\n\n`);
        configText.appendMarkdown(`**Compiler Args:** \`${config.configuration.compilerArgs?.join(' ') ?? "not set"}\`\n\n`);
        configText.appendMarkdown(`**Include Paths:**\n\n${config.configuration.includePath?.map(p => `- \`${p}\``).join('\n') ?? "not set"}\n\n`);
        configText.appendMarkdown(`**Defines:**\n\n${config.configuration.defines?.map(d => `- \`${d}\``).join('\n') ?? "not set"}\n\n`);

        const docUri = this.virtualDocumentProvider.update('configuration.md', configText.value);

        const options: vscode.TextDocumentShowOptions = {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside
        };

        const label = `Valhalla Configuration: ${path.basename(uri.fsPath)}`;

        this.statusBarItem.text = `Valhalla: ${path.basename(uri.fsPath)}`;
        this.statusBarItem.tooltip = configText;
        this.statusBarItem.command = {
            title: 'Show Configuration',
            command: 'vscode.open',
            arguments: [docUri, options, label]
        }

        this.statusBarItem.show();
    }

    ///////////////////////////////////////////////////////////////////

    private beforeRebuild() {
        this.logOutputChannel.info('Rebuilding Valhalla to update configurations...');
        this.projectJson.reset();
        this.compileCommands.reset();
    }

    private getOutputDir(): string | null
    {
        return this.builder.getOutputDir();
    }

    private async getCompileCommands(): Promise<CompileCommands | null> {
        const outputDir = this.getOutputDir();
        if (!outputDir)
            return null;

        await this.builder.buildDefaultTargetIfNeeded(
            () => this.beforeRebuild()
        );

        if (!await this.compileCommands.load(outputDir))
            return null;

        return this.compileCommands;
    }

    // private getSystemIncludes()
    // {
    //     // const valhallaDir = findProjectRootInWorkspace();
    //     const outputDir = this.getOutputDir();
    //     const includeDir = path.join(outputDir, 'system_includes', 'include');
    //     const dirs: string[] = [];

    //     for (const entry of fs.readdirSync(includeDir, { withFileTypes: true })) {
    //         if (entry.isDirectory()) {
    //             console.log(`Found system include directory: ${entry.name}`);
    //             dirs.push(path.join(includeDir, entry.name));
    //         }
    //     }

    //     return dirs;
    // }

    private async getSourceFileConfiguration(uri: vscode.Uri): Promise<cpptools.SourceFileConfigurationItem | null> {

        const entry = await this.getFromCompileCommands(uri);
        if (entry) {
            return {
                uri,
                configuration: entry
            };
        }

        const pjEntry = await this.getFromProjectJson(uri);
        if (pjEntry) {
            return {
                uri,
                configuration: pjEntry,
            };
        }

        return null;
    }

    private async getProjectJson(): Promise<ProjectJson | null>
    {
        const outputDir = this.getOutputDir();

        if (!outputDir)
            return null;

        await this.builder.buildDefaultTargetIfNeeded(
            () => this.beforeRebuild()
        );

        await this.projectJson.load(outputDir);
        return this.projectJson;
    }

    private async getFromCompileCommands(uri: vscode.Uri): Promise<cpptools.SourceFileConfiguration | null>
    {
        const compileCommands = await this.getCompileCommands();
        if (!compileCommands) {
            return null;
        }

        const entry = compileCommands.getSourceFileConfiguration(uri);
        return entry ?? null;
    }

    private async getFromProjectJson(uri: vscode.Uri): Promise<cpptools.SourceFileConfiguration | null>
    {
        const projectJson = await this.getProjectJson();
        if (!projectJson) {
            return null;
        }

        const valhallaFolder = this.settings.get(Setting.valhallaFolder);
        if (!valhallaFolder) {
            return null;
        }
        const target = projectJson.getSourceFileConfiguration(valhallaFolder.fsPath, uri, this.compileCommands.cpp);
        return target ?? null;
    }

    // private async extractSystemIncludes(uri: vscode.Uri)
    // {
    //     const valhallaDir = findProjectRootInWorkspace();
    //     const outputDir = this.getOutputDir();
    //     const interact = new Interactions([...this.gnbCommand, '--shell'], { cwd: valhallaDir, shell: false }, this.buildOutputChannel);
    //     const ee = await this.getCompileCommandForFile(uri);

    //     if (!ee) {
    //         vscode.window.showErrorMessage(`Failed to get compile command for ${uri.fsPath}. Cannot extract system includes.`);
    //         return;
    //     }

    //     const compilerPath = ee._compilerPath;

    //     await interact.start();

    //     interact.sendInput(`${compilerPath} -E -x c++ - -v /dev/null\n`);
    //     await interact.waitLine(line => line.includes('#include <...> search starts here:'), 5000)

    //     const paths: string[] = [];

    //     await interact.waitLine(line => {
    //         if (line.includes('End of search list.')) {
    //             return true;
    //         }

    //         const match = line.match(/^\s+(\/.*)$/);
    //         if (match) {
    //             paths.push(match[1]);
    //         }

    //         return false;
    //     }, 5000);

    //     interact.stop();
    // }

    private checkOutputDirExists(): Thenable<void>
    {
        const outputDir = this.getOutputDir();
        if (!outputDir)
            return Promise.resolve();

        if (fs.existsSync(outputDir))
            return Promise.resolve();

        const buildNowButton = 'Build Now';
        const skipButton = 'Skip';
        return vscode.window.showWarningMessage(`Output directory ${outputDir} does not exist.`, buildNowButton, skipButton)
        .then(async answer => {;
            if (answer === buildNowButton) {
                this.compileCommands.reset();
                this.projectJson.reset();
                await this.builder.buildDefaultTarget();
            }
        });
    }
}
