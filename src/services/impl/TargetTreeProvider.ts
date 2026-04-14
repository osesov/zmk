import * as vscode from "vscode";
import { ITargetTreeProvider } from "../ITargetTreeProvider";
import { ParsedTarget, parseTarget } from "../../components/parseTarget";
import { AppServiceContainer } from "../AppServices";
import { zmkCommand } from "../../components/constants";
import { ISettingsService, Setting } from "../ISettingsService";
import { assertNever, setContext, writeTextToClipboard } from "../../components/utils";
import { BrowseableType, IBrowseSet, IProjectInfoService } from "../IProjectInfoService";
import { ProjectJsonTargetSet } from "../../components/ProjectInfo";

interface CurrentTarget {
    selection: ParsedTarget | undefined | null
    browseSet: IBrowseSet | null;
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
    targetType: string;
}

interface NotValhallaProjectNode {
    kind: "notValhalla";
    label: string;
}

type TargetNode = TargetGroupNode | TargetLeafNode | NotValhallaProjectNode;

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
        } else if (node.kind === "target") {
            const isCurrent = currentTarget.selection?.original === node.fullTarget;
            const inBrowseSet = currentTarget.browseSet?.isBrowseable(node.fullTarget) ?? BrowseableType.POTENTIALLY;
            const contextParts = ["<target>"];

            if (isCurrent) {
                contextParts.push("<current>");
            }

            switch (inBrowseSet) {
            case BrowseableType.EXPLICITLY:
                contextParts.push("<browse>");
                contextParts.push("<browseable>");
                break;

            case BrowseableType.IMPLICITLY:
                contextParts.push("<browse-implicit>");
                contextParts.push("<browseable>");
                break;

            case BrowseableType.POTENTIALLY:
                contextParts.push("<browseable>");
                break;

            case BrowseableType.NON_BROWSEABLE:
                break;

            default:
                assertNever(inBrowseSet);
            }

            if (isCurrent)
                this.iconPath = new vscode.ThemeIcon('star-full');
            else if (inBrowseSet === BrowseableType.EXPLICITLY)
                this.iconPath = new vscode.ThemeIcon('diff-added');
            else if (inBrowseSet === BrowseableType.IMPLICITLY)
                this.iconPath = new vscode.ThemeIcon('diff-modified');
            else
                this.iconPath = new vscode.ThemeIcon('star-empty');

            // this.iconPath = isCurrent ? new vscode.ThemeIcon('star-full') : new vscode.ThemeIcon('star-empty');
            this.contextValue = contextParts.join(".");
            this.description = `[${node.targetType}] ${node.fullTarget}`;
            this.tooltip = new vscode.MarkdownString()
            .appendMarkdown(`- **Type**: \`${node.targetType}\`\n`)
            .appendMarkdown(`- **Target**: \`${node.fullTarget}\`\n`);

        } else if (node.kind === "notValhalla") {
            this.contextValue = "notValhalla";
            this.iconPath = new vscode.ThemeIcon('warning');
        }
    }
}

export function buildTargetTree(targets: ProjectJsonTargetSet, nodeMap: Map<string, TargetLeafNode>): TargetGroupNode {
    const root = createGroup("root", undefined, undefined);

    for (const [name, target] of Object.entries(targets)) {
        const parsed = parseTarget(name, false);
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
            targetType: target.type
        };
        current.targets.push(leafNode);
        nodeMap.set(name, leafNode);
    }

    return root;
}

export class TargetTreeProvider implements vscode.TreeDataProvider<TargetNode>, ITargetTreeProvider
{
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TargetNode | undefined | void>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private readonly projectInfo: IProjectInfoService;
    private settings: ISettingsService;
    private root: TargetGroupNode = createGroup("root", undefined, undefined);
    private currentTarget: CurrentTarget = { selection: undefined, browseSet: null };
    private isValhallaProject: boolean = false;
    private nodeMap = new Map<string, TargetLeafNode>();

