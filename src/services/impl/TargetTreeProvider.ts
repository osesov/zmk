import * as vscode from "vscode";
import { ITargetTreeProvider } from "../ITargetTreeProvider";
import { ParsedTarget, parseTarget } from "../../components/parseTarget";
import { AppServiceContainer, AppServices } from "../AppServices";
import { zmkCommand } from "../../components/constants";
import { ISettingsService, Setting } from "../ISettingsService";
import { assertNever, setContext, writeTextToClipboard } from "../../components/utils";
import { BrowseableType, IBrowseSet, IProjectInfoService } from "../IProjectInfoService";
import { ProjectJsonTarget, ProjectJsonTargetSet } from "../../components/ProjectInfo";
import { fuzzyMatchScore } from "../../components/fuzzyMatchScore";

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
    targetData: ProjectJsonTarget | undefined;
}

interface PropertyGroupNode {
    kind: "propertyGroup";
    label: string;          // e.g., "deps", "sources", "include_dirs"
    propertyName: keyof ProjectJsonTarget;
    parent: TargetLeafNode;
    values: unknown;
}

interface PropertyItemNode {
    kind: "propertyItem";
    label: string;          // the actual value (e.g., a target name, file path)
    propertyName: keyof ProjectJsonTarget;
    value: string;
    parent: PropertyGroupNode;
    targetData?: ProjectJsonTarget; // for deps that can be expanded
}

interface NotValhallaProjectNode {
    kind: "notValhalla";
    label: string;
}

type TargetNode = TargetGroupNode | TargetLeafNode | PropertyGroupNode | PropertyItemNode | NotValhallaProjectNode;

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

namespace labels
{
    export const non_browseable = '';
    export const explicitly_browseable = ' ◼';
    export const implicitly_browseable = ' ◻';
    export const potentially_browseable = ' ⛶';
    // export const non_browseable = '';
    // export const explicitly_browseable = ' ●';
    // export const implicitly_browseable = ' ◐';
    // export const potentially_browseable = ' ◌';
}

export function getLabelForTarget(node: TargetNode, currentTarget: CurrentTarget): string
{
    switch (node.kind) {
        case "group":
            return node.label;
        case "target":
            const browseType = currentTarget.browseSet?.isBrowseable(node.fullTarget) ?? BrowseableType.NON_BROWSEABLE;
            switch (browseType) {
            case BrowseableType.EXPLICITLY:
                return `${node.label}${labels.explicitly_browseable}`;
            case BrowseableType.IMPLICITLY:
                return `${node.label}${labels.implicitly_browseable}`;
            case BrowseableType.POTENTIALLY:
                return `${node.label}${labels.potentially_browseable}`;
            case BrowseableType.NON_BROWSEABLE:
                return `${node.label}${labels.non_browseable}`;
            default:
                assertNever(browseType);
                return node.label;
            }
        case "propertyGroup":
            return node.label;
        case "propertyItem":
            return node.label;
        case "notValhalla":
            return node.label;
        default:
            assertNever(node);
    }

}

