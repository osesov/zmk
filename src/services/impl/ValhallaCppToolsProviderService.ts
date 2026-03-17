// Integrate with CppTools to provide IntelliSense for Valhalla
import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';
import { AppServiceContainer } from '../AppServices';
import { ISettingsService, Setting } from '../ISettingsService';
import { IValhallaCppToolsProvider } from '../IValhallaCppTools';
import { IBuilderService } from '../IBuilderService';
import { CompilerStandard, IntelliSenseMode, MutableSourceFileConfiguration } from '../../components/SourceFileConfiguration';
import { IProjectInfoService } from '../IProjectInfoService';
import { ICompileCommandsService } from '../ICompileCommandsService';

export class ValhallaCppToolsProviderService implements cpptools.CustomConfigurationProvider, IValhallaCppToolsProvider
{
    private settings: ISettingsService;
    private logOutputChannel: vscode.LogOutputChannel;
    private builder: IBuilderService;
    private projectInfo: IProjectInfoService;
    private compileCommands: ICompileCommandsService;

    private readonly providedConfigurations = new Map<string, MutableSourceFileConfiguration>();
    private sourceFileConfiguration = new vscode.EventEmitter<void>();
    public readonly onDidChangeSourceFileConfiguration = this.sourceFileConfiguration.event;

    static async create(services: AppServiceContainer): Promise<ValhallaCppToolsProviderService | null> {
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

    public constructor(private services: AppServiceContainer, private cppToolsApi: cpptools.CppToolsApi) {
        const settings: ISettingsService = services.get('settings');
        const context: vscode.ExtensionContext = services.get('context');

        this.extensionId = context.extension.id;
        this.settings = settings;
        this.builder = services.get('builder');
        this.projectInfo = services.get('projectInfo');
        this.compileCommands = services.get('compileCommands');
        this.logOutputChannel = services.get('logOutputChannel');

        const buildCompleteEvent = services.get('buildComplete');
        const initialBuild = services.get('initialBuild');

        buildCompleteEvent(success => {
            if (success) {
                this.logOutputChannel.info('Build completed successfully. Updating IntelliSense configuration...');
            } else {
                this.logOutputChannel.error('Build failed. IntelliSense configuration may be outdated.');
            }
            cppToolsApi.didChangeCustomConfiguration(this);
        });

        context.subscriptions.push(this);

        cppToolsApi.registerCustomConfigurationProvider(this);
        initialBuild.then(() => {
            cppToolsApi.notifyReady(this);
            this.projectInfo.onChange(() => {
                this.cppToolsApi?.didChangeCustomConfiguration(this);
            });
            this.compileCommands.onChange(() => {
                this.cppToolsApi?.didChangeCustomConfiguration(this);
            });
        });
    }

    public readonly name = 'Valhalla';
    public readonly extensionId: string;

    private isValhallaProject(): boolean
    {
        const valhallaDir = this.settings.get(Setting.valhallaDir);
        return valhallaDir !== null;
    }

    async canProvideConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<boolean>
    {
        if (!this.isValhallaProject()) {
            return false;
        }
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

    async canProvideBrowseConfiguration(token?: vscode.CancellationToken): Promise<boolean>
    {
        if (!this.isValhallaProject()) {
            return false;
        }
        // essentially we can provide per-workspace browse configuration (provideFolderBrowseConfiguration),
        // but that requires some refactoring, since all the components currently assume a single workspace folder.
        return true;
    }

    async provideBrowseConfiguration(token?: vscode.CancellationToken): Promise<cpptools.WorkspaceBrowseConfiguration | null> {
        return await this.getBrowseConfiguration();
    }

    async canProvideBrowseConfigurationsPerFolder(token?: vscode.CancellationToken): Promise<boolean> {
        if (!this.isValhallaProject()) {
            return false;
        }
        return false;
    }

    async provideFolderBrowseConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<cpptools.WorkspaceBrowseConfiguration | null> {
        return null;
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
    private async getSourceFileConfiguration(uri: vscode.Uri): Promise<cpptools.SourceFileConfigurationItem | null> {

        let entry = this.getFromCompileCommands(uri);
        if (!entry)
            entry = this.getFromProjectInfo(uri);

        if (!entry)
            return null;

        entry = await this.enrich(entry);

        return {
            uri,
            configuration: entry
        };
    }

    private getFromCompileCommands(uri: vscode.Uri): MutableSourceFileConfiguration | null
    {
        return this.compileCommands.getSourceFileConfiguration(uri);
    }

    private getFromProjectInfo(uri: vscode.Uri): MutableSourceFileConfiguration | null
    {
        const target = this.projectInfo.getSourceFileConfiguration(uri, this.compileCommands.cxxCompiler);
        return target ?? null;
    }

    private async enrich(info: MutableSourceFileConfiguration): Promise<MutableSourceFileConfiguration>
    {
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
            result.intelliSenseMode = intelliSenseMode as IntelliSenseMode;
        }

        const toolchain = await this.builder.toolchain()
        if (toolchain) {
            if (!result.compilerPath && toolchain.compiler && toolchain.compiler.length > 0) {
                result.compilerPath = toolchain.compiler[0];
                result.compilerArgs = toolchain.compiler.slice(1);
            }

            if (toolchain.intelliSenseMode && !result.intelliSenseMode) {
                result.intelliSenseMode = toolchain.intelliSenseMode as IntelliSenseMode;
            }

            if (toolchain.cppStandard && !result.standard) {
                result.standard = toolchain.cppStandard as CompilerStandard;
            }

            if (toolchain.includeDirs && toolchain.includeDirs.length > 0) {
                result.includePath = [...toolchain.includeDirs, ...result.includePath];
            }

            if (toolchain.defines) {
                result.defines = [...Object.entries(toolchain.defines).map(([k, v]) => `${k}=${v}`), ...result.defines];
            }
        }

        return result;
    }

    private async getBrowseConfiguration(): Promise<cpptools.WorkspaceBrowseConfiguration | null>
    {
        const browseConfig = this.projectInfo.getBrowseConfiguration();
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
}
