import vscode from 'vscode';
import fs from 'fs';
import path from 'path';

export type Mutable<T> = {
    -readonly [K in keyof T]: T[K];
};

export function getWorkspaceRoot(): string | undefined {
    if (vscode.workspace.workspaceFolders === undefined || vscode.workspace.workspaceFolders.length === 0)
    {
        return undefined;
    }

    // use the first opened workspace
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
}

export function exists(file: string): boolean {
    return fs.existsSync(file);
}

export function findProjectRoot(p: string) : string | undefined {
    while(true) {
        const file = path.resolve(p, ".gn");

        if (exists(file)) {
            return p;
        }

        const n = path.dirname(p);

        if (p === n) {
            return undefined;
        } else {
            p = n;
        }
    }
}

export function hasWorkspace(): boolean {
    try {
        findProjectRootInWorkspace();
        return true
    } catch(e: unknown) {
        return false;
    }
}


export function findProjectRootInWorkspace() : string {
    const configuration = vscode.workspace.getConfiguration();

    const workspaceRoot = getWorkspaceRoot();

    if (workspaceRoot === undefined) {
        throw Error("no workspaceRoot");
    }

    const valhallaRoot = findProjectRoot(workspaceRoot);

    if (valhallaRoot === undefined) {
        throw Error("no valhalla root found in workspace");
    }

    return valhallaRoot;
}

export function isDevContainerHost(): boolean {
    return vscode.env.remoteName === 'dev-container';
}


export function isNotEmpty<T>(e : T | undefined ): e is T
{
    return e !== undefined;
}

export function extractPart(str: string, start: number, separator = '-'): string
{
    const parts = str.split(separator);
    if (start < 0)
        start = parts.length + start;
    return parts.slice(start, start + 1).join(separator);
}

export function stripParts(array: string[], strip: number, separator='-'): string[]
{
    return Array.from(new Set(array.map( e => {
        const parts = e.split(separator);
        if (parts.length <= strip)
            return e
        return parts.slice(strip).join(separator);
    })));
}

export function extractRange(str: string, start: number, end: number, separator = '-'): string
{
    const parts = str.split(separator);
    if (start < 0)
        start = parts.length + start;
    if (end < 0)
        end = parts.length + end;
    return parts.slice(start, end).join(separator);
}

export function groupBy<T>(array: T[], key: (item: T) => string): { [k: string]: T[] }
{
    const result: { [k: string]: T[] } = {};

    for (const item of array) {
        const k = key(item);
        if (!result[k]) {
            result[k] = [];
        }
        result[k].push(item);
    }
    return result;
}

// export function groupBy(array: string[], index: number, options ?: {
//     separator?: string,
//     default?: string,
//     strip?: boolean,
// }): { [k: string]: string[] }
// {
//     const separator = options?.separator ?? '-';
//     const defaultValue = options?.default ?? 'default';
//     const strip = options?.strip ?? false;
//     const result: { [k: string]: string[] } = {};

//     for (const item of array) {
//         const parts = item.split(separator);
//         const i = index < 0 ? parts.length + index : index;
//         const key = parts.length > i ? parts[i] : defaultValue;

//         if (!result[key]) {
//             result[key] = [];
//         }

//         if (strip)
//             parts.splice(i, 1);

//         result[key].push(parts.join(separator));
//     }

//     return result;
// }

// export function stripRange(array: string[], start: number, end: number, separator: string = '-'): string[]
// {
//     return Array.from(new Set(array.map(item => {
//         const parts = item.split(separator);
//         if (parts.length > end) {
//             parts.splice(start, end - start + 1);
//             return parts.join(separator);
//         }
//         return item;
//     })).keys());
// }

export function callDebugger(msg: string): void {
    console.error(msg);
    // eslint-disable-next-line no-debugger
    debugger;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function assertNever(x: never): never {
    callDebugger("Unexpected object: " + x);
    throw new Error("Didn't expect to get here");
}