export class TargetTreeItem extends vscode.TreeItem {
    constructor(
        public readonly node: TargetNode,
        currentTarget: CurrentTarget,
    ) {
        super(
            getLabelForTarget(node, currentTarget),
            node.kind === "group"
                ? vscode.TreeItemCollapsibleState.Collapsed
                : node.kind === "target"
                ? vscode.TreeItemCollapsibleState.Collapsed
                : node.kind === "propertyGroup"
                ? vscode.TreeItemCollapsibleState.Collapsed
                : node.kind === "propertyItem" && node.propertyName === "deps" && node.targetData
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
            // else if (inBrowseSet === BrowseableType.EXPLICITLY)
            //     this.iconPath = new vscode.ThemeIcon('diff-added');
            // else if (inBrowseSet === BrowseableType.IMPLICITLY)
            //     this.iconPath = new vscode.ThemeIcon('diff-modified');
            else
                this.iconPath = new vscode.ThemeIcon('star-empty');

            this.contextValue = contextParts.join(".");
            this.description = `[${node.targetType}] ${node.fullTarget}`;
            this.tooltip = new vscode.MarkdownString()
            .appendMarkdown(`- **Type**: \`${node.targetType}\`\n`)
            .appendMarkdown(`- **Target**: \`${node.fullTarget}\`\n`)
            .appendMarkdown('\n')
            .appendMarkdown('---\n\n')
            .appendMarkdown(`**Legend:**\n\n`)
            .appendMarkdown(`- ${labels.explicitly_browseable} -- Added to browse set\n`)
            .appendMarkdown(`- ${labels.implicitly_browseable} -- Implicitly added to browse set\n`)
            .appendMarkdown(`- ${labels.potentially_browseable} -- Potentially browseable\n`)
            .appendMarkdown(`- ${labels.non_browseable || '&lt;empty&gt;'} -- Not browseable\n`)
            ;

        } else if (node.kind === "propertyGroup") {
            this.iconPath = new vscode.ThemeIcon('symbol-property');
            this.contextValue = "propertyGroup";
            const count = Array.isArray(node.values) ? node.values.length : 0;
            this.description = `[${count}]`;
        } else if (node.kind === "propertyItem") {
            if (node.parent.label === "reverse_deps") {
                this.iconPath = new vscode.ThemeIcon('references');
                this.contextValue = "propertyItem.reverse_deps";
                this.command = undefined; // No default action, use context menu
            } else if (node.propertyName === "deps") {
                this.iconPath = new vscode.ThemeIcon('references');
                this.contextValue = "propertyItem.deps";
                this.command = undefined; // No default action, use context menu
            } else if (node.propertyName === "sources") {
                this.iconPath = new vscode.ThemeIcon('file-code');
                this.contextValue = "propertyItem.sources";
            } else if (node.propertyName === "include_dirs") {
                this.iconPath = new vscode.ThemeIcon('folder-library');
                this.contextValue = "propertyItem.include_dirs";
            } else {
                this.iconPath = new vscode.ThemeIcon('symbol-string');
                this.contextValue = "propertyItem";
            }
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
            targetType: target.type,
            targetData: target
        };
        current.targets.push(leafNode);
        nodeMap.set(name, leafNode);
    }

    return root;
}

type TargetTreeProviderDeps = Pick<AppServices, 'context' | 'settings' | 'projectInfo' | 'builder'>;

