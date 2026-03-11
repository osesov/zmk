// Integrate with CppTools to provide IntelliSense for Valhalla
import * as vscode from 'vscode';
import { CppToolsApi, Version, CustomConfigurationProvider, getCppToolsApi, WorkspaceBrowseConfiguration, SourceFileConfigurationItem, SourceFileConfiguration, CppStandard } from 'vscode-cpptools';
import { Settings } from './Settings';
import { findProjectRootInWorkspace, isDevContainerHost } from './utils';
import path from 'path';
import fs from 'fs';
import child_process from 'child_process';
import { Interactions } from './Interactions';
import { ProjectJson } from './ProjectJson';
import { CompileCommands } from './CompileCommands';

const configScheme = 'zmk-config';

enum SettingName
{
    zmkSection = 'zmk',

    configSetting = 'config',
    targetSetting = 'target',
    gnbFlagsSetting = 'gnbFlags',
    gnFlagsSetting = 'gnFlags',

    fqConfigSetting = `${zmkSection}.${configSetting}`,
    fqTargetSetting = `${zmkSection}.${targetSetting}`,
}

export class ValhallaCppToolsProvider implements CustomConfigurationProvider, vscode.TextDocumentContentProvider {
    private cppToolsApi: CppToolsApi | undefined;
    private settings: Settings;

    private projectJson: ProjectJson = new ProjectJson();
    private compileCommands = new CompileCommands();

    private buildOutputChannel = vscode.window.createOutputChannel('Valhalla Build');
    private statusBarItem: vscode.StatusBarItem;
    private gnbCommand: string[]

    static async create(context: vscode.ExtensionContext, settings: Settings): Promise<ValhallaCppToolsProvider | null> {
        const cppToolsApi = await getCppToolsApi(Version.latest);

        if (!cppToolsApi) {
            vscode.window.showErrorMessage('C/C++ extension is not installed. Please install it to enable IntelliSense for Valhalla.');
            return null;
        }

        const provider = new ValhallaCppToolsProvider(context, cppToolsApi, settings);
        return provider;
    }

