import * as vscode from 'vscode';
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { findProjectRoot } from '../../components/utils';
import { LazyCache } from '../../components/LazyCache';
import { ISettingsService, Setting, SettingChangeEvent, SettingDecl, SettingName, SettingSection, SettingSource, SettingType } from '../ISettingsService';
import path from 'node:path';

export class SettingsService implements ISettingsService
{
    private onChangeEvent = new vscode.EventEmitter<SettingChangeEvent>();
    onChange = this.onChangeEvent.event;

    private outputDirWatched: string | null = null;
    private outputDirWatcher: vscode.FileSystemWatcher | null = null;

    private _valhallaFolder = new LazyCache<string | null>(
        () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder)
                return null;

            const valhallaRoot = findProjectRoot(workspaceFolder.uri.fsPath);
            if (!valhallaRoot)
                return null;

            return valhallaRoot;
        }
    );

    private _outputDir = new LazyCache<string | null>(
        () => {
            const valhallaFolder = this._valhallaFolder.get();
            if (!valhallaFolder)
                return null;

            const config = vscode.workspace.getConfiguration(SettingSection);
            const valhallaConfig = config.get(Setting.config.key, undefined);

            if (!valhallaConfig || typeof valhallaConfig !== 'string')
                return null;

            return path.join(valhallaFolder, 'out.' + valhallaConfig);
        }
    );

    constructor(services: ServiceContainer<AppServices>)
    {
        const context = services.get('context');

        const updateOutputDirWatcher = () => {
            const valhallaFolder = this._valhallaFolder.get();
            const outputDir = this._outputDir.get()
            if (outputDir && valhallaFolder) {
                if (this.outputDirWatched !== outputDir) {
                    this.outputDirWatcher?.dispose();

                    const eventWrapper: SettingChangeEvent = {
                        affects: (setting: SettingDecl<any>) => setting.key === Setting.outputDir.key
                    };

                    const sub = path.relative(outputDir, valhallaFolder);

                    this.outputDirWatcher = vscode.workspace.createFileSystemWatcher(
                        new vscode.RelativePattern(valhallaFolder, sub),
                    );
                    this.outputDirWatcher.onDidChange(() => this.onChangeEvent.fire(eventWrapper));
                    this.outputDirWatcher.onDidCreate(() => this.onChangeEvent.fire(eventWrapper));
                    this.outputDirWatcher.onDidDelete(() => this.onChangeEvent.fire(eventWrapper));
                    this.outputDirWatched = outputDir;
                }
            }
            else {
                this.outputDirWatcher?.dispose();
                this.outputDirWatcher = null;
                this.outputDirWatched = null;
            }
        }

        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            const eventWrapper: SettingChangeEvent = {
                affects: (setting: SettingDecl<any>) => event.affectsConfiguration(`${SettingSection}.${setting.key}`)
            };

            if (event.affectsConfiguration(`${SettingSection}.${Setting.config.key}`)) {
                this._outputDir.reset();
            }

            updateOutputDirWatcher();

            this.onChangeEvent.fire(eventWrapper);
        }));

        context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            const eventWrapper: SettingChangeEvent = {
                affects: (setting: SettingDecl<any>) => setting.key === Setting.workspaceFolder.key
            };

            this._valhallaFolder.reset();
            this._outputDir.reset();
            updateOutputDirWatcher();
            this.onChangeEvent.fire(eventWrapper);
        }));

        updateOutputDirWatcher();

        context.subscriptions.push(this.onChangeEvent);
        context.subscriptions.push(this);
    }

    public dispose(): void
    {
        this.outputDirWatcher?.dispose();
        this.onChangeEvent.dispose();
    }

    private getCalculatedSetting<K extends SettingName>(
        setting: SettingDecl<K>
    ): SettingType<K> {
        switch (setting.key) {
            case 'valhallaDir': {
                return (this._valhallaFolder.get() ?? undefined) as SettingType<K>;
            }

            case 'valhallaFolder':
                return (this._valhallaFolder.get() ?? undefined) as SettingType<K>;

            case 'workspaceFolder': {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                return (workspaceFolder ? workspaceFolder.uri : setting.defaultValue) as SettingType<K>;
            }

            case 'workspaceFolders': {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                return (workspaceFolders
                    ? workspaceFolders.map(folder => folder.uri)
                    : setting.defaultValue) as SettingType<K>;
            }

            case 'outputDir':
                return (this._outputDir.get() ?? undefined) as SettingType<K>;

            default:
                throw new Error(`Calculated setting "${setting.key}" does not have a getter implementation.`);
        }
    }

    get<K extends SettingName>(setting: SettingDecl<K>): SettingType<K>
    {
        switch (setting.source) {
            case SettingSource.calculated:
                return this.getCalculatedSetting(setting) as SettingType<K>;

            case SettingSource.environment:
                {
                    const envValue = process.env[setting.key];
                    if (envValue !== undefined) {
                        return envValue as unknown as SettingType<K>;
                    }
                    return setting.defaultValue;
                }

            case SettingSource.configuration:
                {
                    const config = vscode.workspace.getConfiguration(SettingSection);
                    return config.get<SettingType<K>>(setting.key, setting.defaultValue);
                }
            default:
                throw new Error(`Unknown setting source for setting "${setting.key}".`);
        }
    }

    getOrDefault<K extends SettingName, V>(setting: SettingDecl<K>, defaultValue: SettingType<K>): SettingType<K>
    {
        try {
            const value = this.get(setting);
            return value !== undefined ? value : (defaultValue !== undefined ? defaultValue : setting.defaultValue);
        }
        catch {
            return defaultValue !== undefined ? defaultValue : setting.defaultValue;
        }
    }

    update<K extends SettingName>(setting: SettingDecl<K>, value: SettingType<K>, isGlobal: boolean = false): Thenable<void>
    {
        if (setting.source != SettingSource.configuration) {
            return Promise.reject(new Error(`Setting "${setting.key}" is read-only.`));
        }
        const config = vscode.workspace.getConfiguration(SettingSection);
        return config.update(setting.key, value, isGlobal);
    }
}
