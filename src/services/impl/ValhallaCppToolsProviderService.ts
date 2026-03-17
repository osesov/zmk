// Integrate with CppTools to provide IntelliSense for Valhalla
import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';
import { ProjectInfo } from '../../components/ProjectInfo';
import { CompileCommands } from '../../components/CompileCommands';
import { AppServiceContainer } from '../AppServices';
import { ISettingsService, Setting } from '../ISettingsService';
import { IValhallaCppToolsProvider } from '../IValhallaCppTools';
import { IBuilderService } from '../IBuilderService';
import { CompilerStandard, IntelliSenseMode, MutableSourceFileConfiguration } from '../../components/SourceFileConfiguration';
import { IProjectInfoService } from '../IProjectInfoService';

export class ValhallaCppToolsProviderService implements cpptools.CustomConfigurationProvider, IValhallaCppToolsProvider
{
    private cppToolsApi: cpptools.CppToolsApi | undefined;
    private settings: ISettingsService;
    private logOutputChannel: vscode.LogOutputChannel;
    private builder: IBuilderService;
    private projectInfo: IProjectInfoService;
    private compileCommands = new CompileCommands();

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

    public constructor(private services: AppServiceContainer, cppToolsApi: cpptools.CppToolsApi) {
        const settings: ISettingsService = services.get('settings');
        const context: vscode.ExtensionContext = services.get('context');

        this.cppToolsApi = cppToolsApi;
        this.extensionId = context.extension.id;
        this.settings = settings;
        this.builder = services.get('builder');
        this.projectInfo = services.get('projectInfo');
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
        initialBuild.then(() => { cppToolsApi.notifyReady(this); });
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

    private resetState() {
        this.projectInfo.getProjectInfo().reset();
        this.compileCommands.reset();
    }

    private getOutputDir(): string | null
    {
        const settings = this.services.get('settings');
        return settings.get(Setting.outputDir) ?? null;
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
