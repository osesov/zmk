// Integrate with CppTools to provide IntelliSense for Valhalla
import * as vscode from 'vscode';
import * as cpptools from 'vscode-cpptools';
import { AppServiceContainer, AppServices } from '../AppServices';
import { ISettingsService, Setting } from '../ISettingsService';
import { IValhallaCppToolsProvider } from '../IValhallaCppTools';
import { ISourceFileConfigurationService } from '../ISourceFileConfigurationService';

type ValhallaCppToolsProviderServiceDeps = Pick<AppServices, 'settings' | 'context' | 'sourceFileInfo' | 'logOutputChannel' | 'buildComplete' | 'initialBuild'>;

export class ValhallaCppToolsProviderService implements cpptools.CustomConfigurationProvider, IValhallaCppToolsProvider
{
    private settings: ISettingsService;
    private logOutputChannel: vscode.LogOutputChannel;
    private sourceFileInfo: ISourceFileConfigurationService;

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

        const provider = new ValhallaCppToolsProviderService({
            settings: services.get('settings'),
            context: services.get('context'),
            sourceFileInfo: services.get('sourceFileInfo'),
            logOutputChannel: services.get('logOutputChannel'),
            buildComplete: services.get('buildComplete'),
            initialBuild: services.get('initialBuild'),
        }, cppToolsApi);
        return provider;
    }

    public constructor(deps: ValhallaCppToolsProviderServiceDeps, private cppToolsApi: cpptools.CppToolsApi) {
        const settings: ISettingsService = deps.settings;
        const context: vscode.ExtensionContext = deps.context;

        this.extensionId = context.extension.id;
        this.settings = settings;
        this.sourceFileInfo = deps.sourceFileInfo;
        this.logOutputChannel = deps.logOutputChannel;

        const buildCompleteEvent = deps.buildComplete;
        const initialBuild = deps.initialBuild;

        context.subscriptions.push(this);

        cppToolsApi.registerCustomConfigurationProvider(this);
        initialBuild.then(() => {
            cppToolsApi.notifyReady(this);
            this.sourceFileInfo.onDidChangeSourceFileConfiguration(() => {
                this.cppToolsApi?.didChangeCustomConfiguration(this);
            });

            buildCompleteEvent(success => {
                if (success) {
                    this.logOutputChannel.info('Build completed successfully. Updating IntelliSense configuration...');
                } else {
                    this.logOutputChannel.error('Build failed. IntelliSense configuration may be outdated.');
                }
                cppToolsApi.didChangeCustomConfiguration(this);
            });

            this.sourceFileInfo.onDidChangeBrowseConfiguration(() => {
                cppToolsApi.didChangeCustomBrowseConfiguration(this);
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
        const hasConfig = !!(await this.sourceFileInfo.getSourceFileConfiguration(uri));
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
            const config = await this.sourceFileInfo.getSourceFileConfiguration(uri);
            if (config) {
                result.push({
                    uri: uri,
                    configuration: config,
                });
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
        return await this.sourceFileInfo.getBrowseConfiguration();
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
}
