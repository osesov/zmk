import * as vscode from "vscode";
import type * as cpptools from "vscode-cpptools";
import { ISourceFileConfigurationItemTreeProvider } from "../ISourceFileConfigurationItemTreeProvider";
import { AppServices } from "../AppServices";
import { ServiceContainer } from "../ServiceContainer";
import { Setting } from "../ISettingsService";
import path from "path";

type NodeType =
    | "compiler"
    | "includes"
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
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly value?: string,
    ) {
        const isPredefined = typeof nodeType === "string";
        const label = isPredefined ? TITLE[nodeType] : nodeType.text;
        super(label, collapsibleState);

        if (value !== undefined) {
            this.description = value;
        }

        this.iconPath = isPredefined ? ICONS[nodeType] : undefined
        this.description = isPredefined ? undefined : nodeType.description;
        this.tooltip = isPredefined ? undefined : nodeType.tooltip;
    }
}

export class SourceFileConfigurationItemTreeProvider
    implements vscode.TreeDataProvider<ConfigNode>, ISourceFileConfigurationItemTreeProvider
{
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private config?: cpptools.SourceFileConfiguration | null | undefined;

    constructor(private services: ServiceContainer<AppServices>)
    {
        vscode.window.createTreeView("cppSourceConfig", {
            treeDataProvider: this
        });

        const cppToolsProvider = this.services.get('cppToolsProvider');

        if (cppToolsProvider) {
            const loadCurrentConfig = () => {
                const uri = vscode.window.activeTextEditor?.document.uri;
                const config = uri && cppToolsProvider.getProvidedConfiguration(uri);
                this.setConfiguration(config);
            }

            cppToolsProvider.onDidChangeSourceFileConfiguration(() => loadCurrentConfig());
            loadCurrentConfig();
        }
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

        switch (element.label) {

            case "Compiler":
                return Promise.resolve([
                    new ConfigNode("path", vscode.TreeItemCollapsibleState.None, this.config.compilerPath ?? "not set"),
                    new ConfigNode("args", vscode.TreeItemCollapsibleState.Collapsed)
                ]);

            case "Args":
                return Promise.resolve(
                    (this.config.compilerArgs ?? [])
                        .map(a => new ConfigNode({text: a}, vscode.TreeItemCollapsibleState.None))
                );

            case "Includes":
                return Promise.resolve(
                    this.config.includePath.map(p => {
                        const valhallaDir = this.services.get('settings').get(Setting.valhallaDir)
                        const relativePath = valhallaDir ? path.relative(valhallaDir, p) : p;
                        return new ConfigNode({text:relativePath, tooltip: p}, vscode.TreeItemCollapsibleState.None);
                }));

            case "Defines":
                return Promise.resolve(
                    (this.config.defines ?? [])
                        .map(d => new ConfigNode({text:d}, vscode.TreeItemCollapsibleState.None))
                );

            case "IntelliSense":
                return Promise.resolve([
                    new ConfigNode("mode", vscode.TreeItemCollapsibleState.None, this.config.intelliSenseMode),
                    new ConfigNode("standard", vscode.TreeItemCollapsibleState.None, this.config.standard)
                ]);
        }

        return Promise.resolve([]);
    }
}
