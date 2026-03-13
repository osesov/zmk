import * as vscode from 'vscode';

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
    buildEmpty,
    clean,
    deepClean
}

export interface IBuilderService
{
    onBuildStarted: vscode.Event<void>;
    onBuildFinished: vscode.Event<boolean>;

    getOutputDir(): string | null;
    getBuildCommand(options ?: BuildCommandOptions, buildKind?: BuildKind): BuildCommand | null;

    buildTarget(target: string | undefined): Promise<void>;
    buildDefaultTarget(): Promise<void>;
    buildDefaultTargetIfNeeded(beforeRebuild?: () => void): Promise<boolean>;

    listConfigs(): Promise<string[]>;
}
