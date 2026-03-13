import * as vscode from "vscode";
import type * as cpptools from "vscode-cpptools";
import { ISourceFileConfigurationItemTreeProvider } from "../ISourceFileConfigurationItemTreeProvider";
import { AppServices } from "../AppServices";
import { ServiceContainer } from "../ServiceContainer";
import { Setting } from "../ISettingsService";
import path from "path";
import { Context, zmkCommand } from "../../components/constants";
import { setContext } from "../../components/utils";

type NodeType =
    | "compiler"
    | "includes"
    | "include"
    | "defines"
    | "intellisense"
    | "args"
    | "path"
    | "mode"
    | "standard"
    ;

const ICONS: Record<NodeType, vscode.ThemeIcon | undefined> = {
    compiler: new vscode.ThemeIcon("gear"),
    includes: new vscode.ThemeIcon("folder-library"),
    include: new vscode.ThemeIcon("folder-library"),
    defines: new vscode.ThemeIcon("symbol-constant"),
    intellisense: new vscode.ThemeIcon("lightbulb"),
    args: new vscode.ThemeIcon("symbol-parameter"),
    // include: new vscode.ThemeIcon("file"),
    // define: new vscode.ThemeIcon("symbol-key"),
    path: new vscode.ThemeIcon("file-code"),
    mode: new vscode.ThemeIcon("settings-gear"),
    standard: new vscode.ThemeIcon("settings-gear"),
} as const;

const TITLE: Record<NodeType, string> = {
    compiler: "Compiler",
    includes: "Includes",
    include: "Include",
    defines: "Defines",
    intellisense: "IntelliSense",
    args: "Args",
    path: "Path",
    mode: "Mode",
    standard: "Standard",
};

interface PlainString
{
    text: string
    tooltip?: string
    description?: string
}

export class ConfigNode extends vscode.TreeItem {
    constructor(
        public readonly nodeType: NodeType | PlainString,
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly value?: string,
    ) {
        const isPredefined = typeof nodeType === "string";
        const label = isPredefined ? TITLE[nodeType] : nodeType.text;
        super(label, collapsibleState);

        this.description = value ? value
        : isPredefined ? undefined
        : nodeType.description;
        this.iconPath = isPredefined ? ICONS[nodeType] : undefined
        this.tooltip = isPredefined ? value : nodeType.tooltip;
    }
}

export class IncludeNode extends ConfigNode
{
    public readonly children: IncludeNode[] = [];

    constructor(public readonly path: string, fullPath: string)
    {
        super({ text: path, tooltip: fullPath }, vscode.TreeItemCollapsibleState.None);
    }
}

function optimizeTree(node: IncludeNode[]): IncludeNode[]
{
    if (node.length === 1) {
        const n = node[0];
        while (n.children.length === 1) {
            const child = n.children[0];
            n.label += path.sep + child.label;
            n.children.splice(0, 1, ...child.children);
            n.collapsibleState = child.collapsibleState;
        }
        optimizeTree(n.children);
        return node;
    }

    for (const n of node) {
        while (n.children.length === 1) {
            const child = n.children[0];
            n.label += path.sep + child.label;
            n.children.splice(0, 1, ...child.children);
            n.collapsibleState = child.collapsibleState;
        }
        optimizeTree(n.children);
    }
    return node;
}

