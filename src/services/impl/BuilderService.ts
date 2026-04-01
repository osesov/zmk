import * as child_process from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { AppServices } from "../AppServices";
import { BuildCommand, BuildCommandOptions, BuildMode, BuildResult, BuildTargetOptions, IBuilderService, NeedBuildResult } from "../IBuilderService";
import { ServiceContainer } from "../ServiceContainer";
import { expectNever, expectNotNull, isBuildDirValid, isDevContainerHost, withoutException } from '../../components/utils';
import { ISettingsService, JsonValue, Setting, Toolchain } from '../ISettingsService';
import path from 'path';
import { AsyncCache } from '../../components/LazyCache';

const defaultBuildTarget = ':empty';
const allBuildTarget = ':valhalla_sysroot'; // from BUILD.gn

export class BuilderService implements IBuilderService
{
    private gnbCommand: string[];

    private _onBuildStarted = new vscode.EventEmitter<void>();
    public readonly onBuildStarted = this._onBuildStarted.event;

    private _onBuildFinished = new vscode.EventEmitter<BuildResult>();
    public readonly onBuildFinished = this._onBuildFinished.event;

    private readonly _toolchain = new AsyncCache<Toolchain | null>(() => this.selectToolchain());
    private readonly settings: ISettingsService;

    constructor(private services: ServiceContainer <AppServices>)
    {
        this.settings = services.get('settings');

        if (isDevContainerHost())
            this.gnbCommand = ["../gnbc"];
        else
            this.gnbCommand = ["../gnb"];

        const initialBuild = services.get('initialBuild');
        const buildComplete = services.get('buildComplete');

        const resetState = () => {
            // this.argsFile.reset();
            this._toolchain.reset();
        };

        initialBuild.finally(() => resetState());
        buildComplete(() => resetState());
        this.settings.onChange(() => resetState());
    }

    async toolchain(): Promise<Toolchain | null> {
        return this._toolchain.get();
    }

    public getConfigsDir(): string | null
    {
        const valhallaDir = this.settings.get(Setting.valhallaFolder);
        if (!valhallaDir)
            return null;

        return path.join(valhallaDir.fsPath, 'configs');
    }

    public getOutputDir(): string | null
    {
        return this.settings.get(Setting.outputDir) ?? null;
     }

