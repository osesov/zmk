// Integrate with CppTools to provide IntelliSense for Valhalla
import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';
import path from 'path';
import { ProjectInfo } from '../../components/ProjectInfo';
import { CompileCommands } from '../../components/CompileCommands';
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { ISettingsService, Setting } from '../ISettingsService';
import { IValhallaCppToolsProvider } from '../IValhallaCppTools';
import { IVirtualDocumentProvider } from '../IVirtualDocumentProvider';
import { IBuilderService } from '../IBuilderService';
import { IBuildStatusService } from '../IBuildStatusService';
import { ToolchainInfo } from '../../components/ToolchainInfo';
import { MutableSourceFileConfiguration } from '../../components/SourceFileConfiguration';
import { IProjectInfoService } from '../IProjectInfoService';

export class ValhallaCppToolsProviderService implements cpptools.CustomConfigurationProvider, IValhallaCppToolsProvider
{
    private cppToolsApi: cpptools.CppToolsApi | undefined;
    private settings: ISettingsService;
    private virtualDocumentProvider: IVirtualDocumentProvider;
    private logOutputChannel: vscode.LogOutputChannel;
    private builder: IBuilderService;
    private buildStatus: IBuildStatusService;

    private projectInfo: IProjectInfoService;
    private compileCommands = new CompileCommands();
    private toolchainInfo = new ToolchainInfo();

    private readonly providedConfigurations = new Map<string, MutableSourceFileConfiguration>();
    private sourceFileConfiguration = new vscode.EventEmitter<void>();
    public readonly onDidChangeSourceFileConfiguration = this.sourceFileConfiguration.event;

    static async create(services: ServiceContainer<AppServices>): Promise<ValhallaCppToolsProviderService | null> {
        const settings = services.get('settings')

        if (settings.get(Setting.disableCppToolsIntegration)) {
            return null;
        }

        const cppToolsApi = await cpptools.getCppToolsApi(cpptools.Version.latest);

        if (!cppToolsApi) {
            vscode.window.showErrorMessage('C/C++ extension is not installed. Please install it to enable IntelliSense for Valhalla.');
            return null;
        }

        const provider = new ValhallaCppToolsProviderService(services, cppToolsApi);
        return provider;
    }