export class SourceFileConfigurationItemTreeProvider
    implements vscode.TreeDataProvider<ConfigNode>, ISourceFileConfigurationItemTreeProvider
{
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private config?: cpptools.SourceFileConfiguration | null | undefined;
    private viewMode: "tree" | "list" = "tree";

    constructor(private services: ServiceContainer<AppServices>)
    {
        const context = services.get('context');
        const cppToolsProvider = this.services.get('cppToolsProvider');

        vscode.window.createTreeView("cppSourceConfig", {
            treeDataProvider: this
        });

        if (cppToolsProvider) {
            const loadCurrentConfig = () => {
                const uri = vscode.window.activeTextEditor?.document.uri;
                const config = uri && cppToolsProvider.getProvidedConfiguration(uri);
                this.setConfiguration(config);
            }

            loadCurrentConfig();
            context.subscriptions.push( vscode.window.onDidChangeActiveTextEditor(() => loadCurrentConfig()));
            cppToolsProvider.onDidChangeSourceFileConfiguration(() => loadCurrentConfig());
        }

        this.setViewMode("tree");

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.toggleIncludeTreeView, () => {
            this.setViewMode("tree");
        }));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.toggleIncludeListView, () => {
            this.setViewMode("list");
        }));
    }

    setConfiguration(cfg: cpptools.SourceFileConfiguration | null | undefined) {
        this.config = cfg;
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConfigNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConfigNode): Thenable<ConfigNode[]> {

        if (!this.config)
            return Promise.resolve([]);

        if (!element)
            return Promise.resolve([
                new ConfigNode("compiler", vscode.TreeItemCollapsibleState.Collapsed),
                new ConfigNode("includes", vscode.TreeItemCollapsibleState.Collapsed),
                new ConfigNode("defines", vscode.TreeItemCollapsibleState.Collapsed),
                new ConfigNode("intellisense", vscode.TreeItemCollapsibleState.Collapsed)
            ]);

        switch (element.nodeType) {

            case "compiler":
                return Promise.resolve([
                    new ConfigNode("path", vscode.TreeItemCollapsibleState.None, this.config.compilerPath ?? "not set"),
                    new ConfigNode("args", vscode.TreeItemCollapsibleState.Collapsed)
                ]);

            case "args":
                return Promise.resolve(
                    (this.config.compilerArgs ?? [])
                        .map(a => new ConfigNode({text: a}, vscode.TreeItemCollapsibleState.None))
                );

            case "includes":
                {
                    const settings = this.services.get('settings');
                    const valhallaDir = settings.get(Setting.valhallaDir);

                    if (this.viewMode === "tree") {
                        const nodes = new Map<string, IncludeNode>();
                        const topLevelNodes: IncludeNode[] = [];

                        for (const p of this.config.includePath ?? []) {
                            const relativePath = valhallaDir ? path.relative(valhallaDir, p) : p;
                            const parts = relativePath.split(path.sep);
                            for (let i = 0; i < parts.length; i++) {
                                const subPath = parts.slice(0, i + 1).join(path.sep);

                                if (!nodes.has(subPath)) {
                                    const nodePath = parts.slice(0, i + 1).join(path.sep);
                                    const node = new IncludeNode(parts[i], nodePath);
                                    nodes.set(subPath, node);
                                    if (i > 0) {
                                        const parentSubPath = parts.slice(0, i).join(path.sep);
                                        const parentNode = nodes.get(parentSubPath);
                                        if (parentNode) {
                                            parentNode.children.push(node);
                                            parentNode.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                                        }
                                    }
                                    else {
                                        topLevelNodes.push(node);
                                    }
                                }
                            }
                        }

                        return Promise.resolve(optimizeTree(topLevelNodes));
                    }

                    else {
                        return Promise.resolve((this.config.includePath ?? [])
                        .sort((a, b) => a.localeCompare(b))
                        .map(p => {
                            const relativePath = valhallaDir ? path.relative(valhallaDir, p) : p;
                            return new ConfigNode({text:relativePath, tooltip: p}, vscode.TreeItemCollapsibleState.None);
                        }));
                    }
                }

            case "defines":
                return Promise.resolve(
                    (this.config.defines ?? [])
                        .map(d => new ConfigNode({text:d}, vscode.TreeItemCollapsibleState.None))
                );

            case "intellisense":
                return Promise.resolve([
                    new ConfigNode("mode", vscode.TreeItemCollapsibleState.None, this.config.intelliSenseMode),
                    new ConfigNode("standard", vscode.TreeItemCollapsibleState.None, this.config.standard)
                ]);

            default:
                if (element instanceof IncludeNode) {
                    return Promise.resolve(element.children);
                }
                break;
        }

        return Promise.resolve([]);
    }

    private setViewMode(mode: typeof this.viewMode): void
    {
        this.viewMode = mode;
        setContext(Context.includeViewMode, mode);
        this.refresh();
    }
}
