import * as vscode from "vscode";
import { ServiceContainer } from "../ServiceContainer";
import { AppServices } from "../AppServices";
import { zmkCommand } from "../../components/constants";
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

type ModelNode = GroupNode | ConfigNode;

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
            this.contextValue = "config";
            this.description = node.fullName;
            this.iconPath = isCurrent ? new vscode.ThemeIcon('star-full') : new vscode.ThemeIcon('star-empty');
        } else {
            const isCurrent = currentConfig.selection?.startsWith(node.prefix + '-') ?? false
            this.contextValue = "group";
            this.iconPath = isCurrent ? new vscode.ThemeIcon('folder-active') : new vscode.ThemeIcon('folder')
        }
    }
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<ModelNode>, IConfigTreeProvider
{
    private _onDidChangeTreeData = new vscode.EventEmitter<ModelNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private root: GroupNode = createGroup("root", undefined);
    private configs: string[] | null = null
    private currentConfig: CurrentConfig = { selection: undefined }

    constructor(private services: ServiceContainer<AppServices>)
    {
        const context = services.get('context');

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

                await this.services.get('settings').update(Setting.config, configName);
            }
        ));

        const settings = services.get('settings');

        settings.onChange( e => e.affects(Setting.config) && this.setCurrentConfig(settings.get(Setting.config)))
        this.currentConfig.selection = settings.get(Setting.config);

        // vscode.workspace.createFileSystemWatcher('configs/*.yaml'/)
    }

    setCurrentConfig(config: string | undefined)
    {
        this.currentConfig.selection = config;
        this._onDidChangeTreeData.fire();
    }

    setConfigurations(configs: string[]): void {
        this.root = buildConfigTree(configs);
        this.configs = configs;
        this._onDidChangeTreeData.fire();
    }

    refresh(): void {
        this.configs = null;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ModelNode): vscode.TreeItem {
        if (element.kind === "group") {
            return new ConfigTreeItem(element, vscode.TreeItemCollapsibleState.Collapsed, this.currentConfig);
        }

        return new ConfigTreeItem(element, vscode.TreeItemCollapsibleState.None, this.currentConfig);
    }

    async getChildren(element?: ModelNode): Promise<ModelNode[]> {
        if (this.configs === null) {
            const configs = await this.services.get('builder').listConfigs()
            this.setConfigurations(configs);
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
