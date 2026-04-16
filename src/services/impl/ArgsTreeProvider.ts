import * as vscode from "vscode";
import { ArgValue } from "../../components/ArgsFile";
import { zmkCommand } from "../../components/constants";
import { writeTextToClipboard } from "../../components/utils";
import { IArgsTreeProvider } from "../IArgsTreeProvider";
import { AppServiceContainer, AppServices } from "../AppServices";
import { IArgsFileService } from "../IArgsFileService";
import { ISettingsService, Setting } from "../ISettingsService";

class ArgsNode extends vscode.TreeItem
{
    constructor(
        public readonly text: string | null,
        public readonly name: string,
        public readonly value: ArgValue
    ) {
        const valueText = ArgsNode.getDisplayValue(value);
        const label = text ?? `${name} = ${valueText}`;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = text ? undefined : `${typeof value} ${name} = ${valueText}`;
        this.contextValue = text ? undefined : "arg";
    }

    public get valueText(): string
    {
        return ArgsNode.getDisplayValue(this.value);
    }

    public get assignmentText(): string
    {
        return `${this.name}=${ArgsNode.getAssignmentValue(this.value)}`;
    }

    private static getDisplayValue(value: ArgValue): string
    {
        return String(value);
    }

    private static getAssignmentValue(value: ArgValue): string
    {
        if (typeof value === "string") {
            return JSON.stringify(value);
        }

        return String(value);
    }
}

class NotValhallaProjectNode extends ArgsNode
{
    constructor()
    {
        super('Current workspace is not a Valhalla project', '', '');
        this.contextValue = "notValhalla";
        this.iconPath = new vscode.ThemeIcon('warning');
    }
}

type ArgsTreeProviderDeps = Pick<AppServices, 'context' | 'argsFile' | 'settings'>;

export function createArgsTreeProvider(services: AppServiceContainer): ArgsTreeProvider
{
    return new ArgsTreeProvider({
        context: services.get('context'),
        argsFile: services.get('argsFile'),
        settings: services.get('settings'),
    });
}

export class ArgsTreeProvider implements vscode.TreeDataProvider<ArgsNode>, IArgsTreeProvider
{

    private _onDidChangeTreeData: vscode.EventEmitter<ArgsNode | undefined | void> = new vscode.EventEmitter<ArgsNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ArgsNode | undefined | void> = this._onDidChangeTreeData.event;
    private argsFile: IArgsFileService;
    private settings: ISettingsService;
    private readonly treeView: vscode.TreeView<ArgsNode>;

    constructor(deps: ArgsTreeProviderDeps)
    {
        this.argsFile = deps.argsFile;
        this.settings = deps.settings;
        this.argsFile.onChange(() => {
            this._onDidChangeTreeData.fire();
        });

        this.treeView = vscode.window.createTreeView('argsView', { treeDataProvider: this });

        deps.context.subscriptions.push(
            this.treeView,
            vscode.commands.registerCommand(zmkCommand.zmkCopyArgValue, async (node?: ArgsNode) => {
                await this.copyArgText(node, currentNode => currentNode.valueText, "Copied value to clipboard");
            }),
            vscode.commands.registerCommand(zmkCommand.zmkCopyArgPair, async (node?: ArgsNode) => {
                await this.copyArgText(node, currentNode => currentNode.assignmentText, "Copied name=value to clipboard");
            }),
        );
    }

    getTreeItem(element: ArgsNode): vscode.TreeItem | Thenable<vscode.TreeItem>
    {
        return element;
    }

    getChildren(element?: ArgsNode | undefined): vscode.ProviderResult<ArgsNode[]>
    {
        if (!element) {
            if ((!this.settings.get(Setting.isValhallaProject)))
                return Promise.resolve([new NotValhallaProjectNode()]);

            const args = this.argsFile.getArgs()?.getAll() ?? null;

            if (!args) {
                return Promise.resolve([]);
            }

            return Array.from(args.entries())
            .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
            .map(([key, value]) => new ArgsNode(null, key, value));
        }
        return Promise.resolve([]);
    }

    private getSelectedArgNode(node?: ArgsNode): ArgsNode | undefined
    {
        const selectedNode = node ?? this.treeView.selection[0];
        if (selectedNode?.contextValue === "arg") {
            return selectedNode;
        }

        vscode.window.showInformationMessage("Select an arg entry first.");
        return undefined;
    }

    private async copyArgText(node: ArgsNode | undefined, getText: (node: ArgsNode) => string, successMessage: string): Promise<void>
    {
        const selectedNode = this.getSelectedArgNode(node);
        if (!selectedNode) {
            return;
        }

        try {
            await writeTextToClipboard(getText(selectedNode));
            vscode.window.setStatusBarMessage(successMessage, 2000);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to copy: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
