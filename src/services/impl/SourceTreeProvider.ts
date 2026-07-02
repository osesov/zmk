import * as vscode from "vscode";
import { ParsedTarget, parseTarget } from "../../components/parseTarget";
import { AppServiceContainer, AppServices } from "../AppServices";
import {
    ProjectJsonLinkUnitType,
    ProjectJsonTarget,
    ProjectJsonTargetSet,
} from "../../components/ProjectInfo";
import { ISettingsService, Setting } from "../ISettingsService";
import { IProjectInfoService } from "../IProjectInfoService";
import { ISourceTreeProvider } from "../ISourceTreeProvider";

const sourceTreeCommand = {
    openTarget: "zmk.sourceTree.openTarget",
    openSource: "zmk.sourceTree.openSource",
    revealSourceInExplorer: "zmk.sourceTree.revealSourceInExplorer",
    revealSourceInOS: "zmk.sourceTree.revealSourceInOS",
} as const;

const REAL_TARGET_TYPES: ReadonlySet<ProjectJsonLinkUnitType | "source_set"> = new Set([
    "source_set",
    "shared_library",
    "static_library",
    "executable",
]);

function isRealTargetType(targetType: ProjectJsonTarget["type"]): targetType is ProjectJsonLinkUnitType | "source_set" {
    return REAL_TARGET_TYPES.has(targetType as ProjectJsonLinkUnitType | "source_set");
}

interface TargetGroupNode {
    kind: "group";
    label: string;
    prefix: string[] | undefined;
    parent: TargetGroupNode | undefined;
    children: Map<string, TargetGroupNode>;
    targets: TargetLeafNode[];
}

interface SourceTreeContainer {
    children: Map<string, SourceGroupNode>;
    files: SourceFileNode[];
}

interface SourceTreeRoot extends SourceTreeContainer {}

interface TargetLeafNode {
    kind: "target";
    label: string;
    fullTarget: string;
    parent: TargetGroupNode | undefined;
    targetType: ProjectJsonTarget["type"];
    targetData: ProjectJsonTarget;
    parsedTarget: ParsedTarget;
    sourceTree: SourceTreeRoot;
}

interface SourceGroupNode extends SourceTreeContainer {
    kind: "sourceGroup";
    label: string;
    parent: TargetLeafNode | SourceGroupNode;
}

interface SourceFileNode {
    kind: "sourceFile";
    label: string;
    fullPath: string;
    parent: TargetLeafNode | SourceGroupNode;
}

interface NotValhallaProjectNode {
    kind: "notValhalla";
    label: string;
}

type TargetNode = TargetGroupNode | TargetLeafNode | SourceGroupNode | SourceFileNode | NotValhallaProjectNode;

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

function createSourceRoot(): SourceTreeRoot {
    return {
        children: new Map(),
        files: [],
    };
}

function normalizePathParts(path: string): string[] {
    return path
        .replace(/\\/g, "/")
        .replace(/^\/\//, "")
        .split("/")
        .filter(part => part.length > 0);
}

function stripTargetPrefix(pathParts: string[], targetPathParts: string[]): string[] {
    let commonPrefixLength = 0;
    while (
        commonPrefixLength < pathParts.length
        && commonPrefixLength < targetPathParts.length
        && pathParts[commonPrefixLength] === targetPathParts[commonPrefixLength]
    ) {
        commonPrefixLength++;
    }

    const stripped = pathParts.slice(commonPrefixLength);
    return stripped.length > 0 ? stripped : pathParts;
}

function buildSourceTree(targetNode: TargetLeafNode): SourceTreeRoot {
    const sourceTree = createSourceRoot();
    const targetPathParts = targetNode.parsedTarget.pathParts;
    const rawSources = targetNode.targetData.sources;

    if (!Array.isArray(rawSources)) {
        return sourceTree;
    }

    for (const source of rawSources) {
        if (typeof source !== "string") {
            continue;
        }

        const normalizedParts = normalizePathParts(source);
        if (normalizedParts.length === 0) {
            continue;
        }

        const relativeParts = stripTargetPrefix(normalizedParts, targetPathParts);
        const fileName = relativeParts.at(-1);
        if (!fileName) {
            continue;
        }

        const folderParts = relativeParts.slice(0, -1);

        let container: SourceTreeContainer = sourceTree;
        let parent: TargetLeafNode | SourceGroupNode = targetNode;

        for (const folderPart of folderParts) {
            let nextGroup = container.children.get(folderPart);
            if (!nextGroup) {
                nextGroup = {
                    kind: "sourceGroup",
                    label: folderPart,
                    parent,
                    children: new Map(),
                    files: [],
                };
                container.children.set(folderPart, nextGroup);
            }

            container = nextGroup;
            parent = nextGroup;
        }

        container.files.push({
            kind: "sourceFile",
            label: fileName,
            fullPath: source,
            parent,
        });
    }

    return sourceTree;
}

export function buildTargetTree(targets: ProjectJsonTargetSet, nodeMap: Map<string, TargetLeafNode>): TargetGroupNode {
    const root = createGroup("root", undefined, undefined);

    for (const [name, target] of Object.entries(targets)) {
        if (!isRealTargetType(target.type)) {
            continue;
        }

        const parsed = parseTarget(name, false);
        if (!parsed) {
            continue;
        }

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
            targetData: target,
            parsedTarget: parsed,
            sourceTree: createSourceRoot(),
        };

        leafNode.sourceTree = buildSourceTree(leafNode);

        current.targets.push(leafNode);
        nodeMap.set(name, leafNode);
    }

    return root;
}

