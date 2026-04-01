import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    CalculatedSetting,
    ConfigurationSetting,
    EnvironmentSetting,
    ISettingsService,
    Setting,
    SettingChangeEvent,
    SettingMap,
    ValueOf,
    ValhallaProject,
    WorkspaceStateSetting,
    AnySettingDecl,
} from '../ISettingsService';
import { AppServiceContainer } from '../AppServices';
import { findProjectRootUri } from '../../components/utils';
import { IAsyncServiceInit } from '../IAsyncServiceInit';

type SettingsSnapshot = {
    [K in keyof SettingMap]: SettingMap[K]['defaultValue'];
};

type CalculatedDeps = {
    workspaceFolders?: vscode.Uri[] | undefined;
    valhallaProjects?: ValhallaProject[];
    activeProject?: string | undefined;
    valhallaFolder?: vscode.Uri | undefined;
    valhallaDir?: string | undefined;
    config?: string;
    testConfig?: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof vscode.Uri);
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }

    if (a instanceof vscode.Uri && b instanceof vscode.Uri) {
        return a.toString() === b.toString();
    }

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) {
                return false;
            }
        }
        return true;
    }

    if (isPlainObject(a) && isPlainObject(b)) {
        const aKeys = Object.keys(a).sort();
        const bKeys = Object.keys(b).sort();

        if (!deepEqual(aKeys, bKeys)) {
            return false;
        }

        for (const key of aKeys) {
            if (!deepEqual(a[key], b[key])) {
                return false;
            }
        }

        return true;
    }

    return false;
}

export class SettingsService implements ISettingsService, IAsyncServiceInit {
    private readonly _context: vscode.ExtensionContext;
    private readonly _onChangeEmitter = new vscode.EventEmitter<SettingChangeEvent>();
    public readonly onChange = this._onChangeEmitter.event;

    private readonly _disposables: vscode.Disposable[] = [];
    private _snapshot: SettingsSnapshot;
    private _environment = new Map<string, string>();

    public readonly ready: Promise<void>;

    public constructor(services: AppServiceContainer) {
        this._context = services.get('context');

        vscode.workspace.onDidChangeWorkspaceFolders(() => this.recomputeAndEmit(), this, this._disposables);
        vscode.workspace.onDidChangeConfiguration(() => this.recomputeAndEmit(), this, this._disposables);

        this._snapshot = this.createInitialSnapshot();
        this.ready = this.computeSnapshot()
        .then(settings => {this._snapshot = settings});
    }

    public dispose(): void {
        this._onChangeEmitter.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
    }

    public get<S extends AnySettingDecl>(setting: S): ValueOf<S> {
        const name = this.toName(setting);
        return this._snapshot[name] as ValueOf<S>;
    }

    public getOrDefault<S extends AnySettingDecl>(
        setting: S,
        defaultValue: NonNullable<ValueOf<S>>,
    ): NonNullable<ValueOf<S>> {
        const value = this.get(setting);
        return (value ?? defaultValue) as NonNullable<ValueOf<S>>;
    }

    public async update<S extends ConfigurationSetting>(
        setting: S,
        value: ValueOf<S>,
        target: vscode.ConfigurationTarget | boolean | null = vscode.ConfigurationTarget.Workspace,
    ): Promise<void> {
        await vscode.workspace.getConfiguration().update(setting.configurationKey, value, target);
        await this.recomputeAndEmit()
    }

    public async updateWorkspaceState<S extends WorkspaceStateSetting>(
        setting: S,
        value: ValueOf<S>,
    ): Promise<void> {
        await this._context.workspaceState.update(setting.workspaceStateKey, value);
        await this.recomputeAndEmit();
    }

    public async refresh(): Promise<void> {
        await this.reloadEnvironment();
        await this.recomputeAndEmit();
    }

    private createInitialSnapshot(): SettingsSnapshot {
        return {
            activeProject: Setting.activeProject.defaultValue,

            isValhallaProject: Setting.isValhallaProject.defaultValue,
            valhallaDir: Setting.valhallaDir.defaultValue,
            valhallaFolder: Setting.valhallaFolder.defaultValue,
            workspaceFolders: Setting.workspaceFolders.defaultValue,
            outputDir: Setting.outputDir.defaultValue,
            valhallaProjects: Setting.valhallaProjects.defaultValue,

            config: Setting.config.defaultValue,
            target: Setting.target.defaultValue,
            gnbFlags: Setting.gnbFlags.defaultValue,
            gnFlags: Setting.gnFlags.defaultValue,

            testConfig: Setting.testConfig.defaultValue,
            testOutputDir: Setting.testOutputDir.defaultValue,
            testTarget: Setting.testTarget.defaultValue,

            env: Setting.env.defaultValue,
            includeDirs: Setting.includeDirs.defaultValue,
            defines: Setting.defines.defaultValue,

            disableCppToolsIntegration: Setting.disableCppToolsIntegration.defaultValue,
            cppStandard: Setting.cppStandard.defaultValue,
            compiler: Setting.compiler.defaultValue,
            intelliSenseMode: Setting.intelliSenseMode.defaultValue,
            toolchain: Setting.toolchain.defaultValue,

            path: Setting.path.defaultValue,
            pythonPath: Setting.pythonPath.defaultValue,
        };
    }

