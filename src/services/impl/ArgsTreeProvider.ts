import * as vscode from "vscode";
import { IArgsTreeProvider } from "../IArgsTreeProvider";
import { AppServiceContainer } from "../AppServices";
import { IArgsFileService } from "../IArgsFileService";
import { ISettingsService, Setting } from "../ISettingsService";

class ArgsNode extends vscode.TreeItem
{
    constructor(
        public readonly text: string | null,
        public readonly name: string,
        public readonly type: string,
        public readonly value: string
    ) {
        const label = text ?? `${name} = ${value}`;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = text ? undefined : `${type} ${name} = ${value}`;
    }
}

class NotValhallaArgsNode extends ArgsNode
{
    constructor()
    {
        super('Not Valhalla Args', '', '', '');
    }
}

export class ArgsTreeProvider implements vscode.TreeDataProvider<ArgsNode>, IArgsTreeProvider
{

    private _onDidChangeTreeData: vscode.EventEmitter<ArgsNode | undefined | void> = new vscode.EventEmitter<ArgsNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<ArgsNode | undefined | void> = this._onDidChangeTreeData.event;
    private argsFile: IArgsFileService;
    private settings: ISettingsService;

    constructor(private services: AppServiceContainer)
    {
        this.argsFile = this.services.get('argsFile');
        this.settings = this.services.get('settings');
        this.argsFile.onChange(() => {
            this._onDidChangeTreeData.fire();
        });

        vscode.window.createTreeView('argsView', { treeDataProvider: this });
    }

    getTreeItem(element: ArgsNode): vscode.TreeItem | Thenable<vscode.TreeItem>
    {
        return element;
    }

    getChildren(element?: ArgsNode | undefined): vscode.ProviderResult<ArgsNode[]>
    {
        if (!element) {
            if ((!this.settings.get(Setting.isValhallaProject)))
                return Promise.resolve([new NotValhallaArgsNode()]);

            const args = this.argsFile.getArgs()?.getAll() ?? null;

            if (!args) {
                return Promise.resolve([]);
            }

            const getType = (value: unknown): string => {
                return typeof value;
            }

            return Array.from(args.entries())
            .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
            .map(([key, value]) => new ArgsNode(null, key, getType(value), String(value)));
        }
        return Promise.resolve([]);
    }
}
