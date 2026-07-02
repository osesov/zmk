import * as vscode from 'vscode';

export enum SettingSource {
    configuration = 'configuration',
    environment = 'environment',
    calculated = 'calculated',
    workspaceState = 'workspaceState',
    globalState = 'globalState',
}

export interface ValhallaProject {
    name: string;
    uri: vscode.Uri;
    workspaceFolders: vscode.Uri[];
}

type BaseSettingDecl<
    K extends string,
    S extends SettingSource,
    T,
> = Readonly<{
    key: K;
    source: S;
    defaultValue: T;
}>;

export type ConfigurationSettingDecl<K extends string, T> =
    BaseSettingDecl<K, SettingSource.configuration, T> & Readonly<{
        configurationKey: string;
    }>;

export type EnvironmentSettingDecl<K extends string, T> =
    BaseSettingDecl<K, SettingSource.environment, T> & Readonly<{
        envKey: string;
    }>;

export type CalculatedSettingDecl<K extends string, T> =
    BaseSettingDecl<K, SettingSource.calculated, T>;

export type WorkspaceStateSettingDecl<K extends string, T> =
    BaseSettingDecl<K, SettingSource.workspaceState, T> & Readonly<{
        workspaceStateKey: string;
    }>;

export type GlobalStateSettingDecl<K extends string, T> =
    BaseSettingDecl<K, SettingSource.globalState, T> & Readonly<{
        globalStateKey: string;
    }>;

export type AnySettingDecl =
    | ConfigurationSettingDecl<string, any>
    | EnvironmentSettingDecl<string, any>
    | CalculatedSettingDecl<string, any>
    | WorkspaceStateSettingDecl<string, any>
    | GlobalStateSettingDecl<string, any>;

function configuration<K extends string, T>(
    key: K,
    configurationKey: string,
    defaultValue: T,
): ConfigurationSettingDecl<K, T> {
    return {
        key,
        source: SettingSource.configuration,
        configurationKey,
        defaultValue,
    };
}

function environment<K extends string, T>(
    key: K,
    envKey: string,
    defaultValue: T,
): EnvironmentSettingDecl<K, T> {
    return {
        key,
        source: SettingSource.environment,
        envKey,
        defaultValue,
    };
}

function calculated<K extends string, T>(
    key: K,
    defaultValue: T,
): CalculatedSettingDecl<K, T> {
    return {
        key,
        source: SettingSource.calculated,
        defaultValue,
    };
}

function workspaceState<K extends string, T>(
    key: K,
    workspaceStateKey: string,
    defaultValue: T,
): WorkspaceStateSettingDecl<K, T> {
    return {
        key,
        source: SettingSource.workspaceState,
        workspaceStateKey,
        defaultValue,
    };
}

function globalState<K extends string, T>(
    key: K,
    globalStateKey: string,
    defaultValue: T,
): GlobalStateSettingDecl<K, T> {
    return {
        key,
        source: SettingSource.globalState,
        globalStateKey: globalStateKey,
        defaultValue,
    };
}

export type JsonValue = null | boolean | string | number | JsonArray | JsonObject
export type JsonObject = { [k: string]: JsonValue}
export type JsonArray = JsonValue[]

export interface Toolchain
{
    pattern: string | undefined
    compiler: string[] | undefined
    intelliSenseMode: string | undefined
    cppStandard: string | undefined
    defines: JsonObject | undefined
    includeDirs: string[] | undefined
    env: JsonObject | undefined
}

export type Environment = Record<string, string | undefined>;

