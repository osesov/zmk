import * as child_process from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { AppServices } from "../AppServices";
import { BuildCommand, BuildCommandOptions, IBuilderService } from "../IBuilderService";
import { ServiceContainer } from "../ServiceContainer";
import { isDevContainerHost, isNotEmpty } from '../../components/utils';
import { JsonValue, Setting } from '../ISettingsService';
import path from 'path';
import { CompletableFeature } from '../../components/promise';

const defaultBuildTarget = 'empty';

export class BuilderService implements IBuilderService
{
    private gnbCommand: string[];

    private _onBuildStarted = new vscode.EventEmitter<void>();
    public readonly onBuildStarted = this._onBuildStarted.event;

    private _onBuildFinished = new vscode.EventEmitter<boolean>();
    public readonly onBuildFinished = this._onBuildFinished.event;

    private _buildCompletable: CompletableFeature<void> | null = null;

    constructor(private services: ServiceContainer <AppServices>)
    {
        if (isDevContainerHost())
            this.gnbCommand = ["./gnbc"];
        else
            this.gnbCommand = ["./gnb"];
    }

    public getOutputDir(): string | null
    {
        const settings = this.services.get('settings');
        const valhallaDir = settings.get(Setting.valhallaFolder);
        if (!valhallaDir)
            return null;

        const valhallaConfig = settings.get(Setting.config);
        if (!valhallaConfig)
            return null;

        const outputDirName = `out.${valhallaConfig}`
        const outputDir = path.join(valhallaDir.fsPath, outputDirName);
        return outputDir;
    }

    public getConfigsDir(): string | null
    {
        const settings = this.services.get('settings');
        const valhallaDir = settings.get(Setting.valhallaFolder);
        if (!valhallaDir)
            return null;

        const configsDir = path.join(valhallaDir.fsPath, 'configs');
        return configsDir;
    }

    async buildTarget(target: string | undefined): Promise<void>
    {
        const currentBuild = this._buildCompletable;
        if (currentBuild) {
            await currentBuild.promise;
            return;
        }

        const outputChannel = this.services.get('buildOutputChannel');
        const settings = this.services.get('settings');

        const cwd = settings.get(Setting.valhallaFolder)?.fsPath;
        const valhallaConfig = settings.get(Setting.config);
        const gnbFlags = settings.getOrDefault(Setting.gnbFlags, []);
        const gnFlags = settings.getOrDefault(Setting.gnFlags, []);

        outputChannel.clear();

        if (!valhallaConfig) {
            return;
        }

        const buildCommand = this.getBuildCommand();

        const cmdLine = [...this.gnbCommand, valhallaConfig, ...gnbFlags, '--', ...gnFlags, ...(target ? [target] : [])];

        outputChannel.appendLine(`Running command: ${cmdLine.join(' ')}`);
        outputChannel.appendLine(`In directory: ${cwd}`);
        // outputChannel.show(true);

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building Valhalla (${target ?? 'default target'})...`,
            cancellable: true
        }, (progress, token) => {

            this._buildCompletable = new CompletableFeature<void>('build');
            this._onBuildStarted.fire();

            return new Promise<void>((resolve, reject) => {
                const isWindows = process.platform === 'win32';
                const proc = child_process.spawn(cmdLine[0], cmdLine.slice(1), {
                    cwd,
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

    public getBuildCommand(options ?: BuildCommandOptions): BuildCommand | null
    {

        const settings = this.services.get('settings');
        const valhallaDir = settings.get(Setting.valhallaFolder);
        const valhallaConfig = options?.config ?? settings.get(Setting.config);
        const target = options?.target ?? settings.get(Setting.target);
        const gnbFlags = options?.gnbFlags ?? settings.getOrDefault(Setting.gnbFlags, []);
        const gnFlags = options?.gnFlags ?? settings.getOrDefault(Setting.gnFlags, []);
        const configEnv = options?.env ?? settings.getOrDefault(Setting.env, {});

        if (!valhallaDir || !valhallaConfig) {
            return null;
        }

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

        const command = [...this.gnbCommand, valhallaConfig, ...gnbFlags, '--', ...gnFlags, ...(target ? [target] : [])];
        const env = makeEnvironment(process.env, configEnv);
        const cwd = valhallaDir.fsPath;

        if (options?.env) {
            for (const [key, value] of Object.entries(options?.env)) {
                if (value === undefined || value === null)
                    delete env[key]
                else
                    env[key] = value;
            }
        }
        return { command, cwd, env };
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

    listTargets(config ?: string): Promise<string[]>
    {
        throw new Error('Not implemented');
    }
}