    constructor(context: vscode.ExtensionContext, cppToolsApi: CppToolsApi, settings: Settings) {
        this.cppToolsApi = cppToolsApi;
        this.extensionId = context.extension.id;
        this.settings = settings;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

        this.statusBarItem.text = 'Valhalla: Ready';
        this.statusBarItem.show();

        if (isDevContainerHost())
            this.gnbCommand = ["./gnbc"];
        else
            this.gnbCommand = ["./gnb"];

        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(SettingName.fqConfigSetting) || event.affectsConfiguration(SettingName.fqTargetSetting)) {
                cppToolsApi.didChangeCustomConfiguration(this);
            }
        }));

        context.subscriptions.push(this.statusBarItem);
        context.subscriptions.push(this);
        context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(configScheme, this));
        context.subscriptions.push(vscode.commands.registerCommand('zmk.showConfiguration', (uri: vscode.Uri) => {
            const configText = this.providedConfig ?? 'No configuration provided';
            vscode.workspace.openTextDocument({ content: configText, language: 'markdown' }).then(doc => {
                vscode.window.showTextDocument(doc, { preview: true });
            });
        }));

        cppToolsApi.registerCustomConfigurationProvider(this);
        cppToolsApi.notifyReady(this);
    }

    public readonly name = 'Valhalla';
    public readonly extensionId: string;

    async canProvideConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<boolean> {
        // TODO: provide configuration withing valhalla only
        const hasConfig = (await this.getSourceFileConfiguration(uri)) !== null;

        this.buildOutputChannel.appendLine(`Checking if we can provide configuration for ${uri.fsPath}: ${hasConfig ? 'Yes' : 'No'}...`);
        return hasConfig;
    }

    async provideConfigurations(uris: vscode.Uri[], token?: vscode.CancellationToken): Promise<SourceFileConfigurationItem[]>
    {
        const result: SourceFileConfigurationItem[] = [];

        for (const uri of uris) {
            this.buildOutputChannel.appendLine(`Providing configuration for ${uri.fsPath}...`);
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

    provideBrowseConfiguration(token?: vscode.CancellationToken): Thenable<WorkspaceBrowseConfiguration | null> {
        // throw new Error('Method not implemented.');
        return Promise.resolve(null);
    }

    canProvideBrowseConfigurationsPerFolder(token?: vscode.CancellationToken): Thenable<boolean> {
        // throw new Error('Method not implemented.');
        return Promise.resolve(false);
    }

    async provideFolderBrowseConfiguration(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<WorkspaceBrowseConfiguration | null> {
        // throw new Error('Method not implemented.');
        // await this.getContainingFolder(uri);
        return Promise.resolve(null);
    }

    dispose() {
        // throw new Error('Method not implemented.');
    }

    ///////////////////////////////////////////////////////////////////
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;
    private providedConfig: string | null = null;

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.providedConfig ?? 'No configuration provided';
    }

    private setProvidedConfig(uri: vscode.Uri, config: SourceFileConfigurationItem)
    {
        const showURI = `${configScheme}://configuration`;
        const configText = new vscode.MarkdownString();

        configText.appendMarkdown(`# \`${uri.fsPath}\`\n\n`);
        configText.appendMarkdown(`**C++ Standard:** \`${config.configuration.standard ?? "not set"}\`\n\n`);
        configText.appendMarkdown(`**Compiler Path:** \`${config.configuration.compilerPath ?? "not set"}\`\n\n`);
        configText.appendMarkdown(`**Compiler Args:** \`${config.configuration.compilerArgs?.join(' ') ?? "not set"}\`\n\n`);
        configText.appendMarkdown(`**Include Paths:**\n\n${config.configuration.includePath?.map(p => `- \`${p}\``).join('\n') ?? "not set"}\n\n`);
        configText.appendMarkdown(`**Defines:**\n\n${config.configuration.defines?.map(d => `- \`${d}\``).join('\n') ?? "not set"}\n\n`);

        this.statusBarItem.text = `Valhalla: ${path.basename(uri.fsPath)}`;
        this.statusBarItem.tooltip = configText;
        this.statusBarItem.command = {
            title: 'Show Configuration',
            command: 'vscode.open',
            arguments: [showURI]
        }

        this.providedConfig = configText.value;
        this.onDidChangeEmitter.fire(vscode.Uri.parse(showURI));
        this.statusBarItem.show();
    }

    ///////////////////////////////////////////////////////////////////

    private async buildTarget(target: string | undefined): Promise<void>
    {
        const outputChannel = this.buildOutputChannel;
        const configuration = vscode.workspace.getConfiguration(SettingName.zmkSection);
        const cwd = findProjectRootInWorkspace();
        const valhallaConfig = configuration.get<string>(SettingName.configSetting);
        const gnbFlags = configuration.get<string[]>(SettingName.gnbFlagsSetting) ?? [];
        const gnFlags = configuration.get<string[]>(SettingName.gnFlagsSetting) ?? [];

        if (!valhallaConfig) {
            vscode.window.showErrorMessage(`Valhalla configuration is not set. Please set ${SettingName.fqConfigSetting} in your settings.`);
            return;
        }

        const cmdLine = [...this.gnbCommand, valhallaConfig, ...gnbFlags, '--', ...gnFlags, ...(target ? [target] : [])];

        outputChannel.appendLine(`>>> Running command: ${cmdLine.join(' ')}`);
        outputChannel.appendLine(`>>> In directory: ${cwd}`);
        // outputChannel.show(true);

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building Valhalla (${target ?? 'default target'})...`,
            cancellable: true
        }, (progress, token) => {

            return new Promise((resolve, reject) => {
                const isWindows = process.platform === 'win32';
                const proc = child_process.spawn(cmdLine[0], cmdLine.slice(1), {
                    cwd,
                    shell: false,
                    stdio: ['ignore', 'inherit', 'pipe'], // inherit stdout, pipe stderr
                    // Linux: start a new session so we can kill the whole process tree if needed
                    // Windows: don't detach, otherwise it will open a new console window
                    detached: isWindows ? false : true
                });

                token.onCancellationRequested(() => {
                    outputChannel.appendLine('>>> Build cancelled by user.');
                    if (proc.pid !== undefined) {
                        if (isWindows) {
                            child_process.exec(`taskkill /PID ${proc.pid} /T /F`);
                        } else {
                            process.kill(-proc.pid, 'SIGTERM'); // kill the whole process tree
                        }
                    }
                    reject(new Error('Build cancelled by user.'));
                });

                proc.on('spawn', () => { });
                proc.on('error', (err) => {
                    outputChannel.appendLine(`>>> Failed to start build process: ${err.message}`);
                    outputChannel.show(true);
                    reject(new Error(`Failed to start build process: ${err.message}`));
                });

                proc.on('exit', (code, signal) => {
                    if (code === 0) {
                        outputChannel.appendLine('>>> Build completed successfully.');
                        resolve();
                    } else {
                        outputChannel.appendLine(`>>> Build failed with exit code ${code} and signal ${signal}.`);
                        outputChannel.show(true);
                        reject(new Error(`Build failed with exit code ${code} and signal ${signal}.`));
                    }
                });
            });
        });
    }

    private getOutputDir(): string
    {
        const configuration = vscode.workspace.getConfiguration(SettingName.zmkSection);
        const valhallaDir = findProjectRootInWorkspace();
        const valhallaConfig = configuration.get<string>(SettingName.configSetting);
        const outputDirName = `out.${valhallaConfig}`
        const outputDir = path.join(valhallaDir, outputDirName);
        return outputDir;
    }

    private async getCompileCommands(): Promise<CompileCommands | null> {
        const outputDir = this.getOutputDir();

        if (!fs.existsSync(outputDir)) {
            this.compileCommands.reset();
            await this.buildTarget('empty');

            if (!fs.existsSync(outputDir)) {
                vscode.window.showErrorMessage(`Failed to build Valhalla. Output directory ${outputDir} does not exist.`);
                return null;
            }
        }

        if (!await this.compileCommands.load(outputDir))
            return null;

        return this.compileCommands;
    }

    private getSystemIncludes()
    {
        // const valhallaDir = findProjectRootInWorkspace();
        const outputDir = this.getOutputDir();
        const includeDir = path.join(outputDir, 'system_includes', 'include');
        const dirs: string[] = [];

        for (const entry of fs.readdirSync(includeDir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                console.log(`Found system include directory: ${entry.name}`);
                dirs.push(path.join(includeDir, entry.name));
            }
        }

        return dirs;
    }

    private async getSourceFileConfiguration(uri: vscode.Uri): Promise<SourceFileConfigurationItem | null> {

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

        if (!fs.existsSync(outputDir)) {
            this.projectJson.reset();
            await this.buildTarget('empty');

            if (!fs.existsSync(outputDir)) {
                vscode.window.showErrorMessage(`Failed to build Valhalla. Output directory ${outputDir} does not exist.`);
                return null;
            }
        }

        await this.projectJson.load(outputDir);
        return this.projectJson;
    }

    private async getFromCompileCommands(uri: vscode.Uri): Promise<SourceFileConfiguration | null>
    {
        const compileCommands = await this.getCompileCommands();
        if (!compileCommands) {
            return null;
        }

        const entry = compileCommands.getSourceFileConfiguration(uri);
        return entry ?? null;
    }

    private async getFromProjectJson(uri: vscode.Uri): Promise<SourceFileConfiguration | null>
    {
        const projectJson = await this.getProjectJson();
        if (!projectJson) {
            return null;
        }

        const valhallaDir = findProjectRootInWorkspace();
        const target = projectJson.getSourceFileConfiguration(valhallaDir, uri, this.compileCommands.cpp);
        if (target)
            return target;

        return null;
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
