import * as vscode from 'vscode';

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

export interface Setting
{
    // calculated settings
    valhallaDir: string | undefined;
    outputDir: string | undefined;
    valhallaFolder: vscode.Uri | undefined;
    workspaceFolder: vscode.Uri | undefined;
    workspaceFolders: vscode.Uri[] | undefined;

    // configuration settings
    config: string;
    target: string | undefined;
    gnbFlags: string[];
    gnFlags: string[];

    env: JsonObject | undefined;
    includeDirs: string[] | undefined;
    defines: JsonObject | undefined;

    disableCppToolsIntegration: boolean;
    cppStandard: string | undefined; // C++ standard, used for CppTools configuration
    compiler: string[] | undefined; // intellisense compiler path, used for CppTools configuration
    intelliSenseMode: string | undefined; // intellisense mode, used for CppTools configuration
    toolchain: Toolchain[] | undefined; // toolchain items, used for CppTools configuration
}

export enum SettingSource
{
    calculated,
    environment,
    configuration,
}

export type SettingName = keyof Setting;
export type SettingType<K extends SettingName> = Setting[K];
export type SettingDecl<K extends SettingName> = { key: string /*K*/; defaultValue: SettingType<K>, source: SettingSource };

export const Setting: { [K in SettingName]: SettingDecl<K> } =
{
    valhallaDir: { key: 'valhallaDir', defaultValue: undefined, source: SettingSource.calculated },
    valhallaFolder: { key: 'valhallaFolder', defaultValue: undefined, source: SettingSource.calculated },
    workspaceFolder: { key: 'workspaceFolder', defaultValue: undefined, source: SettingSource.calculated },
    workspaceFolders: { key: 'workspaceFolders', defaultValue: undefined, source: SettingSource.calculated },
    outputDir: { key: 'outputDir', defaultValue: undefined, source: SettingSource.calculated },

    config: { key: 'config', defaultValue: '', source: SettingSource.configuration },
    target: { key: 'target', defaultValue: undefined, source: SettingSource.configuration },
    gnbFlags: { key: 'gnbFlags', defaultValue: [], source: SettingSource.configuration },
    gnFlags: { key: 'gnFlags', defaultValue: [], source: SettingSource.configuration },

    // extra build information
    env: { key: 'env', defaultValue: undefined, source: SettingSource.configuration },
    includeDirs: { key: 'includeDirs', defaultValue: undefined, source: SettingSource.configuration},
    defines: { key: 'defines', defaultValue: undefined, source: SettingSource.configuration},

    // CppTools configuration
    disableCppToolsIntegration: { key: 'disableCppToolsIntegration', defaultValue: false, source: SettingSource.configuration },
    cppStandard: { key: 'cppStandard', defaultValue: undefined, source: SettingSource.configuration },
    compiler: { key: 'compiler', defaultValue: undefined, source: SettingSource.configuration },
    intelliSenseMode: { key: 'intelliSenseMode', defaultValue: undefined, source: SettingSource.configuration },
    toolchain: { key: 'toolchain', defaultValue: undefined, source: SettingSource.configuration }
} as const;

export type SettingKey = keyof typeof Setting;
export const SettingSection = 'zmk';

export interface SettingChangeEvent
{
    affects(setting: SettingDecl<any>): boolean;
}

export interface ISettingsService
{
    onChange: vscode.Event<SettingChangeEvent>;

    get<K extends SettingName>(setting: SettingDecl<K>): SettingType<K>;
    getOrDefault<K extends SettingName>(setting: SettingDecl<K>, defaultValue?: SettingType<K>): SettingType<K>;
    update<K extends SettingName>(setting: SettingDecl<K>, value: SettingType<K>): Thenable<void>;
    update<K extends SettingName>(setting: SettingDecl<K>, value: SettingType<K>, isGlobal: boolean): Thenable<void>;
}
