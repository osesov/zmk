import * as vscode from "vscode";
import { AppServiceContainer, AppServices } from "../AppServices";
import { zmkCommand } from "../../components/constants";
import { writeTextToClipboard } from "../../components/utils";
import { Setting } from "../ISettingsService";
import { IConfigTreeProvider } from "../IConfigTreeProvider";

type BuildMode = "dev" | "prd" | "tst" | "cqa";

const BUILD_MODES = new Set<BuildMode>(["dev", "prd", "tst", "cqa"]);

interface CurrentConfig {
    selection: string | undefined
}

interface ParsedConfigName {
    original: string;
    pathParts: string[];
    mode?: BuildMode;
}

function parseConfigName(name: string): ParsedConfigName {
    const parts = name.split("-").filter(Boolean);

    if (parts.length === 0) {
        return { original: name, pathParts: [] };
    }

    const last = parts[parts.length - 1] as BuildMode;

    if (BUILD_MODES.has(last)) {
        return {
            original: name,
            pathParts: parts.slice(0, -1),
            mode: last,
        };
    }

    return {
        original: name,
        pathParts: parts,
    };
}

interface GroupNode {
    kind: "group";
    label: string;
    prefix: string | undefined;
    children: Map<string, GroupNode | ConfigNode>;
}

interface ConfigNode {
    kind: "config";
    label: string;
    fullName: string;
}

interface NotValhallaProjectNode {
    kind: "notValhalla";
    label: string;
}

type ModelNode = GroupNode | ConfigNode | NotValhallaProjectNode;

function createGroup(label: string, prefix: string | undefined): GroupNode {
    return {
        kind: "group",
        label,
        prefix,
        children: new Map(),
    };
}

function buildConfigTree(names: string[]): GroupNode {
    const root = createGroup("root", undefined);

    for (const name of names) {
        const parsed = parseConfigName(name);
        let current = root;

        for (let index = 0; index < parsed.pathParts.length; index++) {
            const part = parsed.pathParts[index];
            const existing = current.children.get(part);

            if (existing?.kind === "group") {
                current = existing;
            } else {
                const next = createGroup(part, parsed.pathParts.slice(0, index + 1).join('-'));
                current.children.set(part, next);
                current = next;
            }
        }

        const leafLabel = parsed.mode ?? "(default)";
        current.children.set(`__config__${name}`, {
            kind: "config",
            label: leafLabel,
            fullName: name,
        });
    }

    return root;
}

class ConfigTreeItem extends vscode.TreeItem {
    constructor(
        public readonly node: ModelNode,
        collapsibleState: vscode.TreeItemCollapsibleState,
        currentConfig: CurrentConfig,
    ) {
        super(node.label, collapsibleState);

        if (node.kind === "config") {
            const isCurrent = currentConfig.selection === node.fullName;
            this.contextValue = isCurrent ? "defaultConfig" : "config";
            this.description = node.fullName;
            this.iconPath = isCurrent ? new vscode.ThemeIcon('star-full') : new vscode.ThemeIcon('star-empty');
        } else if (node.kind === "group") {
            const isCurrent = currentConfig.selection?.startsWith(node.prefix + '-') ?? false
            this.contextValue = "group";
            this.iconPath = isCurrent ? new vscode.ThemeIcon('folder-active') : new vscode.ThemeIcon('folder')
        } else if (node.kind === "notValhalla") {
            this.contextValue = "notValhalla";
            this.iconPath = new vscode.ThemeIcon('warning');
        }
    }
}

type ConfigTreeProviderDeps = Pick<AppServices, 'context' | 'settings' | 'builder'>;

export function createConfigTreeProvider(services: AppServiceContainer): ConfigTreeProvider
{
    return new ConfigTreeProvider({
        context: services.get('context'),
        settings: services.get('settings'),
        builder: services.get('builder'),
    });
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<ModelNode>, IConfigTreeProvider
{
    private _onDidChangeTreeData = new vscode.EventEmitter<ModelNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private root: GroupNode = createGroup("root", undefined);
    private configs: string[] | null | undefined = undefined;
    private currentConfig: CurrentConfig = { selection: undefined }
    private readonly settings: AppServices['settings'];
    private readonly builder: AppServices['builder'];

    constructor(deps: ConfigTreeProviderDeps)
    {
        const context = deps.context;
        const settings = deps.settings;
        this.settings = deps.settings;
        this.builder = deps.builder;

        context.subscriptions.push(vscode.window.registerTreeDataProvider("configTreeView", this));
        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkRefreshConfigTree,
            () => {
                this.refresh();
            }
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkSetDefaultConfig,
            async (configNode: ModelNode | string) => {
                const configName = typeof configNode === "string" ? configNode
                    : configNode.kind === "config" ? configNode.fullName
                    : undefined;

                if (!configName) {
                    return;
                }

                await settings.update(Setting.config, configName);
            }
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkOpenConfig,
            async (configNode: ModelNode) => {
                if (configNode.kind === "config") {
                    const configName = configNode.fullName;

                    const configPath = await this.builder.getConfigPath(configName);
                    if (configPath) {
                        const doc = await vscode.workspace.openTextDocument(configPath);
                        await vscode.window.showTextDocument(doc);
                    } else {
                        vscode.window.showErrorMessage(`Could not find path for config ${configName}`);
                    }
                }
            }
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkCopyConfig,
            async (configNode: ModelNode) => {
                if (configNode.kind !== "config") {
                    return;
                }

                try {
                    await writeTextToClipboard(configNode.fullName);
                    vscode.window.setStatusBarMessage("Copied config name to clipboard", 2000);
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to copy: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        ));

        settings.onChange( e => {
            if (e.affects(Setting.config) || e.affects(Setting.isValhallaProject)) {
                this.setCurrentConfig(settings.get(Setting.config));
            }
        });

        this.currentConfig.selection = settings.get(Setting.config);

        // vscode.workspace.createFileSystemWatcher('configs/*.yaml'/)
    }

    private setCurrentConfig(config: string | undefined)
    {
        this.currentConfig.selection = config;
        this._onDidChangeTreeData.fire();
    }

    private setConfigurations(configs: string[]): void {
        this.root = buildConfigTree(configs);
        this.configs = configs;
        this._onDidChangeTreeData.fire();
    }

    private refresh(): void {
        this.configs = undefined;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ModelNode): vscode.TreeItem {
        if (element.kind === "group") {
            return new ConfigTreeItem(element, vscode.TreeItemCollapsibleState.Collapsed, this.currentConfig);
        }

        return new ConfigTreeItem(element, vscode.TreeItemCollapsibleState.None, this.currentConfig);
    }

    async getChildren(element?: ModelNode): Promise<ModelNode[]> {
        if (this.configs === undefined) {
            if (!this.settings.get(Setting.isValhallaProject)) {
                this.configs = null;
            }

            else {
                const configs = await this.builder.listConfigs()
                this.setConfigurations(configs);
            }
        }

        if (this.configs === null) {
            return [
                {
                    kind: "notValhalla",
                    label: "Current workspace is not a Valhalla project",
                }
            ];
        }

        if (!element) {
            return Promise.resolve(this.sortedChildren(this.root));
        }

        if (element.kind === "group") {
            return Promise.resolve(this.sortedChildren(element));
        }

        return Promise.resolve([]);
    }

    private sortedChildren(group: GroupNode): ModelNode[] {
        return [...group.children.values()].sort((a, b) => {
            if (a.kind !== b.kind) {
                return a.kind === "group" ? -1 : 1;
            }
            return a.label.localeCompare(b.label);
        });
    }
}
