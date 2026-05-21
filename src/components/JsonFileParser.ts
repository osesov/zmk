import * as vscode from 'vscode';
import {
    parseTree,
    findNodeAtOffset,
    getLocation,
    getNodePath,
    getNodeValue,
    Node as JsonNode,
    ParseError,
    JSONPath,
    findNodeAtLocation
} from 'jsonc-parser';

export interface JsonNodeInfo
{
    node: JsonNode | undefined;
    path: (string | number)[];
    value: unknown;
    isAtPropertyKey: boolean;
    propertyNode: JsonNode | undefined; // if the node is a property or value, this is the property node. Otherwise undefined.
}

function propertyNodeOf(node: JsonNode | undefined): JsonNode | undefined {
    if (!node) {
        return undefined;
    }

    if (node.type === 'property') {
        return node;
    }

    if (node.parent?.type === 'property') {
        return node.parent;
    }

    return undefined;
}

export class JsonFileParser
{
    private text: string;
    private root: JsonNode | undefined;
    private errors: ParseError[] = [];

    constructor(private document: vscode.TextDocument)
    {
        this.text = this.document.getText();
        this.root = parseTree(this.text, this.errors, {
            allowTrailingComma: true,
            disallowComments: false,
            allowEmptyContent: true
        });

    }

    getRoot(): JsonNode | undefined
    {
        return this.root;
    }

    getNodeAtPosition(position: vscode.Position): JsonNodeInfo
    {
        const offset = this.document.offsetAt(position);
        const location = getLocation(this.text, offset);

        if (!this.root) {
            return {
                node: undefined,
                path: location.path,
                value: undefined,
                isAtPropertyKey: location.isAtPropertyKey,
                propertyNode: undefined
            };
        }

        const node = findNodeAtOffset(this.root, offset, true);

        return {
            node,
            path: node ? getNodePath(node) : location.path,
            value: node ? getNodeValue(node) : undefined,
            isAtPropertyKey: location.isAtPropertyKey,
            propertyNode: propertyNodeOf(node)
        };
    }

    getNodeByPath(jsonPath: JSONPath): JsonNode | undefined
    {
        if (!this.root) {
            return undefined;
        }

        return findNodeAtLocation(this.root, jsonPath);
    }
}
