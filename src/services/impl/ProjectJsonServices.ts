import * as vscode from "vscode";

import {
    Node as JsonNode,
    JSONPath,
} from 'jsonc-parser';

import { AppServiceContainer, AppServices } from "../AppServices";
import { JsonFileParser } from "../../components/JsonFileParser";
import { IProjectJsonServices } from "../IProjectJsonServices";

export type ProjectJsonHoverDeps = Pick<AppServices, 'context'>;

const GOTO_TARGET_COMMAND = 'zmk.projectJson.goToTargetFromDeps';

function matchJsonPath(path: JSONPath,
    ...pattern: (string | number | '*' | StringConstructor | NumberConstructor | BooleanConstructor)[]): boolean
{

    if (path.length !== pattern.length) {
        return false;
    }

    for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] === '*') {
            continue;
        }

        if (pattern[i] === String && typeof path[i] === 'string') {
            continue;
        }

        if (pattern[i] === Number && typeof path[i] === 'number') {
            continue;
        }

        if (pattern[i] === Boolean && typeof path[i] === 'boolean') {
            continue;
        }

        if (path[i] !== pattern[i]) {
            return false;
        }
    }

    return true;
}

function getNodeRange(document: vscode.TextDocument, node: JsonNode): vscode.Range
{
    const start = node.offset;
    const end = node.offset + node.length;
    return new vscode.Range(
        document.positionAt(start),
        document.positionAt(end)
    );
}

function getTargetByName(parser: JsonFileParser, targetName: string | undefined): JsonNode | undefined
{
    return targetName ? parser.getNodeByPath(['targets', targetName]) : undefined;
}

function findObjectPropertyByKey(node: JsonNode | undefined, key: string): JsonNode | undefined
{
    if (node?.type === 'property' && node.children && node.children.length === 2) {
        node = node.children[1];
    }

    if (node?.type === 'object' && node.children) {
        for (const prop of node.children) {
            if (prop.type === 'property' && prop.children && prop.children.length === 2) {
                const keyNode = prop.children[0];
                if (keyNode.type === 'string' && keyNode.value === key) {
                    return prop;
                }
            }
        }
    }

    return undefined;
}

function * enumTargets(parser: JsonFileParser): Iterable<{ name: string, node: JsonNode }>
{
    const targetsNode = parser.getNodeByPath(['targets']);
    if (targetsNode?.type === 'object' && targetsNode.children) {
        for (const targetProp of targetsNode.children) {
            if (targetProp.type === 'property' && targetProp.children && targetProp.children.length === 2) {
                const keyNode = targetProp.children[0];
                if (keyNode.type === 'string') {
                    yield { name: keyNode.value, node: targetProp };
                }
            }
        }
    }
}

function findTargetReferences(parser: JsonFileParser, targetName: string | undefined, includeDeclaration: boolean)
{
    const targets = parser.getNodeByPath(['targets']);
    if (!targets || targets.type !== 'object' || !targets.children) {
        return [];
    }

    const references: JsonNode[] = [];
    for (const target of targets.children) {
        if (target.type === 'property' && target.children && target.children.length === 2) {
            const keyNode = target.children[0];
            const valueNode = target.children[1];

            // add self to references if declaration should be included
            if (keyNode.type === 'string' && keyNode.value === targetName && includeDeclaration) {
                references.push(keyNode);
            }

            // check 'deps' array for references to the target
            else if (valueNode.type === 'object' && valueNode.children) {
                const depsNode = findObjectPropertyByKey(valueNode, 'deps');
                if (!depsNode || depsNode.type !== 'property' || !depsNode.children || depsNode.children.length !== 2) {
                    continue;
                }

                const depsValueNode = depsNode.children[1];
                if (depsValueNode.type !== 'array' || !depsValueNode.children) {
                    continue;
                }

                for (const depNode of depsValueNode.children) {
                    if (depNode.type === 'string' && depNode.value === targetName) {
                        // references.push(depNode);
                        references.push(keyNode);
                        break;
                    }
                }
            }
        }
    }

    return references;
}

