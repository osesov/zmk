import * as vscode from 'vscode';

export interface Setting
{
    valhallaDir: string | undefined;
    valhallaFolder: vscode.Uri | undefined;
    workspaceFolder: vscode.Uri | undefined;
    workspaceFolders: vscode.Uri[] | undefined;
    config: string
    target: string | undefined;
    gnbFlags: string[];
    gnFlags: string[];
}

export enum SettingSource
{
    calculated,
    environment,
    configuration,
}

export type SettingName = keyof Setting;
export type SettingType<K extends SettingName> = Setting[K];
export type SettingDecl<K extends SettingName> = { key: K; defaultValue: SettingType<K>, source: SettingSource };

export const Setting: { [K in SettingName]: SettingDecl<K> } =
{
    valhallaDir: { key: 'valhallaDir', defaultValue: undefined, source: SettingSource.calculated },
    valhallaFolder: { key: 'valhallaFolder', defaultValue: undefined, source: SettingSource.calculated },
    workspaceFolder: { key: 'workspaceFolder', defaultValue: undefined, source: SettingSource.calculated },
    workspaceFolders: { key: 'workspaceFolders', defaultValue: undefined, source: SettingSource.calculated },
    config: { key: 'config', defaultValue: '', source: SettingSource.configuration },
    target: { key: 'target', defaultValue: undefined, source: SettingSource.configuration },
    gnbFlags: { key: 'gnbFlags', defaultValue: [], source: SettingSource.configuration },
    gnFlags: { key: 'gnFlags', defaultValue: [], source: SettingSource.configuration },
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
