import * as vscode from "vscode";
import type * as cpptools from "vscode-cpptools";
import shell from 'shell-quote';

import { ISourceFileConfigurationItemTreeProvider } from "../ISourceFileConfigurationItemTreeProvider";
import { AppServiceContainer } from "../AppServices";
import { JsonValue, Setting } from "../ISettingsService";
import path from "path";
import { Context, zmkCommand } from "../../components/constants";
import { setContext, writeTextToClipboard } from "../../components/utils";
import { SourceFileConfigurationEx } from "../ICompileCommandsService";

type NodeType =
    | "compiler"
    | "compileCommand"
    | "includes"
    | "include"
    | "defines"
    | "intellisense"
    | "args"
    | "path"
    | "mode"
    | "standard"
    | "text"
    ;

const ICONS: Record<NodeType, vscode.ThemeIcon | undefined> = {
    compiler: new vscode.ThemeIcon("gear"),
    compileCommand: new vscode.ThemeIcon("play"),
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
    text: undefined,
} as const;

const TITLE: Record<NodeType, string | undefined> = {
    compiler: "Compiler",
    compileCommand: "Compile Command",
    includes: "Includes",
    include: "Include",
    defines: "Defines",
    intellisense: "IntelliSense",
    args: "Args",
    path: "Path",
    mode: "Mode",
    standard: "Standard",
    text: undefined,
};

interface PlainString
{
    text: string
    tooltip?: string
    description?: string
}

function isCollapsibleState(value: any): value is vscode.TreeItemCollapsibleState {
    return Object.values(vscode.TreeItemCollapsibleState).includes(value);
}

export class ConfigNode extends vscode.TreeItem {

    constructor(public readonly nodeType: NodeType,
        public readonly value: {
            collapsibleState?: vscode.TreeItemCollapsibleState,
            text?: string,
            tooltip?: string,
            description?: string
        })
    {
        super(value.text ?? TITLE[nodeType] ?? '', value.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
        this.iconPath = ICONS[nodeType];
        this.tooltip = value.tooltip;
        this.description = value.description;
    }
}

export class IncludeNode extends ConfigNode
{
    public readonly children: IncludeNode[] = [];