export class SourceTreeItem extends vscode.TreeItem {
    constructor(public readonly node: TargetNode) {
        super(
            node.label,
            node.kind === "group"
            || node.kind === "target"
            || node.kind === "sourceGroup"
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );

        if (node.kind === "group") {
            this.iconPath = new vscode.ThemeIcon("folder");
            this.contextValue = "sourceTree.group";
            return;
        }

        if (node.kind === "target") {
            this.iconPath = new vscode.ThemeIcon("symbol-interface");
            this.contextValue = "sourceTree.target";
            this.description = `[${node.targetType}] ${node.fullTarget}`;
            this.command = {
                command: sourceTreeCommand.openTarget,
                title: "Open BUILD.gn",
                arguments: [node],
            };
            this.tooltip = new vscode.MarkdownString()
                .appendMarkdown(`- **Type**: \`${node.targetType}\`\n`)
                .appendMarkdown(`- **Target**: \`${node.fullTarget}\``);
            return;
        }

        if (node.kind === "sourceGroup") {
            this.iconPath = new vscode.ThemeIcon("folder-library");
            this.contextValue = "sourceTree.sourceGroup";
            return;
        }

        if (node.kind === "sourceFile") {
            this.iconPath = new vscode.ThemeIcon("file-code");
            this.contextValue = "sourceTree.sourceFile";
            this.description = node.fullPath;
            this.tooltip = node.fullPath;
            this.command = {
                command: sourceTreeCommand.openSource,
                title: "Open source file",
                arguments: [node],
            };
            return;
        }

        this.contextValue = "notValhalla";
        this.iconPath = new vscode.ThemeIcon("warning");
    }
}

type SourceTreeProviderDeps = Pick<AppServices, "context" | "settings" | "projectInfo">;

export function createSourceTreeProvider(services: AppServiceContainer): SourceTreeProvider {
    return new SourceTreeProvider({
        context: services.get("context"),
        settings: services.get("settings"),
        projectInfo: services.get("projectInfo"),
    });
}

export class SourceTreeProvider implements vscode.TreeDataProvider<TargetNode>, ISourceTreeProvider {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TargetNode | undefined | void>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly projectInfo: IProjectInfoService;
    private readonly settings: ISettingsService;

    private root: TargetGroupNode = createGroup("root", undefined, undefined);
    private isValhallaProject = false;
    private nodeMap = new Map<string, TargetLeafNode>();
    private treeView: vscode.TreeView<TargetNode>;