export function createTargetTreeProvider(services: AppServiceContainer): TargetTreeProvider
{
    return new TargetTreeProvider({
        context: services.get('context'),
        settings: services.get('settings'),
        projectInfo: services.get('projectInfo'),
        builder: services.get('builder'),
    });
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
    private treeView: vscode.TreeView<TargetNode>;
    private readonly builder: AppServices['builder'];

    constructor(deps: TargetTreeProviderDeps)
    {
        const context = deps.context;
        this.settings = deps.settings;
        this.projectInfo = deps.projectInfo;
        this.builder = deps.builder;

        this.treeView = vscode.window.createTreeView("targetTreeView", { treeDataProvider: this });
        context.subscriptions.push(this.treeView);
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
                await this.builder.buildTarget(node.fullTarget);
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

        // New commands for property items
        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkGoToTargetDep,
            async (node: PropertyItemNode) => {
                if (node.propertyName === "deps" || node.parent.label === "reverse_deps") {
                    // Find the target node in the tree and reveal it
                    const targetNode = this.nodeMap.get(node.value);
                    if (targetNode) {
                        // Set it as the current target (optional)
                        // await this.settings.update(Setting.target, node.value);
                        // Or just reveal it in the tree
                        await vscode.commands.executeCommand('targetTreeView.focus');
                        await this.treeView.reveal(targetNode, {
                            select: true,
                            focus: true,
                            expand: false
                        });
                    } else {
                        vscode.window.showWarningMessage(`Target ${node.value} not found in the tree.`);
                    }
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkOpenSourceFile,
            async (node: PropertyItemNode) => {
                if (node.propertyName === "sources") {
                    const valhallaFolder = this.settings.get(Setting.valhallaFolder);
                    if (!valhallaFolder)
                        return;

                    // node.value is a relative path from the valhalla folder
                    const filePath = vscode.Uri.joinPath(valhallaFolder, node.value);
                    try {
                        const document = await vscode.workspace.openTextDocument(filePath);
                        await vscode.window.showTextDocument(document);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to open source file: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkOpenIncludeDirFolder,
            async (node: PropertyItemNode) => {
                if (node.propertyName === "include_dirs") {
                    const valhallaFolder = this.settings.get(Setting.valhallaFolder);
                    if (!valhallaFolder)
                        return;

                    const dirPath = vscode.Uri.joinPath(valhallaFolder, node.value);
                    try {
                        await vscode.commands.executeCommand('revealFileInOS', dirPath);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to reveal directory: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkRevealIncludeDirInExplorer,
            async (node: PropertyItemNode) => {
                if (node.propertyName === "include_dirs") {
                    const valhallaFolder = this.settings.get(Setting.valhallaFolder);
                    if (!valhallaFolder)
                        return;

                    const dirPath = vscode.Uri.joinPath(valhallaFolder, node.value);
                    try {
                        await vscode.commands.executeCommand('revealInExplorer', dirPath);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to open directory: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            },
        ));

        // Copy commands for properties
        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkCopyPropertyValue,
            async (node: PropertyItemNode | PropertyGroupNode) => {
                try {
                    let textToCopy: string;

                    if (node.kind === "propertyItem") {
                        // For leaf nodes, copy the scalar value
                        textToCopy = node.value;
                    } else if (node.kind === "propertyGroup") {
                        // For property groups, copy the JSON array/object from original data
                        textToCopy = JSON.stringify(node.values, null, 2);
                    } else {
                        return;
                    }

                    await writeTextToClipboard(textToCopy);
                    vscode.window.setStatusBarMessage(`Copied to clipboard`, 2000);
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to copy: ${e instanceof Error ? e.message : String(e)}`);
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkCopyTargetData,
            async (node: TargetLeafNode) => {
                if (node.kind === "target" && node.targetData) {
                    try {
                        const textToCopy = JSON.stringify(node.targetData, null, 2);
                        await writeTextToClipboard(textToCopy);
                        vscode.window.setStatusBarMessage(`Copied target data to clipboard`, 2000);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to copy: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(zmkCommand.zmkFindTarget,
            async () => {
                const input = await vscode.window.showInputBox({
                    prompt: "Enter target name to find",
                    placeHolder: "e.g., //path/to:target",
                });

                if (!input) {
                    return;
                }

                const targetNode = this.findBestMatchingTarget(input);
                if (targetNode) {
                    try {
                        await vscode.commands.executeCommand('targetTreeView.focus');
                        await this.treeView.reveal(targetNode, {
                            select: true,
                            focus: true,
                            expand: false
                        });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to reveal target: ${e instanceof Error ? e.message : String(e)}`);
                    }
                } else {
                    vscode.window.showWarningMessage(`No matching target found for: ${input}`);
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

    public getParent(element: TargetNode): TargetNode | undefined {
        if (element.kind === "notValhalla") {
            return undefined;
        }
        if (element.kind === "group") {
            return element.parent;
        }
        if (element.kind === "target") {
            return element.parent;
        }
        if (element.kind === "propertyGroup") {
            return element.parent;
        }
        if (element.kind === "propertyItem") {
            return element.parent;
        }
        return undefined;
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

        if (element.kind === "target") {
            return Promise.resolve(this.getTargetProperties(element));
        }

        if (element.kind === "propertyGroup") {
            return Promise.resolve(this.getPropertyItems(element));
        }

        if (element.kind === "propertyItem" && element.propertyName === "deps" && element.targetData) {
            // Allow recursive expansion of deps
            return Promise.resolve(this.getTargetProperties({
                kind: "target",
                fullTarget: element.value,
                label: element.label,
                parent: undefined,
                targetType: element.targetData.type,
                targetData: element.targetData
            }));
        }

        return Promise.resolve([]);
    }

    private getSortedChildren(group: TargetGroupNode): TargetNode[] {
        const groups = [...group.children.values()].sort((a, b) => a.label.localeCompare(b.label));
        const targets = [...group.targets].sort((a, b) => a.label.localeCompare(b.label));
        return [...groups, ...targets];
    }

    private getTargetProperties(target: TargetLeafNode): PropertyGroupNode[] {
        if (!target.targetData) {
            return [];
        }

        const properties: PropertyGroupNode[] = [];
        const data = target.targetData;

        // Define which properties to show and in what order
        const propertiesToShow: Array<keyof ProjectJsonTarget> = [
            'deps', 'sources', 'include_dirs', 'defines', 'cflags', 'cflags_cc',
            'ldflags', 'lib_dirs', 'libs', 'inputs', 'outputs', 'configs',
            'public_configs', 'visibility'
        ];

        for (const propName of propertiesToShow) {
            const value = data[propName];
            if (value !== undefined && (Array.isArray(value) ? value.length > 0 : true)) {
                properties.push({
                    kind: "propertyGroup",
                    label: propName,
                    propertyName: propName,
                    parent: target,
                    values: value
                });
            }
        }

        // Add reverse dependencies (which targets depend on this target)
        const reverseDeps = this.projectInfo.getReverseDependencies(target.fullTarget);
        if (reverseDeps && reverseDeps.length > 0) {
            properties.unshift({
                kind: "propertyGroup",
                label: "reverse_deps",
                propertyName: "deps" as keyof ProjectJsonTarget, // Reuse deps behavior
                parent: target,
                values: reverseDeps
            });
        }

        return properties;
    }

    private getPropertyItems(group: PropertyGroupNode): PropertyItemNode[] {
        const items: PropertyItemNode[] = [];
        const values = group.values;

        if (Array.isArray(values)) {
            for (const value of values) {
                if (typeof value === 'string') {
                    const item: PropertyItemNode = {
                        kind: "propertyItem",
                        label: value,
                        propertyName: group.propertyName,
                        value: value,
                        parent: group
                    };

                    // For deps and reverse_deps, check if we can find the target data for recursive expansion
                    if (group.propertyName === "deps" || group.label === "reverse_deps") {
                        const projectDescription = this.projectInfo.getProjectDescription();
                        if (projectDescription?.targets) {
                            item.targetData = projectDescription.targets[value];
                        }
                    }

                    items.push(item);
                }
            }
        }

        return items;
    }

    private findBestMatchingTarget(searchTerm: string): TargetLeafNode | undefined {
        const allTargets = Array.from(this.nodeMap.values());

        if (allTargets.length === 0) {
            return undefined;
        }

        // Strategy 1: Exact match
        const exactMatch = allTargets.find(t => t.fullTarget === searchTerm);
        if (exactMatch) {
            return exactMatch;
        }

        // Strategy 2: Case-insensitive exact match
        const lowerSearch = searchTerm.toLowerCase();
        const caseInsensitiveMatch = allTargets.find(t => t.fullTarget.toLowerCase() === lowerSearch);
        if (caseInsensitiveMatch) {
            return caseInsensitiveMatch;
        }

        // Strategy 3: Contains match (substring)
        const containsMatch = allTargets.find(t => t.fullTarget.includes(searchTerm));
        if (containsMatch) {
            return containsMatch;
        }

        // Strategy 4: Case-insensitive contains match
        const caseInsensitiveContains = allTargets.find(t => t.fullTarget.toLowerCase().includes(lowerSearch));
        if (caseInsensitiveContains) {
            return caseInsensitiveContains;
        }

        // Strategy 5: Fuzzy match - score all targets and return best match
        const scoredTargets = allTargets.map(target => ({
            target,
            score: fuzzyMatchScore(searchTerm.toLowerCase(), target.fullTarget.toLowerCase())
        })).filter(item => item.score > 0);

        if (scoredTargets.length === 0) {
            return undefined;
        }

        // Return the target with highest score
        scoredTargets.sort((a, b) => b.score - a.score);
        return scoredTargets[0].target;
    }


}
