import * as vscode from "vscode";
import { ITargetTreeProvider } from "../ITargetTreeProvider";
import { ParsedTarget, parseTarget } from "../../components/parseTarget";
import { ServiceContainer } from "../ServiceContainer";
import { AppServices } from "../AppServices";
import { zmkCommand } from "../../components/constants";
import { Setting } from "../ISettingsService";

interface CurrentTarget {
    selection: ParsedTarget | undefined
}

interface TargetGroupNode {
    kind: "group";
    label: string;
    prefix: string[] | undefined;
    children: Map<string, TargetGroupNode>;
    targets: TargetLeafNode[];
}

interface TargetLeafNode {
    kind: "target";
    label: string;      // action
    fullTarget: string; // original target
}

type TargetNode = TargetGroupNode | TargetLeafNode;

function createGroup(label: string, prefix: string[] | undefined): TargetGroupNode {
    return {
        kind: "group",
        label,
        prefix,
        children: new Map(),
        targets: [],
    };
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
            const isCurrent = currentTarget.selection?.pathParts
                .slice(0, node.prefix?.length)
                .every((part, index) => part === node.prefix?.[index]) ?? false;
            this.iconPath = isCurrent ? new vscode.ThemeIcon('folder-active') : new vscode.ThemeIcon('folder');
            this.contextValue = "targetGroup";
        } else {
            const isCurrent = currentTarget.selection?.original === node.fullTarget;

            this.iconPath = isCurrent ? new vscode.ThemeIcon('star-full') : new vscode.ThemeIcon('star-empty');
            this.contextValue = "target";
            this.description = node.fullTarget;
        }
    }
}

export function buildTargetTree(targets: readonly string[]): TargetGroupNode {
    const root = createGroup("root", undefined);

    for (const target of targets) {
        const parsed = parseTarget(target);

        let current = root;

        for (let index = 0; index < parsed.pathParts.length; index++) {
            const part = parsed.pathParts[index];
            let next = current.children.get(part);
            if (!next) {
                next = createGroup(part, parsed.pathParts.slice(0, index + 1));
                current.children.set(part, next);
            }
            current = next;
        }

        current.targets.push({
            kind: "target",
            label: parsed.action,
            fullTarget: parsed.original,
        });
    }

    return root;
}

export class TargetTreeProvider implements vscode.TreeDataProvider<TargetNode>, ITargetTreeProvider
{
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TargetNode | undefined | void>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private root: TargetGroupNode = createGroup("root", undefined);
    private currentTarget: CurrentTarget = { selection: undefined }
    private targetLoaded: boolean = false;

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
        this.currentTarget.selection = target ? parseTarget(target) : undefined;
    }

    setCurrentTarget(target: string | undefined)
    {
        this.setCurrentTargetWithoutEvent(target);
        this._onDidChangeTreeData.fire();
    }

    public setTargets(targets: readonly string[]): void {
        this.root = buildTargetTree(targets);
        this.refresh();
    }

    public refresh(node?: TargetNode): void {
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
