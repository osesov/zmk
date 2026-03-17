import * as child_process from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { AppServices } from "../AppServices";
import { BuildCommand, BuildCommandOptions, BuildKind, IBuilderService } from "../IBuilderService";
import { ServiceContainer } from "../ServiceContainer";
import { assertNever, isDevContainerHost } from '../../components/utils';
import { JsonValue, Setting, Toolchain } from '../ISettingsService';
import path from 'path';
import { Completion } from '../../components/promise';
import { AsyncCache } from '../../components/LazyCache';

const defaultBuildTarget = 'empty';

export class BuilderService implements IBuilderService
{
    private gnbCommand: string[];

    private _onBuildStarted = new vscode.EventEmitter<void>();
    public readonly onBuildStarted = this._onBuildStarted.event;

    private _onBuildFinished = new vscode.EventEmitter<boolean>();
    public readonly onBuildFinished = this._onBuildFinished.event;

    private readonly _toolchain = new AsyncCache<Toolchain | null>(() => this.selectToolchain());

    // TODO: is this correct? User can start more than a single build at any time.
    // We probably need to maintain own build only?

    private _buildCompletable: Completion<void> | null = null;

    constructor(private services: ServiceContainer <AppServices>)
    {
        if (isDevContainerHost())
            this.gnbCommand = ["./gnbc"];
        else
            this.gnbCommand = ["./gnb"];

        const initialBuild = services.get('initialBuild');
        const buildComplete = services.get('buildComplete');

        const resetState = () => {
            // this.argsFile.reset();
            this._toolchain.reset();
        };

        initialBuild.finally(() => resetState());
        buildComplete(() => resetState());
        this.services.get('settings').onChange(() => resetState());
    }

    async toolchain(): Promise<Toolchain | null> {
        return this._toolchain.get();
    }

    public getConfigsDir(): string | null
    {
        const settings = this.services.get('settings');
        const valhallaDir = settings.get(Setting.valhallaFolder);
        if (!valhallaDir)
            return null;

        return path.join(valhallaDir.fsPath, 'configs');
    }

    public getOutputDir(): string | null
    {
        const settings = this.services.get('settings');
        return settings.get(Setting.outputDir) ?? null;
     }

