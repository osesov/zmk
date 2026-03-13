import * as vscode from "vscode";
import { ITargetTreeProvider } from "../ITargetTreeProvider";
import { ParsedTarget, parseTarget } from "../../components/parseTarget";
import { ServiceContainer } from "../ServiceContainer";
import { AppServices } from "../AppServices";
import { zmkCommand } from "../../components/constants";
import { Setting } from "../ISettingsService";

interface CurrentTarget {
    selection: ParsedTarget | undefined | null
}

interface TargetGroupNode {
    kind: "group";
    label: string;
    prefix: string[] | undefined;
    parent: TargetGroupNode | undefined;
    children: Map<string, TargetGroupNode>;
    targets: TargetLeafNode[];
}

interface TargetLeafNode {
    kind: "target";
    label: string;      // action
    fullTarget: string; // original target
    parent: TargetGroupNode | undefined;
}

type TargetNode = TargetGroupNode | TargetLeafNode;

function createGroup(label: string, prefix: string[] | undefined, parent: TargetGroupNode | undefined): TargetGroupNode {
    return {
        kind: "group",
        label,
        prefix,
        parent,
        children: new Map(),
        targets: [],
    };
}

function isNodeAffected(node: TargetGroupNode, target: ParsedTarget | undefined | null): boolean
{
    if (!node.prefix) { // root node
        return false;
    }
    if (node.prefix.length > (target?.pathParts.length ?? 0)) {
        return false;
    }
    return node.prefix.every((part, index) => part === target?.pathParts[index]);
}

export class TargetTreeItem extends vscode.TreeItem {
    constructor(
        public readonly node: TargetNode,
        currentTarget: CurrentTarget,
    ) {
        super(
            node.label,
            node.kind === "group"
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );

        if (node.kind === "group") {
            const isCurrent = isNodeAffected(node, currentTarget.selection);
            this.iconPath = isCurrent ? new vscode.ThemeIcon('folder-active') : new vscode.ThemeIcon('folder');
            this.contextValue = "targetGroup";
        } else {
            const isCurrent = currentTarget.selection?.original === node.fullTarget;

            this.iconPath = isCurrent ? new vscode.ThemeIcon('star-full') : new vscode.ThemeIcon('star-empty');
            this.contextValue = isCurrent ? "currentTarget" : "target";
            this.description = node.fullTarget;
        }
    }
}

export function buildTargetTree(targets: readonly string[], nodeMap: Map<string, TargetLeafNode>): TargetGroupNode {
    const root = createGroup("root", undefined, undefined);

    for (const target of targets) {
        const parsed = parseTarget(target, false);
        if (!parsed)
            continue;

        let current = root;

        for (let index = 0; index < parsed.pathParts.length; index++) {
            const part = parsed.pathParts[index];
            let next = current.children.get(part);
            if (!next) {
                next = createGroup(part, parsed.pathParts.slice(0, index + 1), current);
                current.children.set(part, next);
            }
            current = next;
        }

        const leafNode: TargetLeafNode = {
            kind: "target",
            label: parsed.action,
            fullTarget: parsed.original,
            parent: current,
        };
        current.targets.push(leafNode);
        nodeMap.set(target, leafNode);
    }

    return root;
}

export class TargetTreeProvider implements vscode.TreeDataProvider<TargetNode>, ITargetTreeProvider
{
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TargetNode | undefined | void>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private root: TargetGroupNode = createGroup("root", undefined, undefined);
    private currentTarget: CurrentTarget = { selection: undefined }
    private targetLoaded: boolean = false;
    private nodeMap = new Map<string, TargetLeafNode>();

    constructor(private services: ServiceContainer<AppServices>)
    {
        const context = services.get('context');
        const settings = services.get('settings');

        context.subscriptions.push(vscode.window.registerTreeDataProvider("targetTreeView", this));
        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkRefreshTargetTree,
            () => {
                this.refresh();
            }
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkSetDefaultTarget,
            async (node: TargetLeafNode) => {
                await settings.update(Setting.target, node.fullTarget);
            }
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkResetTarget,
            async () => {
                await settings.update(Setting.target, undefined);
            }
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkBuildTarget,
            async (node: TargetLeafNode) => {
                await this.services.get('builder').buildTarget(node.fullTarget);
            },
        ));

        settings.onChange( e => e.affects(Setting.target) && this.setCurrentTarget(settings.get(Setting.target)))
        this.setCurrentTargetWithoutEvent(settings.get(Setting.target));
    }

    private setCurrentTargetWithoutEvent(target: string | undefined)
    {
        if (this.currentTarget.selection) {
            this.refresh(this.currentTarget.selection.original);
        }
        this.currentTarget.selection = target ? parseTarget(target, true) : undefined;
        this.refresh(this.currentTarget.selection?.original);

        vscode.commands.executeCommand("setContext", zmkCommand.zmkTargetSelected, !!target)
        .then(
            () => {},
            (e) => {vscode.window.showErrorMessage(`Failed to set context for targetSelected: ${e}`)}
        );
    }

    setCurrentTarget(target: string | undefined)
    {
        this.setCurrentTargetWithoutEvent(target);
        this._onDidChangeTreeData.fire();
    }

    public setTargets(targets: readonly string[]): void {
        this.nodeMap.clear();
        this.root = buildTargetTree(targets, this.nodeMap);
        this.refresh();
    }

    public refresh(node?: TargetNode | string): void {
        if (typeof node === "string") {
            node = this.nodeMap.get(node);
        }
        this._onDidChangeTreeData.fire(node);
    }

    public getTreeItem(element: TargetNode): vscode.TreeItem {
        return new TargetTreeItem(element, this.currentTarget);
    }

    public async getChildren(element?: TargetNode): Promise<TargetNode[]> {
        if (!this.targetLoaded) {
            const projectInfo = await this.services.get('projectInfo').getProjectInfo();
            if (!projectInfo || !projectInfo.targets) {
                this.targetLoaded = true;
                return [];
            }

            const targets = projectInfo.targets;
            this.setTargets(Object.keys(targets));
            this.targetLoaded = true;
        }

        if (!element) {
            return Promise.resolve(this.getSortedChildren(this.root));
        }

        if (element.kind === "group") {
            return Promise.resolve(this.getSortedChildren(element));
        }

        return Promise.resolve([]);
    }

    private getSortedChildren(group: TargetGroupNode): TargetNode[] {
        const groups = [...group.children.values()].sort((a, b) => a.label.localeCompare(b.label));
        const targets = [...group.targets].sort((a, b) => a.label.localeCompare(b.label));
        return [...groups, ...targets];
    }
}