    constructor(private services: AppServiceContainer)
    {
        const context = services.get('context');
        this.settings = services.get('settings');
        this.projectInfo = services.get('projectInfo');

        context.subscriptions.push(vscode.window.registerTreeDataProvider("targetTreeView", this));
        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkRefreshTargetTree,
            () => {
                this.refresh();
            }
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkSetDefaultTarget,
            async (node: TargetLeafNode) => {
                await this.settings.update(Setting.target, node.fullTarget);
            }
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkResetTarget,
            async () => {
                await this.settings.update(Setting.target, undefined);
            }
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkBuildTarget,
            async (node: TargetLeafNode) => {
                await this.services.get('builder').buildTarget(node.fullTarget);
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkOpenTarget,
            async (node: TargetLeafNode) => {
                if (!node.fullTarget)
                    return;

                const parts = parseTarget(node.fullTarget, false)
                const valhallaFolder = this.settings.get(Setting.valhallaFolder);
                if (!parts || !valhallaFolder)
                    return;

                const targetFile = vscode.Uri.joinPath(valhallaFolder, ...parts.pathParts, "BUILD.gn");
                try {
                    const document = await vscode.workspace.openTextDocument(targetFile);
                    await vscode.window.showTextDocument(document);
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to open target file: ${e instanceof Error ? e.message : String(e)}`);
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkCopyTarget,
            async (node: TargetLeafNode) => {
                if (node.fullTarget)
                    await writeTextToClipboard(node.fullTarget);
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkAddToBrowseSet,
            async (node: TargetLeafNode) => {
                const browseTargets = this.settings.get(Setting.browseTargets);
                if (!browseTargets.includes(node.fullTarget)) {
                    await this.settings.update(Setting.browseTargets, [...browseTargets, node.fullTarget]);
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkRemoveFromBrowseSet,
            async (node: TargetLeafNode) => {
                const browseTargets = this.settings.get(Setting.browseTargets);
                if (browseTargets.includes(node.fullTarget)) {
                    await this.settings.update(Setting.browseTargets, browseTargets.filter(t => t !== node.fullTarget));
                }
            },
        ));

        context.subscriptions.push(this.projectInfo.onChange(() => this.updateTargets(true)));
        this.settings.onChange( e => {
            const targetChanged = e.affects(Setting.target);
            const browseTargetsChanged = e.affects(Setting.browseTargets);
            if (targetChanged || browseTargetsChanged)
                this.updateCurrentTarget(targetChanged, browseTargetsChanged);
            if (e.affects(Setting.isValhallaProject))
                this.updateIsValhallaProject(true);
        });

        this.updateCurrentTarget(false, false);
        this.updateTargets(false);
        this.updateIsValhallaProject(false);
    }

    private updateIsValhallaProject(refreshTree: boolean)
    {
        this.isValhallaProject = this.settings.get(Setting.isValhallaProject);
        if (refreshTree) {
            this.refresh();
        }
    }

    private updateTargets(refreshTree: boolean)
    {
        const projectDescription = this.projectInfo.getProjectDescription();
        this.currentTarget.browseSet = this.projectInfo.getBrowseSet();

        this.nodeMap.clear();
        this.root = buildTargetTree(projectDescription?.targets ?? {}, this.nodeMap);

        if (refreshTree) {
            this.refresh();
        }
    }

    private updateCurrentTarget(targetChanged: boolean, browseTargetsChanged: boolean)
    {
        const target = this.settings.get(Setting.target);

        if (targetChanged || browseTargetsChanged) {
            if (targetChanged)
                this.refresh(this.currentTarget.selection?.original);

            if (browseTargetsChanged) {
                this.settings.get(Setting.browseTargets).forEach(t => this.refresh(t));
            }
        }
        this.currentTarget.selection = target ? parseTarget(target, true) : undefined;

        setContext(zmkCommand.zmkTargetSelected, !!target);
        if (targetChanged) {
            this.refresh(this.currentTarget.selection?.original);
        }
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
        if (!this.isValhallaProject) {
            return [
                {
                    kind: "notValhalla",
                    label: "Current workspace is not a Valhalla project",
                }
            ];
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
