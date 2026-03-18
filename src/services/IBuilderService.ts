import * as vscode from 'vscode';
import { Toolchain } from './ISettingsService';

export interface BuildCommand
{
    command: string[];
    cwd: string;
    env: { [key: string]: string };

    // actual
    actualTarget: string | undefined
    actualBuildMode: BuildMode
}

export enum BuildMode
{
    build = "build",
    buildAll = "build-all",
    buildEmpty = "build-minimal",
    clean = "clean",
    deepClean = "deep-clean"
}

export interface BuildCommandOptions
{
    command ?: string[];
    mode ?: BuildMode;
    config ?: string;
    target ?: string;
    gnbFlags ?: string[];
    gnFlags ?: string[];
    env ?: { [k: string]: string | null | undefined } | undefined
}


export interface IBuilderService
{
    onBuildStarted: vscode.Event<void>;
    onBuildFinished: vscode.Event<boolean>;

    getBuildCommand(options ?: BuildCommandOptions, buildKind?: BuildMode): Promise<BuildCommand | null>;

    buildTarget(target: string | undefined): Promise<void>;
    buildDefaultTarget(): Promise<void>;
    buildDefaultTargetIfNeeded(beforeRebuild?: () => void): Promise<boolean>;

    getConfigPath(configName: string): Promise<string | null>;
    listConfigs(): Promise<string[]>;
    toolchainSelector(): Promise<string | null>;
    toolchain(): Promise<Toolchain | null>;
    // args(): ArgsFile | null;
}
