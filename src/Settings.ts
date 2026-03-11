import * as vscode from 'vscode';

export enum SettingName
{
    config = "config",
    target = "target",
}

export interface BuildProfile
{
    config: string;
    target: string | undefined;
    gnbFlags: string[];
    gnFlags: string[];
}

export interface ProfileMap
{
    [name: string]: BuildProfile;
}

export class Settings
{
    private static _instance: Settings | null = null;
    private readonly _context: vscode.ExtensionContext;

    public static initialize(context: vscode.ExtensionContext): Settings
    {
        if (Settings._instance)
        {
            throw new Error('Settings instance is already initialized.');
        }
        Settings._instance = new Settings(context);
        return Settings._instance;
    }

    public static get settings(): Settings
    {
        if (!Settings._instance)
        {
            throw new Error('Settings instance is not initialized. Please initialize it before accessing.');
        }
        return Settings._instance;
    }

    ///////////////////////////////////////////////////////////////////
    private constructor(context: vscode.ExtensionContext)
    {
        this._context = context;
    }

    private get _workspaceConfiguration()
    {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return vscode.workspace.getConfiguration("zmk", workspaceFolder);
    }

    public set config(name: string)
    {
        this._workspaceConfiguration.update(SettingName.config, name, vscode.ConfigurationTarget.Workspace);
    }

    public get config(): string | undefined
    {
        return this._workspaceConfiguration.get<string>(SettingName.config);
    }

    public set target(name: string)
    {
        this._workspaceConfiguration.update(SettingName.target, name, vscode.ConfigurationTarget.Workspace);
    }

    public get target(): string | undefined
    {
        return this._workspaceConfiguration.get<string>(SettingName.target);
    }

}