    private async computeSnapshot(): Promise<SettingsSnapshot> {
        const workspaceFolders = await this.computeCalculated(Setting.workspaceFolders);
        const valhallaProjects = await this.computeCalculated(Setting.valhallaProjects, { workspaceFolders });

        const activeProject = this.readWorkspaceState(Setting.activeProject);

        const valhallaFolder = await this.computeCalculated(Setting.valhallaFolder, {
            valhallaProjects,
            activeProject,
        });

        const valhallaDir = await this.computeCalculated(Setting.valhallaDir, { valhallaFolder });
        const isValhallaProject = await this.computeCalculated(Setting.isValhallaProject, { valhallaDir });

        const config = this.readConfiguration(Setting.config);
        const testConfig = this.readConfiguration(Setting.testConfig);
        const outputDir = await this.computeCalculated(Setting.outputDir, { valhallaDir, config });
        const testOutputDir = await this.computeCalculated(Setting.testOutputDir, { valhallaDir, testConfig });

        return {
            activeProject,

            isValhallaProject,
            valhallaDir,
            valhallaFolder,
            workspaceFolders,
            outputDir,
            testOutputDir,
            valhallaProjects,

            config,
            testConfig: testConfig,
            target: this.readConfiguration(Setting.target),
            testTarget: this.readConfiguration(Setting.testTarget),
            gnbFlags: this.readConfiguration(Setting.gnbFlags),
            gnFlags: this.readConfiguration(Setting.gnFlags),

            env: this.readConfiguration(Setting.env),
            includeDirs: this.readConfiguration(Setting.includeDirs),
            defines: this.readConfiguration(Setting.defines),

            disableCppToolsIntegration: this.readConfiguration(Setting.disableCppToolsIntegration),
            cppStandard: this.readConfiguration(Setting.cppStandard),
            compiler: this.readConfiguration(Setting.compiler),
            intelliSenseMode: this.readConfiguration(Setting.intelliSenseMode),
            toolchain: this.readConfiguration(Setting.toolchain),

            path: this.readEnvironment(Setting.path),
            pythonPath: this.readEnvironment(Setting.pythonPath),
        };
    }

    private computeCalculated<S extends CalculatedSetting>(
        setting: S,
        deps: CalculatedDeps = {},
    ): ValueOf<S> | Promise<ValueOf<S>> {
        switch (setting.key) {
            case 'workspaceFolders': {
                const folders = vscode.workspace.workspaceFolders?.map(it => it.uri);
                return (folders && folders.length > 0 ? folders : undefined) as ValueOf<S>;
            }

            case 'valhallaProjects': {
                return this.computeValhallaProjects(deps.workspaceFolders) as Promise<ValueOf<S>>;
            }

            case 'valhallaFolder': {
                const selected = deps.activeProject;
                if (selected && deps.valhallaProjects) {
                    const match = deps.valhallaProjects.find(p => p.uri.toString() === selected);
                    if (match) {
                        return match.uri as unknown as ValueOf<S>;
                    }
                }

                if (deps.valhallaProjects && deps.valhallaProjects.length > 0) {
                    return deps.valhallaProjects[0].uri as unknown as ValueOf<S>;
                }

                return deps.workspaceFolders?.[0] as ValueOf<S>;
            }

            case 'valhallaDir': {
                return this.computeValhallaDir(deps.valhallaFolder) as Promise<ValueOf<S>>;
            }

            case 'isValhallaProject': {
                return Boolean(deps.valhallaDir) as ValueOf<S>;
            }

            case 'outputDir': {
                if (!deps.valhallaDir) {
                    return undefined as ValueOf<S>;
                }

                return path.join(deps.valhallaDir, `out.${deps.config ?? ''}`) as unknown as ValueOf<S>;
            }

            case 'testOutputDir': {
                if (!deps.valhallaDir) {
                    return undefined as ValueOf<S>;
                }

                return path.join(deps.valhallaDir, `out.${deps.testConfig ?? deps.config ?? ''}`) as unknown as ValueOf<S>;
            }

            default:
                return this.assertNever(setting);
        }
    }

    private assertNever(x: never): never {
        throw new Error(`Unhandled calculated setting: ${String((x as { key?: unknown }).key)}`);
    }

    private readConfiguration<S extends ConfigurationSetting>(setting: S): ValueOf<S> {
        const value = vscode.workspace.getConfiguration().get<ValueOf<S>>(setting.configurationKey);
        return (value ?? setting.defaultValue) as ValueOf<S>;
    }