class ProjectJsonServiceProvider
    implements IProjectJsonServices,
        vscode.DefinitionProvider,
        vscode.ReferenceProvider,
        vscode.CodeLensProvider
{
    public constructor(private services: ProjectJsonHoverDeps)
    {
        const { context } = services;
        context.subscriptions.push(
            vscode.languages.registerDefinitionProvider({ pattern: '**/project.json' }, this),
            vscode.languages.registerReferenceProvider({ pattern: '**/project.json' }, this),
            vscode.languages.registerCodeLensProvider({ pattern: '**/project.json' }, this),
            vscode.commands.registerCommand(GOTO_TARGET_COMMAND, (uri: vscode.Uri, position: vscode.Position) => {
                this.goToTargetFromDeps(uri, position);
            })
        );
    }

    async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.DefinitionLink[]> {
        const result: vscode.DefinitionLink[] = [];
        const parser = new JsonFileParser(document);

        const node = parser.getNodeAtPosition(position);
        if (!node || !node.node) {
            return result;
        }

        if (matchJsonPath(node.path, 'targets', String, 'deps', Number)) {
            const targetName = typeof node.value === 'string' ? node.value : undefined;
            const targetNode = getTargetByName(parser, targetName);
            if (targetNode) {
                const originRange = getNodeRange(document, node.node);
                const targetRange = getNodeRange(document, targetNode);
                result.push({
                    originSelectionRange: originRange,
                    targetUri: document.uri,
                    targetRange: targetRange
                });
            }
        }

        if (matchJsonPath(node.path, 'targets', String, 'toolchain')) {
            const toolchainName = typeof node.value === 'string' ? node.value : undefined;
            if (toolchainName) {
                const toolchainNode = parser.getNodeByPath(['toolchains', toolchainName]);
                if (toolchainNode) {
                    const originRange = getNodeRange(document, node.node);
                    const targetRange = getNodeRange(document, toolchainNode);
                    result.push({
                        originSelectionRange: originRange,
                        targetUri: document.uri,
                        targetRange: targetRange
                    });
                }
            }
        }

        return result;
    }

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.Location[]>
{
        const result: vscode.Location[] = [];
        const parser = new JsonFileParser(document);

        const node = parser.getNodeAtPosition(position);
        if (!node || !node.node) {
            return result;
        }

        if (matchJsonPath(node.path, 'targets', String)) {
            const targetName = typeof node.value === 'string' ? node.value : undefined;
            const references = findTargetReferences(parser, targetName, context.includeDeclaration);

            for (const refNode of references) {
                const refRange = getNodeRange(document, refNode);
                result.push(new vscode.Location(document.uri, refRange));
            }
        }

        if (matchJsonPath(node.path, 'targets', String, 'deps', Number)) {
            const targetName = typeof node.value === 'string' ? node.value : undefined;
            const references = findTargetReferences(parser, targetName, context.includeDeclaration);

            for (const refNode of references) {
                const refRange = getNodeRange(document, refNode);
                result.push(new vscode.Location(document.uri, refRange));
            }
        }
        return result;
    }

    onDidChangeCodeLenses?: vscode.Event<void> | undefined;
    async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[] | null | undefined> {
        const result: vscode.CodeLens[] = [];


        const addCodeLens = (node: JsonNode, command: (node: JsonNode, start: vscode.Position, end: vscode.Position) => vscode.Command) => {
            const start = document.positionAt(node.offset);
            const end = node.value && node.type === 'string' ? document.positionAt(node.offset + node.length) : null;

            if (!start || !end) {
                return;
            }
            const range = new vscode.Range(start, end);
            const codeLens = new vscode.CodeLens(range, command(node, start, end));
            result.push(codeLens);
        };

        for (const target of enumTargets(new JsonFileParser(document))) {
            const deps = findObjectPropertyByKey(target.node, 'deps');
            if (!deps || deps.type !== 'property' || !deps.children || deps.children.length !== 2) {
                continue;
            }

            const depsKeyNode = deps.children[0];
            const depsValueNode = deps.children[1];

            if (depsValueNode.children?.length === 0)
                continue;

            addCodeLens(depsKeyNode, (node, start, end) => ({
                title: "Go to target",
                command: GOTO_TARGET_COMMAND,
                arguments: [document.uri, start, end],
                // tooltip: `Go to options of target '${target.name}'`
            }));
        }

        return result;
    }

    resolveCodeLens?(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens> {
        return codeLens;
    }

    private async goToTargetFromDeps(uri: vscode.Uri, position: vscode.Position): Promise<void>
    {
        const document = await vscode.workspace.openTextDocument(uri);
        const parser = new JsonFileParser(document);

        const nodeInfo = parser.getNodeAtPosition(position);
        if (!matchJsonPath(nodeInfo.path, 'targets', String, 'deps')) {
            vscode.window.showErrorMessage('This code lens is only supported on target dependencies');
            return;
        }
        if (!nodeInfo.propertyNode?.children)
            return;

        const depsKeyNode = nodeInfo.propertyNode.children[0];
        const depsValueNode = nodeInfo.propertyNode.children[1];
        if (depsValueNode.type !== 'array' || !depsValueNode.children) {
            vscode.window.showErrorMessage('Malformed deps property. Expected an array of strings.');
            return;
        }

        const actualDeps = depsValueNode.children.map(node =>
            node.type === 'string' ? node.value : null
        ).filter((value): value is string => value !== null);

        if (!actualDeps || actualDeps.length === 0) {
            vscode.window.showInformationMessage('No dependencies found for this target.');
            return;
        }

        let dep: string | undefined;

        if (actualDeps.length === 1) {
            dep = actualDeps[0];
        }
        else {
            dep = await vscode.window.showQuickPick(actualDeps || [], {
                placeHolder: 'Select a dependency'
            });
        }

        if (!dep) {
            return;
        }

        const targetNode = parser.getNodeByPath(['targets', dep]);
        if (!targetNode) {
            vscode.window.showErrorMessage(`Target '${dep}' not found in project.json`);
            return;
        }

        const targetStart = document.positionAt(targetNode.offset);
        const targetEnd = document.positionAt(targetNode.offset + targetNode.length);
        const targetRange = new vscode.Range(targetStart, targetEnd);

        const editor = await vscode.window.showTextDocument(document);
        editor.revealRange(targetRange, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(targetStart, targetStart);
    }
}

export function createProjectJsonServiceProvider(services: AppServiceContainer): IProjectJsonServices
{
    return new ProjectJsonServiceProvider({
        context: services.get('context'),
    });
}