    constructor(public readonly path: string, public fullPath: string, public fsPath: string)
    {
        super('text', { text: path, tooltip: fullPath });
        this.contextValue = "include";
    }
}

export class NonValhallaProjectNode extends ConfigNode
{
    constructor()
    {
        super('text', { text: "Current workspace is not a Valhalla project", tooltip: "Current workspace is not a Valhalla project" });

        this.contextValue = "notValhalla";
        this.iconPath = new vscode.ThemeIcon('warning');
    }
}

function optimizeTree(node: IncludeNode[]): IncludeNode[]
{
    if (node.length === 1) {
        const n = node[0];
        while (n.children.length === 1) {
            const child = n.children[0];
            n.label += path.sep + child.label;
            n.fullPath += path.sep + child.path;
            n.tooltip += path.sep + child.path;
            n.fsPath = child.fsPath;
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
            n.fullPath += path.sep + child.path;
            n.tooltip += path.sep + child.path;
            n.fsPath = child.fsPath;
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

    private config: cpptools.SourceFileConfiguration | null | undefined;
    private compileCommand: SourceFileConfigurationEx | null | undefined;
    private viewMode: "tree" | "list" = "tree";
    private isValhallaProject = false;

    constructor(private services: AppServiceContainer)
    {
        const context = services.get('context');
        const settings = services.get('settings');
        const cppToolsProvider = this.services.get('cppToolsProvider');
        const compileCommands = this.services.get('compileCommands');

        vscode.window.createTreeView("cppSourceConfig", {
            treeDataProvider: this
        });

        if (cppToolsProvider) {
            const loadCurrentConfig = () => {
                const uri = vscode.window.activeTextEditor?.document.uri;
                const config = uri && cppToolsProvider.getProvidedConfiguration(uri);
                const compileCommand = uri && compileCommands.getSourceFileConfiguration(uri);
                this.setConfiguration(config, compileCommand);
            }

            loadCurrentConfig();
            context.subscriptions.push( vscode.window.onDidChangeActiveTextEditor(() => loadCurrentConfig()));
            cppToolsProvider.onDidChangeSourceFileConfiguration(() => loadCurrentConfig());
        }

        this.isValhallaProject = settings.get(Setting.isValhallaProject);
        settings.onChange(e => {
            if (e.affects(Setting.isValhallaProject)) {
                this.isValhallaProject = settings.get(Setting.isValhallaProject);
                this.refresh();
            }
        });

        this.setViewMode("tree");

        context.subscriptions.push(
            vscode.commands.registerCommand(zmkCommand.toggleIncludeTreeView, () => {
                this.setViewMode("tree");
            }),

            vscode.commands.registerCommand(zmkCommand.toggleIncludeListView, () => {
                this.setViewMode("list");
            }),

            vscode.commands.registerCommand(zmkCommand.revealIncludeInExplorer, async (node: IncludeNode) => {
                if (node) {
                    const uri = vscode.Uri.file(node.fsPath);
                    await vscode.commands.executeCommand('workbench.view.explorer');
                    vscode.commands.executeCommand('revealInExplorer', uri);
                }
            }),

            vscode.commands.registerCommand(zmkCommand.revealIncludeInOS, (node: IncludeNode) => {
                if (node) {
                    const uri = vscode.Uri.file(node.fsPath);
                    vscode.commands.executeCommand('revealFileInOS', uri);
                }
            }),

            vscode.commands.registerCommand(zmkCommand.copyText, async (node: ConfigNode) => {
                await writeTextToClipboard(this.copyText(node));
            }),

            vscode.commands.registerCommand(zmkCommand.copyJson, async (node: ConfigNode) => {
                const value = this.copyJson(node);
                if (value !== undefined) {
                    const json = JSON.stringify(value, null, 4);
                    await writeTextToClipboard(json);
                }
                else
                    await writeTextToClipboard('');
            })
        )
    }

    private setConfiguration(cfg: cpptools.SourceFileConfiguration | null | undefined, compileCommand: SourceFileConfigurationEx | null | undefined) {
        this.config = cfg;
        this.compileCommand = compileCommand;
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConfigNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConfigNode): Thenable<ConfigNode[]> {

        if (!this.isValhallaProject) {
            return Promise.resolve([
                new NonValhallaProjectNode()
            ]);
        }

        if (!this.config)
            return Promise.resolve([]);

        if (!element)
            return Promise.resolve([
                new ConfigNode("compiler", {collapsibleState: vscode.TreeItemCollapsibleState.Collapsed}),
                new ConfigNode("compileCommand", {collapsibleState: vscode.TreeItemCollapsibleState.Collapsed}),
                new ConfigNode("includes", {collapsibleState: vscode.TreeItemCollapsibleState.Collapsed}),
                new ConfigNode("defines", {collapsibleState: vscode.TreeItemCollapsibleState.Collapsed}),
                new ConfigNode("intellisense", {collapsibleState: vscode.TreeItemCollapsibleState.Collapsed})
            ]);

        switch (element.nodeType) {

            case "compiler":
                return Promise.resolve([
                    new ConfigNode("path", {collapsibleState: vscode.TreeItemCollapsibleState.None, text: this.config.compilerPath ?? "not set"}),
                    new ConfigNode("args", {collapsibleState: vscode.TreeItemCollapsibleState.Collapsed})
                ]);

            case "args":
                return Promise.resolve(
                    (this.config.compilerArgs ?? [])
                        .map(a => new ConfigNode('text', {text: a}))
                );

            case "compileCommand":
                return Promise.resolve(this.compileCommand?._command.map( arg => new ConfigNode('text', {text: arg})) ?? []);

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
                                    const node = new IncludeNode(parts[i], nodePath, valhallaDir ? path.join(valhallaDir, nodePath) : nodePath);
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
                        return Promise.resolve(topLevelNodes);
                    }

                    else {
                        return Promise.resolve((this.config.includePath ?? [])
                        .sort((a, b) => a.localeCompare(b))
                        .map(p => {
                            const relativePath = valhallaDir ? path.relative(valhallaDir, p) : p;
                            return new IncludeNode(relativePath, p, p);
                        }));
                    }
                }

            case "defines":
                return Promise.resolve(
                    (this.config.defines ?? [])
                        .map(d => new ConfigNode('text', {text: d}))
                );

            case "intellisense":
                return Promise.resolve([
                    new ConfigNode("mode", { text: this.config.intelliSenseMode }),
                    new ConfigNode("standard", { text: this.config.standard })
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

    private copyText(node: ConfigNode): string | null | undefined
    {
        if (!this.config)
            return null;

        switch (node.nodeType) {
            case 'compiler':
                return shell.quote([this.config.compilerPath, ...this.config.compilerArgs ?? [] ].filter( e => e !== undefined));

            case 'compileCommand':
                return shell.quote(this.compileCommand?._command ?? []);

            case 'includes':
                return this.config.includePath.join('\n');

            case 'include':
                if (!(node instanceof IncludeNode))
                    return null;

                return node.fsPath;

            case 'defines':
                return this.config.defines.join('\n');

            case 'standard':
                return this.config.standard;
            case 'intellisense':
            case 'mode':
                return this.config.intelliSenseMode;

            case 'path':
                return this.config.compilerPath;

            case 'args':
                return shell.quote(this.config.compilerArgs ?? []);

            default:
                return node.value?.text;
        }
    }

    private copyJson(node: ConfigNode): JsonValue | undefined
    {
        if (!this.config)
            return undefined;

        switch (node.nodeType) {
            case 'compiler':
                return [this.config.compilerPath, ...this.config.compilerArgs ?? [] ].filter( e => e !== undefined);

            case 'compileCommand':
                return this.compileCommand?._command ?? [];

            case 'includes':
                return this.config.includePath;

            case 'include':
                if (!(node instanceof IncludeNode))
                    return undefined;

                return node.fsPath;

            case 'defines':
                return this.config.defines;

            case 'intellisense':
                return {
                    mode: this.config.intelliSenseMode ?? null,
                    standard: this.config.standard ?? null
                };

            case 'standard':
                return this.config.standard;
            case 'mode':
                return this.config.intelliSenseMode;

            case 'path':
                return this.config.compilerPath;

            case 'args':
                return this.config.compilerArgs ?? [];

            default:
                return node.value?.text;
        }
    }
}