    public constructor(private services: ServiceContainer<AppServices>, cppToolsApi: cpptools.CppToolsApi) {
        const settings: ISettingsService = services.get('settings');
        const context: vscode.ExtensionContext = services.get('context');

        this.cppToolsApi = cppToolsApi;
        this.extensionId = context.extension.id;
        this.settings = settings;
        this.builder = services.get('builder');
        this.buildStatus = services.get('buildStatus');
        this.projectInfo = services.get('projectInfo');
        this.virtualDocumentProvider = services.get('virtualDocumentProvider');
        this.logOutputChannel = services.get('logOutputChannel');

        this.resetState();

        settings.onChange(event => {
            if (event.affects(Setting.config)
                || event.affects(Setting.target)
                || event.affects(Setting.gnbFlags)
                || event.affects(Setting.gnFlags)
                || event.affects(Setting.workspaceFolders)
            ) {
                this.logOutputChannel.info('Configuration changed. Invalidating caches...');
                this.resetState();
                // cppToolsApi.didChangeCustomConfiguration(this);
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

        context.subscriptions.push(this);

        cppToolsApi.registerCustomConfigurationProvider(this);
        this.buildStatus.initialBuildStatus.wait.then(() => { cppToolsApi.notifyReady(this); });
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
        // essentially we can provide per-workspace browse configuration (provideFolderBrowseConfiguration),
        // but that requires some refactoring, since all the components currently assume a single workspace folder.
        return Promise.resolve(true);
    }

    async provideBrowseConfiguration(token?: vscode.CancellationToken): Promise<cpptools.WorkspaceBrowseConfiguration | null> {
        return await this.getBrowseConfiguration();
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

    public getProvidedConfiguration(uri: vscode.Uri): MutableSourceFileConfiguration | null
    {
        const config = this.providedConfigurations.get(uri.toString());
        return config ?? null;
    }

    private setProvidedConfig(uri: vscode.Uri, config: cpptools.SourceFileConfigurationItem)
    {
        this.providedConfigurations.set(uri.toString(), config.configuration);
        this.sourceFileConfiguration.fire();
    }

    ///////////////////////////////////////////////////////////////////

    private resetState() {
        this.projectInfo.getProjectInfo().reset();
        this.compileCommands.reset();
        this.toolchainInfo.reset();
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
            () => this.resetState()
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

        let entry = await this.getFromCompileCommands(uri);
        if (!entry)
            entry = await this.getFromProjectInfo(uri);

        if (!entry)
            return null;

        entry = await this.enrich(entry);

        return {
            uri,
            configuration: entry
        };
    }

    private async getLoadedProjectInfo(): Promise<ProjectInfo | null>
    {
        await this.projectInfo.getProjectDescription(); // trigger loading if not loaded yet
        return this.projectInfo.getProjectInfo();
    }

    private async getFromCompileCommands(uri: vscode.Uri): Promise<MutableSourceFileConfiguration | null>
    {
        const compileCommands = await this.getCompileCommands();
        if (!compileCommands) {
            return null;
        }

        const entry = compileCommands.getSourceFileConfiguration(uri);
        return entry ?? null;
    }

    private async getFromProjectInfo(uri: vscode.Uri): Promise<MutableSourceFileConfiguration | null>
    {
        const projectJson = await this.getLoadedProjectInfo();
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

    private async enrich(info: MutableSourceFileConfiguration): Promise<MutableSourceFileConfiguration>
    {
        const outputDir = this.getOutputDir();
        const toolchainPath = this.settings.get(Setting.toolchainInfo);
        const compilerArgs = this.settings.get(Setting.compiler);
        const intelliSenseMode = this.settings.get(Setting.intelliSenseMode);
        const result = Object.assign({}, info);

        const includeDirs = this.settings.get(Setting.includeDirs)
        if (includeDirs && includeDirs.length > 0)
            result.includePath = [...includeDirs, ...result.includePath]
        const defines = this.settings.get(Setting.defines);
        if (defines)
            result.defines = [...Object.entries(defines).map(([k, v]) => `${k}=${v}`), ...result.defines];

        if (compilerArgs && compilerArgs.length > 0 && !result.compilerPath) {
            result.compilerPath = compilerArgs[0];
            result.compilerArgs = compilerArgs.slice(1);
        }

        if (intelliSenseMode && !result.intelliSenseMode) {
            result.intelliSenseMode = intelliSenseMode as MutableSourceFileConfiguration['intelliSenseMode'];
        }

        const loaded = await this.toolchainInfo.load(outputDir, toolchainPath)
        if (loaded) {
            const toolchainIncludeDirs = this.toolchainInfo.getIncludeDirs();
            if (toolchainIncludeDirs && toolchainIncludeDirs.length > 0)
                result.includePath = [...result.includePath, ...toolchainIncludeDirs]
        }

        return result;
    }

    private async getBrowseConfiguration(): Promise<cpptools.WorkspaceBrowseConfiguration | null>
    {
        const projectInfo = await this.getLoadedProjectInfo();
        if (!projectInfo) {
            return null;
        }

        const valhallaFolder = this.settings.get(Setting.valhallaFolder);
        if (!valhallaFolder) {
            return null;
        }

        const browseConfig = projectInfo.getBrowseConfiguration(this.settings);
        if (!browseConfig) {
            return null;
        }

        return {
            browsePath: browseConfig.browsePath,
            standard: browseConfig.standard,
            compilerPath: browseConfig.compilerPath,
            compilerArgs: browseConfig.compilerArgs
        };
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

}