export const Setting = {
    // global state
    lastUpdateCheck: globalState('lastUpdateCheck', 'lastUpdateCheck', undefined as string | undefined),

    // workspace state
    activeProject: workspaceState('activeProject', 'activeProject', undefined as string | undefined),

    // calculated
    isValhallaProject: calculated('isValhallaProject', false),
    valhallaDir: calculated('valhallaDir', undefined as string | undefined),
    valhallaFolder: calculated('valhallaFolder', undefined as vscode.Uri | undefined),
    workspaceFolders: calculated('workspaceFolders', undefined as vscode.Uri[] | undefined),
    outputDir: calculated('outputDir', undefined as string | undefined),
    testOutputDir: calculated('testOutputDir', undefined as string | undefined),
    valhallaProjects: calculated('valhallaProjects', [] as ValhallaProject[]),

    // configuration
    config: configuration('config', 'zmk.config', ''),
    target: configuration('target', 'zmk.target', undefined as string | undefined),
    gnbFlags: configuration('gnbFlags', 'zmk.gnbFlags', [] as string[]),
    gnFlags: configuration('gnFlags', 'zmk.gnFlags', [] as string[]),
    testConfig: configuration('testConfig', 'zmk.testConfig', null as string | null),
    testTarget: configuration('testTarget', 'zmk.testTarget', null as string | null),
    browseTargets: configuration('browseTargets', 'zmk.browseTargets', [] as string[]),
    env: configuration('env', 'zmk.env', undefined as Environment | undefined),
    includeDirs: configuration('includeDirs', 'zmk.includeDirs', undefined as string[] | undefined),
    defines: configuration('defines', 'zmk.defines', undefined as {[k:string]: string | null} | undefined),

    disableCppToolsIntegration: configuration('disableCppToolsIntegration', 'zmk.disableCppToolsIntegration', false),
    cppStandard: configuration('cppStandard', 'zmk.cppStandard', undefined as string | undefined),
    compiler: configuration('compiler', 'zmk.compiler', undefined as string[] | undefined),
    intelliSenseMode: configuration('intelliSenseMode', 'zmk.intelliSenseMode', undefined as string | undefined),
    toolchain: configuration('toolchain', 'zmk.toolchain', undefined as Toolchain[] | undefined),

    nexusServer: configuration('nexusServer', 'zmk.nexusServer', undefined as string | undefined),

    // environment
    path: environment('path', 'PATH', undefined as string | undefined),
    pythonPath: environment('pythonPath', 'PYTHONPATH', undefined as string | undefined),
} as const;

export type SettingMap = typeof Setting;
export type SettingName = keyof SettingMap;

export type ValueOf<S extends AnySettingDecl> = S['defaultValue'];

export type ConfigurationSetting = Extract<SettingMap[keyof SettingMap], { source: SettingSource.configuration }>;
export type EnvironmentSetting = Extract<SettingMap[keyof SettingMap], { source: SettingSource.environment }>;
export type CalculatedSetting = Extract<SettingMap[keyof SettingMap], { source: SettingSource.calculated }>;
export type WorkspaceStateSetting = Extract<SettingMap[keyof SettingMap], { source: SettingSource.workspaceState }>;
export type GlobalStateSetting = Extract<SettingMap[keyof SettingMap], { source: SettingSource.globalState }>;

export interface SettingChangeEvent {
    readonly changed: ReadonlySet<SettingName>;
    affects<S extends AnySettingDecl>(setting: S): boolean;
}

export interface ISettingsService extends vscode.Disposable {
    readonly onChange: vscode.Event<SettingChangeEvent>;

    get<S extends AnySettingDecl>(setting: S): ValueOf<S>;

    getOrDefault<S extends AnySettingDecl>(
        setting: S,
        defaultValue: NonNullable<ValueOf<S>>,
    ): NonNullable<ValueOf<S>>;

    update<S extends ConfigurationSetting>(
        setting: S,
        value: ValueOf<S>,
        target?: vscode.ConfigurationTarget | boolean | null,
    ): Thenable<void>;

    updateWorkspaceState<S extends WorkspaceStateSetting>(
        setting: S,
        value: ValueOf<S>,
    ): Thenable<void>;

    updateGlobalState<S extends GlobalStateSetting>(
        setting: S,
        value: ValueOf<S>,
    ): Thenable<void>;

    refresh(): Promise<void>;
}
