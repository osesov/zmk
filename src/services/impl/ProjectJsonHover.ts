import * as vscode from "vscode";

import {
    Node as JsonNode,
} from 'jsonc-parser';


import { IProjectJsonHover } from "../IProjectJsonHover";
import { AppServiceContainer, AppServices } from "../AppServices";
import { JsonFileParser, JsonNodeInfo } from "../../components/JsonFileParser";

export type ProjectJsonHoverDeps = Pick<AppServices, 'context'>;

export class ProjectJsonHover implements IProjectJsonHover, vscode.HoverProvider
{
    public constructor(private services: ProjectJsonHoverDeps)
    {
        vscode.languages.registerHoverProvider({ pattern: '**/project.json' }, this);
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        const parser = new JsonFileParser(document);
        const nodeInfo = parser.getNodeAtPosition(position);

        if (!nodeInfo.node) {
            return null;
        }

        const hint = this.getNodeText(nodeInfo);

        return new vscode.Hover([
            `JSON path: \`${nodeInfo.path.join('.')}\``,
            `Node type: \`${this.getNodeType(nodeInfo.propertyNode ?? nodeInfo.node)}\``,
            ... hint ? [hint] : [],
            // '*' + (nodeInfo.isAtPropertyKey ? `At property key` : `At value`) + '*',
        ]);
    }

    private getNodeType(node: JsonNode | undefined): string
    {
        if (!node) {
            return 'unknown';
        }

        switch (node.type) {
        case 'property':
            if (node.children?.[1].type)
                return this.getNodeType(node.children[1]);
            break;
        case 'array':
            return `array[${node.children?.length ?? 0}]`;

        case 'object':
            return `object{${node.children?.length ?? 0} properties}`;
        }
        return node.type;
    }

    private getNodeValue(node: JsonNode | undefined, allowDepth: boolean = true): vscode.MarkdownString | null
    {
        if (!node) {
            return null;
        }

        const result = new vscode.MarkdownString();

        result.supportHtml = true;

        switch (node.type) {
        case 'string':
        case 'number':
        case 'boolean':
        case 'null':
            result.appendMarkdown(`\`${node.value}\``);
            break;

        case 'array':
            if (!allowDepth) {
                result.appendText(`...array[${node.children?.length ?? 0}]`);
            }
            else if (node.children) {
                const pad = Math.max(2, String(node.children.length - 1).length);
                result.appendMarkdown('<table><thead>');
                result.appendMarkdown(`<tr><th>Index</th><th>Value</th></tr>`);
                result.appendMarkdown('</thead><tbody>');
                node.children.forEach( (item, index) => {
                    const val = this.getNodeValue(item, false)?.value ?? '';
                    result.appendMarkdown(`<tr><td>${String(index).padStart(pad, '0')}</td><td>${val}</td></tr>`);
                });

                result.appendMarkdown('</tbody></table>');
            }
            else {
                result.appendText(`[]`);
            }
            break;

        case 'object':
            if (!allowDepth) {
                result.appendText(`...object{${node.children?.length ?? 0} properties}`);
            }
            else if (node.children) {
                for (const prop of node.children ?? []) {
                    if (prop.type === 'property' && prop.children?.[0] && prop.children?.[1]) {
                        const key = prop.children[0].value;
                        const value = this.getNodeValue(prop.children[1], false)?.value ?? '';
                        result.appendMarkdown(`- \`${key}\`: ${value}\n`);
                    }
                }
            }
            else {
                result.appendText(`{}`);
            }
            break;

        case 'property':
            result.appendMarkdown(`\`${node.children?.[0].value}\`: ${this.getNodeValue(node.children?.[1], false)?.value ?? ''}`);
            break;
        }
        return result;
    }

    private getNodeText(nodeInfo: JsonNodeInfo): vscode.MarkdownString | null
    {
        return this.getNodeValue(nodeInfo.propertyNode?.children?.[1]);
    }
}

export function createProjectJsonHover(services: AppServiceContainer): IProjectJsonHover
{
    return new ProjectJsonHover({
        context: services.get('context'),
    });
}
