import * as vscode from 'vscode';
import { Toolchain } from './ISettingsService';

export interface BuildCommand
{
    command: string[];
    cwd: string;
    env: { [key: string]: string };

    // actual
    actualTarget: string | undefined
}

export interface BuildCommandOptions
{
    config ?: string;
    target ?: string;
    gnbFlags ?: string[];
    gnFlags ?: string[];
    env ?: { [k: string]: string | null | undefined } | undefined
}

export enum BuildKind
{
    build,
    buildAll,
    buildEmpty,
    clean,
    deepClean
}

export interface IBuilderService
{
    onBuildStarted: vscode.Event<void>;
    onBuildFinished: vscode.Event<boolean>;

    getBuildCommand(options ?: BuildCommandOptions, buildKind?: BuildKind): Promise<BuildCommand | null>;

    buildTarget(target: string | undefined): Promise<void>;
    buildDefaultTarget(): Promise<void>;
    buildDefaultTargetIfNeeded(beforeRebuild?: () => void): Promise<boolean>;

    listConfigs(): Promise<string[]>;
    toolchainSelector(): Promise<string | null>;
    toolchain(): Promise<Toolchain | null>;
    // args(): ArgsFile | null;
}