    constructor(deps: SourceTreeProviderDeps) {
        const context = deps.context;
        this.settings = deps.settings;
        this.projectInfo = deps.projectInfo;

        this.treeView = vscode.window.createTreeView("sourceTreeView", { treeDataProvider: this });
        context.subscriptions.push(this.treeView);

        context.subscriptions.push(vscode.commands.registerCommand(sourceTreeCommand.openTarget,
            async (node: TargetLeafNode) => {
                if (node.kind !== "target") {
                    return;
                }

                const parts = parseTarget(node.fullTarget, false);
                const valhallaFolder = this.settings.get(Setting.valhallaFolder);
                if (!parts || !valhallaFolder) {
                    return;
                }

                const targetFile = vscode.Uri.joinPath(valhallaFolder, ...parts.pathParts, "BUILD.gn");
                try {
                    const document = await vscode.workspace.openTextDocument(targetFile);
                    await vscode.window.showTextDocument(document);
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to open target file: ${e instanceof Error ? e.message : String(e)}`);
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(sourceTreeCommand.openSource,
            async (node: SourceFileNode) => {
                if (node.kind !== "sourceFile") {
                    return;
                }

                const valhallaFolder = this.settings.get(Setting.valhallaFolder);
                if (!valhallaFolder) {
                    return;
                }

                const sourceFile = vscode.Uri.joinPath(valhallaFolder, node.fullPath);
                try {
                    const document = await vscode.workspace.openTextDocument(sourceFile);
                    await vscode.window.showTextDocument(document);
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to open source file: ${e instanceof Error ? e.message : String(e)}`);
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(sourceTreeCommand.revealSourceInExplorer,
            async (node: SourceFileNode) => {
                if (node.kind !== "sourceFile") {
                    return;
                }

                const valhallaFolder = this.settings.get(Setting.valhallaFolder);
                if (!valhallaFolder) {
                    return;
                }

                const sourceFile = vscode.Uri.joinPath(valhallaFolder, node.fullPath);
                try {
                    await vscode.commands.executeCommand("revealInExplorer", sourceFile);
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to reveal source file in explorer: ${e instanceof Error ? e.message : String(e)}`);
                }
            },
        ));

        context.subscriptions.push(vscode.commands.registerCommand(sourceTreeCommand.revealSourceInOS,
            async (node: SourceFileNode) => {
                if (node.kind !== "sourceFile") {
                    return;
                }

                const valhallaFolder = this.settings.get(Setting.valhallaFolder);
                if (!valhallaFolder) {
                    return;
                }

                const sourceFile = vscode.Uri.joinPath(valhallaFolder, node.fullPath);
                try {
                    await vscode.commands.executeCommand("revealFileInOS", sourceFile);
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to reveal source file in OS: ${e instanceof Error ? e.message : String(e)}`);
                }
            },
        ));

        context.subscriptions.push(this.projectInfo.onChange(() => this.updateTargets(true)));
        context.subscriptions.push(this.settings.onChange(e => {
            if (e.affects(Setting.isValhallaProject)) {
                this.updateIsValhallaProject(true);
            }
        }));

        this.updateTargets(false);
        this.updateIsValhallaProject(false);
    }

    private updateIsValhallaProject(refreshTree: boolean): void {
        this.isValhallaProject = this.settings.get(Setting.isValhallaProject);
        if (refreshTree) {
            this.refresh();
        }
    }

    private updateTargets(refreshTree: boolean): void {
        const projectDescription = this.projectInfo.getProjectDescription();
        this.nodeMap.clear();
        this.root = buildTargetTree(projectDescription?.targets ?? {}, this.nodeMap);

        if (refreshTree) {
            this.refresh();
        }
    }

    public refresh(node?: TargetNode | string): void {
        if (typeof node === "string") {
            node = this.nodeMap.get(node);
        }
        this._onDidChangeTreeData.fire(node);
    }

    public getTreeItem(element: TargetNode): vscode.TreeItem {
        return new SourceTreeItem(element);
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
        if (element.kind === "sourceGroup") {
            return element.parent;
        }
        if (element.kind === "sourceFile") {
            return element.parent;
        }
        return undefined;
    }

    public async getChildren(element?: TargetNode): Promise<TargetNode[]> {
        if (!this.isValhallaProject) {
            return [{
                kind: "notValhalla",
                label: "Current workspace is not a Valhalla project",
            }];
        }

        if (!element) {
            return this.getSortedTargetChildren(this.root);
        }

        if (element.kind === "group") {
            return this.getSortedTargetChildren(element);
        }

        if (element.kind === "target") {
            return this.getSortedSourceChildren(element.sourceTree);
        }

        if (element.kind === "sourceGroup") {
            return this.getSortedSourceChildren(element);
        }

        return [];
    }

    private getSortedTargetChildren(group: TargetGroupNode): TargetNode[] {
        const groups = [...group.children.values()].sort((a, b) => a.label.localeCompare(b.label));
        const targets = [...group.targets].sort((a, b) => a.label.localeCompare(b.label));
        return [...groups, ...targets];
    }

    private getSortedSourceChildren(container: SourceTreeContainer): TargetNode[] {
        const groups = [...container.children.values()].sort((a, b) => a.label.localeCompare(b.label));
        const files = [...container.files].sort((a, b) => a.label.localeCompare(b.label));
        return [...groups, ...files];
    }
}