    async buildTarget(target: string | undefined, options ?: BuildTargetOptions): Promise<BuildResult>
    {
        const outputChannel = this.services.get('buildOutputChannel');

        outputChannel.clear();

        const buildCommand = await this.getBuildCommand({target: target}, options?.buildMode ?? BuildMode.build);
        if (!buildCommand) {
            vscode.window.showErrorMessage('Cannot build: Valhalla folder or configuration is not set.');
            return { success: false, status: 'Valhalla folder or configuration is not set', output: [] };
        }

        outputChannel.appendLine(`Running command: ${buildCommand.command.join(' ')}`);
        outputChannel.appendLine(`In directory: ${buildCommand.cwd}`);
        // outputChannel.show(true);

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Running Valhalla build:\n${buildCommand.actualConfig}-${buildCommand.actualTarget ?? 'default target'}...`,
            cancellable: true
        }, (progress, token) => {
            this._onBuildStarted.fire();
            let output: string[] = [];

            return new Promise<BuildResult>((resolve, reject) => {
                const isWindows = process.platform === 'win32';

                withoutException<void>(() => fs.mkdirSync(buildCommand.cwd, { recursive: true }), undefined);
                const proc = child_process.spawn(buildCommand.command[0], buildCommand.command.slice(1), {
                    cwd: buildCommand.cwd,
                    env: buildCommand.env,
                    shell: false,
                    stdio: ['ignore', 'pipe', 'pipe'], // inherit stdout, pipe stderr
                    // Linux: start a new session so we can kill the whole process tree if needed
                    // Windows: don't detach, otherwise it will open a new console window
                    detached: isWindows ? false : true
                });

                token.onCancellationRequested(() => {
                    outputChannel.appendLine('Build cancelled by user!');
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
                    outputChannel.appendLine(`Failed to start build process: ${err.message}`);
                    outputChannel.show(true);
                    resolve({ success: false, status: `failed to start build process: ${err.message}`, output });
                });

                proc.on('exit', (code, signal) => {
                    if (code === 0) {
                        outputChannel.appendLine('Build completed successfully.');
                        resolve({ success: true, status: 0, output });
                    } else {
                        outputChannel.appendLine(`Build failed with exit code ${code} and signal ${signal}.`);
                        outputChannel.show(true);
                        resolve({ success: false, status: code ?? signal ?? 'unknown', output });

                    }
                });

                const logger = (prefix: string, stdout: boolean) => (data: Buffer) => {
                    const lines = data.toString().split('\n');
                    for (const line of lines) {
                        outputChannel.appendLine(`[${prefix}] ${line.trimEnd()}`);
                        output.push(line);

                        if (stdout) {
                            options?.onStdout?.(line);
                        } else {
                            options?.onStderr?.(line);
                        }
                    }
                };

                proc.stderr.on('data', logger('STDERR', false));
                proc.stdout.on('data', logger('STDOUT', true));
            })
            .then((status) => {
                this._onBuildFinished.fire(status);
                return status;
            })
            .catch((err) => {
                this._onBuildFinished.fire({ success: false, status: `Build failed: ${err.message}`, output });
                return { success: false, status: `Build failed: ${err.message}`, output };
            });
        });
    }

    public async needBuild(): Promise<NeedBuildResult>
    {
        const isValhallaProject = this.settings.get(Setting.isValhallaProject);
        if (!isValhallaProject) {
            return NeedBuildResult.no;
        }

        const outputDir = this.getOutputDir();
        if (!outputDir) {
            return NeedBuildResult.configIncomplete;
        }

        const isValid = await isBuildDirValid(outputDir);
        return isValid ? NeedBuildResult.no : NeedBuildResult.yes;
    }

    public async buildDefaultTargetIfNeeded(): Promise<BuildResult>
    {
        const needBuildResult = await this.needBuild();
        if (needBuildResult === NeedBuildResult.no) {
            return { success: true, status: 0, output: [] };
        }
        if (needBuildResult === NeedBuildResult.configIncomplete) {
            vscode.window.showWarningMessage('Build configuration is incomplete. Check "zmk.config" setting.');
            return { success: false, status: null, output: [] };
        }

        const result = await this.buildTarget(defaultBuildTarget);
        if (result.success && (await this.needBuild() !== NeedBuildResult.no)) {
            vscode.window.showErrorMessage(`Failed to build Valhalla.`);
            return result;
        }
        return result;
    }

    public async buildDefaultTarget(): Promise<BuildResult>
    {
        return await this.buildTarget(defaultBuildTarget);
    }

    public async buildAllTarget(): Promise<BuildResult>
    {
        return await this.buildTarget(allBuildTarget);
    }

    private async toolchainSelectorInternal()
    {
        const argsFile = this.services.get('argsFile');
        const args = argsFile.getArgs();

        const crossOS = args?.get<string>('cross_os') || 'none';
        const crossCPU = args?.get<string>('cross_cpu') || 'none';
        const crossABI = args?.get<string>('cross_abi') || 'none';

        return {crossOS, crossCPU, crossABI};
    }

    public async toolchainSelector(): Promise<string | null>
    {
        const {crossOS, crossCPU, crossABI} = await this.toolchainSelectorInternal();
        const parts = [crossCPU, crossOS, crossABI].filter(part => !!part);
        if (parts.length === 0) {
            return null;
        }

        return parts.join('-');
    }

    private async selectToolchain(): Promise<Toolchain | null>
    {
        const settings = this.services.get('settings');
        const toolchains = settings.get(Setting.toolchain);
        if (!toolchains || toolchains.length === 0) {
            return null;
        }

        const {crossOS, crossCPU, crossABI} = await this.toolchainSelectorInternal();

        for (const toolchain of toolchains) {
            const pattern = toolchain.pattern;
            if (!pattern)
                continue;

            const parts = pattern.split('-');
            const [cpu, os, abi] = parts;
            const matchOS = os === crossOS || os === '*' || os === undefined;
            const matchCPU = cpu === crossCPU || cpu === '*' || cpu === undefined;
            const matchABI = abi === crossABI || abi === '*' || abi === undefined;

            if (matchOS && matchCPU && matchABI) {
                return toolchain;
            }
        }

        return null;
    }

    public async getBuildCommand(options ?: BuildCommandOptions, buildMode?: BuildMode): Promise<BuildCommand | null>
    {
        const settings = this.services.get('settings');
        const valhallaDir = settings.get(Setting.valhallaFolder);
        const buildDir = this.getOutputDir();
        const buildConfig = options?.config ?? settings.get(Setting.config);
        const testConfig = options?.config ?? settings.get(Setting.testConfig);
        const gnbFlags = options?.gnbFlags ?? settings.getOrDefault(Setting.gnbFlags, []);
        const gnFlags = options?.gnFlags ?? settings.getOrDefault(Setting.gnFlags, []);
        const configEnv = options?.env ?? settings.getOrDefault(Setting.env, {});
        let target: string | undefined;

        buildMode = options?.mode ?? buildMode ?? BuildMode.build;

        if (buildMode === BuildMode.test) {
            target = options?.target ?? settings.get(Setting.testTarget) ?? undefined;

            if (testConfig === null) {
                return null;
            }
        }
        else {
            target = options?.target ?? settings.get(Setting.target) ?? undefined;
        }

        if (!valhallaDir || !buildConfig || !buildDir) {
            return null;
        }

        const toolchain = await this._toolchain.get();

        type EnvObject = {[k: string] : JsonValue | null | undefined }
        const makeEnvironment = (...envs: (EnvObject | undefined)[]): Record<string, string> =>
        {
            const result: Record<string, string> = {}

            for (const env of envs) {
                if (!env)
                    continue;

                for (const [key, value] of Object.entries(env)) {
                    if (value === undefined || value === null)
                        delete result[key]
                    else
                        result[key] = String(value);
                }
            }
            return result;
        }

        const getActualTarget = (buildKind : BuildMode): string | undefined => {
            switch(buildKind) {
                default:
                    expectNever(buildKind);
                case BuildMode.build:
                case BuildMode.clean:
                case BuildMode.deepClean:
                case BuildMode.test:
                    return target;

                case BuildMode.buildCurrentFile:
                    return "${command:zmk.getCurrentFile}^";

                case BuildMode.buildAll:
                    return ":default";

                case BuildMode.buildEmpty:
                    return ":empty";
            }
        }

        const prepareConfig = (buildKind: BuildMode): string => {
            switch(buildKind) {
                default:
                    expectNever(buildKind);
                case BuildMode.build:
                case BuildMode.buildCurrentFile:
                case BuildMode.buildAll:
                case BuildMode.buildEmpty:
                case BuildMode.clean:
                case BuildMode.deepClean:
                    return buildConfig;

                case BuildMode.test:
                    expectNotNull(testConfig);
                    return testConfig;
            }
        }

        const prepareCommand = (buildKind: BuildMode, actualConfig: string, actualTarget: string[]) => {
            const command = options?.command ?? this.gnbCommand;

            switch(buildKind) {
            default:
                expectNever(buildKind);
            case BuildMode.build:
            case BuildMode.buildAll:
            case BuildMode.buildCurrentFile:
                return [...command, actualConfig, ...gnbFlags, '--', ...gnFlags, ...actualTarget];

            case BuildMode.buildEmpty:
                return [...command, actualConfig, ...gnbFlags, '--', ...gnFlags, ...actualTarget];

            case BuildMode.clean:
                return [...command, actualConfig, '--clean', ...gnbFlags, '--', ...gnFlags, ...actualTarget];

            case BuildMode.deepClean:
                return [...command, actualConfig, '--deep-clean', ...gnbFlags, '--', ...gnFlags, ...actualTarget];

            case BuildMode.test:
                expectNotNull(testConfig);
                return [...command, actualConfig, ...gnbFlags, '--', ...gnFlags, ...actualTarget];
            }
        }

        if (target?.startsWith("//")) {
            target = target.substring(2);
        }

        const actualConfig = prepareConfig(buildMode);
        const actualTarget = getActualTarget(buildMode);
        const command = prepareCommand(buildMode, actualConfig, actualTarget ? [actualTarget] : []);
        const env = makeEnvironment(process.env, configEnv, options?.env, toolchain?.env);
        const cwd = buildDir;

        return { command, cwd, env, actualConfig, actualTarget, actualBuildMode: buildMode };
    }

    async listConfigs(): Promise<string[]>
    {
        const configsDir = this.getConfigsDir();
        if (!configsDir) {
            return [];
        }

        try {
            const entries = await fs.promises.readdir(configsDir, { withFileTypes: true });
            const configs = entries
                .filter(entry => entry.isFile() && entry.name.endsWith('.yaml'))
                .map(entry => entry.name.substring(0, entry.name.length - '.yaml'.length));
            return configs;
        } catch (err) {
            return [];
        }
    }

    getConfigPath(configName: string): Promise<string | null> {
        const configsDir = this.getConfigsDir();
        if (!configsDir) {
            return Promise.resolve(null);
        }

        const configPath = path.join(configsDir, `${configName}.yaml`);
        return fs.promises.access(configPath, fs.constants.R_OK)
            .then(() => configPath)
            .catch(() => null);
    }
}
