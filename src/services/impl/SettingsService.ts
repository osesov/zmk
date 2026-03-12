import * as vscode from 'vscode';
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { findProjectRoot } from '../../components/utils';
import { LazyCache } from '../../components/LazyCache';
import { ISettingsService, Setting, SettingChangeEvent, SettingDecl, SettingName, SettingSection, SettingSource, SettingType } from '../ISettingsService';

export class SettingsService implements ISettingsService
{
    private onChangeEvent = new vscode.EventEmitter<SettingChangeEvent>();
    onChange = this.onChangeEvent.event;

    private _valhallaFolder = new LazyCache<vscode.Uri | null>(
        () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder)
                return null;

            const valhallaRoot = findProjectRoot(workspaceFolder.uri.fsPath);
            if (!valhallaRoot)
                return null;

            return vscode.Uri.file(valhallaRoot);
        }
    );

    constructor(services: ServiceContainer<AppServices>)
    {
        const context = services.get('context');

        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            const eventWrapper: SettingChangeEvent = {
                affects: (setting: SettingDecl<any>) => event.affectsConfiguration(`${SettingSection}.${setting.key}`)
            };

            this.onChangeEvent.fire(eventWrapper);
        }));

        context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            const eventWrapper: SettingChangeEvent = {
                affects: (setting: SettingDecl<any>) => setting.key === Setting.workspaceFolder.key
            };

            this._valhallaFolder.reset();
            this.onChangeEvent.fire(eventWrapper);
        }));

        context.subscriptions.push(this.onChangeEvent);
    }

    get<K extends SettingName>(setting: SettingDecl<K>): SettingType<K>
    {
        switch (setting.key) {
            case Setting.valhallaDir.key:
                {
                    const valhallaFolder = this._valhallaFolder.get();
                    return (valhallaFolder ? valhallaFolder.fsPath : undefined) as SettingType<K>;
                }

            case Setting.valhallaFolder.key:
                return this._valhallaFolder.get() as SettingType<K>;

            case Setting.workspaceFolder.key:
                {
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (workspaceFolder) {
                        return workspaceFolder.uri as SettingType<K>;
                    }
                    return setting.defaultValue;
                }

            case Setting.workspaceFolders.key:
                {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders) {
                        return workspaceFolders.map(folder => folder.uri) as SettingType<K>;
                    }
                    return setting.defaultValue;
                }

            default:
                {
                    switch (setting.source) {
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
        }
    }

    getOrDefault<K extends SettingName>(setting: SettingDecl<K>, defaultValue?: SettingType<K>): SettingType<K>
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
        if (setting.source) {
            return Promise.reject(new Error(`Setting "${setting.key}" is read-only.`));
        }
        const config = vscode.workspace.getConfiguration(SettingSection);
        return config.update(setting.key, value, isGlobal);
    }
}
