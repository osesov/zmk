import * as vscode from 'vscode';
import { Toolchain } from './ISettingsService';

export interface BuildCommand
{
    command: string[];
    cwd: string;
    env: { [key: string]: string };

    // actual
    actualConfig: string;
    actualTarget: string | undefined
    actualBuildMode: BuildMode
}

export enum BuildMode
{
    build = "build",
    buildCurrentFile = "build-current-file",
    buildAll = "build-all",
    buildEmpty = "build-minimal",
    clean = "clean",
    deepClean = "deep-clean",

    test = "test",
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

export enum NeedBuildStatus
{
    no = 'no',
    configIncomplete = 'configIncomplete',
    yes = 'yes',
}

export type NeedBuildResult =
    | { pending: NeedBuildStatus.no }
    | { pending: NeedBuildStatus.configIncomplete }
    | { pending: NeedBuildStatus.yes; reason: string }
    ;

export interface BuildTargetOptions
{
    onStdout ?: (data: string) => void;
    onStderr ?: (data: string) => void;
    buildMode?: BuildMode;
}

export interface BuildResult
{
    success: boolean;
    status: number | string | null;
    output: string[];
}

export interface IBuilderService
{
    onBuildStarted: vscode.Event<void>;
    onBuildFinished: vscode.Event<BuildResult>;

    getBuildCommand(options ?: BuildCommandOptions, buildKind?: BuildMode): Promise<BuildCommand | null>;

    needBuild(): Promise<NeedBuildResult>;
    buildTarget(target: string | undefined, options ?: BuildTargetOptions): Promise<BuildResult>;
    buildMultipleTargets(target: string[], options ?: BuildTargetOptions): Promise<BuildResult>;
    buildDefaultTarget(): Promise<BuildResult>;
    buildAllTarget(): Promise<BuildResult>;
    buildDefaultTargetIfNeeded(): Promise<BuildResult>;

    getConfigPath(configName: string): Promise<string | null>;
    listConfigs(): Promise<string[]>;
    toolchainSelector(): Promise<string | null>;
    toolchain(): Promise<Toolchain | null>;
}