    async buildTarget(target: string | undefined): Promise<void>
    {
        const currentBuild = this._buildCompletable;
        if (currentBuild) {
            await currentBuild.promise;
            return;
        }

        const outputChannel = this.services.get('buildOutputChannel');

        outputChannel.clear();

        const buildCommand = await this.getBuildCommand({target: target});
        if (!buildCommand) {
            vscode.window.showErrorMessage('Cannot build: Valhalla folder or configuration is not set.');
            return;
        }

        outputChannel.appendLine(`Running command: ${buildCommand.command.join(' ')}`);
        outputChannel.appendLine(`In directory: ${buildCommand.cwd}`);
        // outputChannel.show(true);

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building Valhalla (${target ?? 'default target'})...`,
            cancellable: true
        }, (progress, token) => {

            this._buildCompletable = new Completion<void>('build');
            this._onBuildStarted.fire();

            return new Promise<void>((resolve, reject) => {
                const isWindows = process.platform === 'win32';
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
                    reject(new Error(`Failed to start build process: ${err.message}`));
                });

                proc.on('exit', (code, signal) => {
                    if (code === 0) {
                        outputChannel.appendLine('Build completed successfully.');
                        resolve();
                    } else {
                        outputChannel.appendLine(`Build failed with exit code ${code} and signal ${signal}.`);
                        outputChannel.show(true);
                        reject(new Error(`Build failed with exit code ${code} and signal ${signal}.`));
                    }
                });

                const logger = (prefix: string) => (data: Buffer) => {
                    const lines = data.toString().split('\n');
                    for (const line of lines) {
                        outputChannel.appendLine(`[${prefix}] ${line.trimEnd()}`);
                    }
                };

                proc.stderr.on('data', logger('STDERR'));
                proc.stdout.on('data', logger('STDOUT'));
            })
            .then(() => {
                this._onBuildFinished.fire(true);
            })
            .catch(() => {
                this._onBuildFinished.fire(false);
            })
            .finally(() => {
                this._buildCompletable?.complete();
                this._buildCompletable = null;
            });
        });
    }

    public async buildDefaultTargetIfNeeded(beforeRebuild?: () => void): Promise<boolean>
    {
        const outputDir = this.getOutputDir();

        if (!outputDir) {
            return false;
        }

        if (!fs.existsSync(outputDir)) {
            beforeRebuild?.();
            await this.buildTarget(defaultBuildTarget);

            if (!fs.existsSync(outputDir)) {
                vscode.window.showErrorMessage(`Failed to build Valhalla. Output directory ${outputDir} does not exist.`);
                return false;
            }
        }
        return true;
    }

    public async buildDefaultTarget(): Promise<void>
    {
        await this.buildTarget(defaultBuildTarget);
    }

    private async toolchainSelectorInternal()
    {
        const argsFile = this.services.get('argsFile');
        const args = await argsFile.getArgs();
        if (!args)
            return {};

        const crossOS = args.get<string>('cross_os');
        const crossCPU = args.get<string>('cross_cpu');
        const crossABI = args.get<string>('cross_abi');

        return {crossOS, crossCPU, crossABI};
    }

    public async toolchainSelector(): Promise<string | null>
    {
        const {crossOS, crossCPU, crossABI} = await this.toolchainSelectorInternal();
        let result = '';

        if (crossOS) {
            result += crossOS;
            if (crossCPU) {
                result += `-${crossCPU}`;
                if (crossABI) {
                    result += `-${crossABI}`;
                }
            }
        }

        if (result.length === 0) {
            return null;
        }

        return result;
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
            const [os, cpu, abi] = parts;
            const matchOS = os === crossOS || os === '*' || os === undefined;
            const matchCPU = cpu === crossCPU || cpu === '*' || cpu === undefined;
            const matchABI = abi === crossABI || abi === '*' || abi === undefined;

            if (matchOS && matchCPU && matchABI) {
                return toolchain;
            }
        }

        return null;
    }

    public async getBuildCommand(options ?: BuildCommandOptions, buildKind?: BuildKind): Promise<BuildCommand | null>
    {
        const settings = this.services.get('settings');
        const valhallaDir = settings.get(Setting.valhallaFolder);
        const valhallaConfig = options?.config ?? settings.get(Setting.config);
        let target = options?.target ?? settings.get(Setting.target);
        const gnbFlags = options?.gnbFlags ?? settings.getOrDefault(Setting.gnbFlags, []);
        const gnFlags = options?.gnFlags ?? settings.getOrDefault(Setting.gnFlags, []);
        const configEnv = options?.env ?? settings.getOrDefault(Setting.env, {});

        if (!valhallaDir || !valhallaConfig) {
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

        const getActualTarget = (buildKind ?: BuildKind): string | undefined => {
            switch(buildKind) {
                case undefined:
                case BuildKind.build:
                    return target;

                case BuildKind.clean:
                case BuildKind.deepClean:
                    return undefined;

                case BuildKind.buildAll:
                    return ":default";

                case BuildKind.buildEmpty:
                    return ":empty";

                default: assertNever(buildKind);
            }
        }

        const prepareCommand = (buildKind: BuildKind | undefined, actualTarget: string[]) => {
            switch(buildKind) {
            case BuildKind.build:
            case BuildKind.buildAll:
            case undefined:
                return [...this.gnbCommand, valhallaConfig, ...gnbFlags, '--', ...gnFlags, ...actualTarget];

            case BuildKind.buildEmpty:
                return [...this.gnbCommand, valhallaConfig, ...gnbFlags, '--', ...gnFlags, ...actualTarget];

            case BuildKind.clean:
                return [...this.gnbCommand, valhallaConfig, '--clean', ...gnbFlags, '--', ...gnFlags, ...actualTarget];

            case BuildKind.deepClean:
                return [...this.gnbCommand, valhallaConfig, '--deep-clean', ...gnbFlags, '--', ...gnFlags, ...actualTarget];

            default:
                assertNever(buildKind);
            }
        }

        if (target?.startsWith("//")) {
            target = target.substring(2);
        }

        const actualTarget = getActualTarget(buildKind);
        const command = prepareCommand(buildKind, actualTarget ? [actualTarget] : []);
        const env = makeEnvironment(process.env, configEnv, options?.env, toolchain?.env);
        const cwd = valhallaDir.fsPath;

        return { command, cwd, env, actualTarget };
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