    private readWorkspaceState<S extends WorkspaceStateSetting>(setting: S): ValueOf<S> {
        const value = this._context.workspaceState.get<ValueOf<S>>(setting.workspaceStateKey);
        return (value ?? setting.defaultValue) as ValueOf<S>;
    }

    private readEnvironment<S extends EnvironmentSetting>(setting: S): ValueOf<S> {
        const value = this._environment.get(setting.envKey);
        return (value ?? setting.defaultValue) as ValueOf<S>;
    }

    private async computeValhallaDir(folder: vscode.Uri | undefined): Promise<string | undefined> {
        if (!folder) {
            return undefined;
        }

        const root = await findProjectRootUri(folder);
        return root?.fsPath;
    }

    private async computeValhallaProjects(
        workspaceFolders: vscode.Uri[] | undefined,
    ): Promise<ValhallaProject[]> {
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        const resolved = await Promise.all(
            workspaceFolders.map(async folder => ({
                workspaceFolder: folder,
                root: await findProjectRootUri(folder),
            })),
        );

        const projects = new Map<string, ValhallaProject>();

        for (const item of resolved) {
            if (!item.root) {
                continue;
            }

            const key = item.root.toString();
            const existing = projects.get(key);

            if (existing) {
                existing.workspaceFolders.push(item.workspaceFolder);
            } else {
                const name = path.basename(item.root.fsPath);
                projects.set(key, {
                    name,
                    uri: item.root,
                    workspaceFolders: [item.workspaceFolder],
                });
            }
        }

        return [...projects.values()].sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
    }

    private async reloadEnvironment(): Promise<void> {
        const envMap = new Map<string, string>();

        for (const [key, value] of Object.entries(process.env)) {
            if (typeof value === 'string') {
                envMap.set(key, value);
            }
        }

        const workspaceFolders = vscode.workspace.workspaceFolders?.map(it => it.uri);
        const workspaceFolder = workspaceFolders?.[0];
        const projects = await this.computeValhallaProjects(workspaceFolders);

        const activeProject = this.readWorkspaceState(Setting.activeProject);

        let valhallaFolder: vscode.Uri | undefined;
        if (activeProject) {
            valhallaFolder = projects.find(p => p.uri.toString() === activeProject)?.uri;
        }

        valhallaFolder ??= projects[0]?.uri;
        valhallaFolder ??= workspaceFolder;

        const valhallaDirUri = valhallaFolder ? await findProjectRootUri(valhallaFolder) : undefined;
        if (valhallaDirUri) {
            const dotEnvPath = path.join(valhallaDirUri.fsPath, '.env');
            const extra = await this.readDotEnv(dotEnvPath);
            for (const [key, value] of extra) {
                envMap.set(key, value);
            }
        }

        this._environment = envMap;
    }

    private async readDotEnv(fileName: string): Promise<Map<string, string>> {
        const result = new Map<string, string>();

        try {
            const text = await fs.promises.readFile(fileName, 'utf8');

            for (const rawLine of text.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line || line.startsWith('#')) {
                    continue;
                }

                const eq = line.indexOf('=');
                if (eq < 0) {
                    continue;
                }

                const key = line.slice(0, eq).trim();
                let value = line.slice(eq + 1).trim();

                if (
                    (value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith('\'') && value.endsWith('\''))
                ) {
                    value = value.slice(1, -1);
                }

                result.set(key, value);
            }
        } catch {
            // ignore missing .env
        }

        return result;
    }

    private static compareSnapshots(a: SettingsSnapshot, b: SettingsSnapshot): ReadonlySet<keyof SettingMap> {
        const changed = new Set<keyof SettingMap>();

        for (const key of Object.keys(a) as Array<keyof SettingMap>) {
            if (!deepEqual(a[key], b[key])) {
                changed.add(key);
            }
        }

        return changed;
    }

    private async recomputeAndEmit(): Promise<void> {
        const next = await this.computeSnapshot();

        const changedSettings = SettingsService.compareSnapshots(this._snapshot, next);
        if (changedSettings.size > 0) {
            const event: SettingChangeEvent = {
                changed: changedSettings,
                affects: <S extends AnySettingDecl>(setting: S) => changedSettings.has(this.toName(setting)),
            };
            this._snapshot = next;
            // delay event emission to ensure that all changes are applied before listeners react
            Promise.resolve().then(() => this._onChangeEmitter.fire(event));
        }
    }

    private toName<S extends AnySettingDecl>(setting: S): keyof SettingMap {
        for (const key of Object.keys(Setting) as Array<keyof SettingMap>) {
            if (Setting[key] === setting) {
                return key;
            }
        }

        throw new Error(`Unknown setting declaration: ${setting.key}`);
    }
}
