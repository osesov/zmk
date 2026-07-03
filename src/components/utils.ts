import vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { Utils } from 'vscode-uri';

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

export async function findProjectRootUri(p: vscode.Uri) : Promise<vscode.Uri | undefined> {
    while(true) {
        const gnFile = vscode.Uri.joinPath(p, ".gn");
        try {
            const stat = await vscode.workspace.fs.stat(gnFile);
            if (stat.type === vscode.FileType.File) {
                return p;
            }
        } catch(e) {
            // file does not exist, continue searching
        }

        const parent = Utils.dirname(p);
        if (parent.path === p.path) {
            return undefined;
        }
        p = parent;
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
    debugger;
}

export function assertNever(x: never): never {
    callDebugger("Unexpected object: " + x);
    throw new Error("Didn't expect to get here");
}

export function expectNever(x: never): void {
    callDebugger("Unexpected object: " + x);
}

export function expectNotNull<T>(x: T | null | undefined): asserts x is T {
    if (x === null || x === undefined) {
        callDebugger("Expected value to be not null or undefined, but got: " + x);
        throw new Error("Expected value to be not null or undefined");
    }
}

export async function setContext(name: string, value: string | boolean | number)
{
    return vscode.commands.executeCommand("setContext", name, value)
        .then(
            () => {},
            (e) => {vscode.window.showErrorMessage(`Failed to set context for ${name}: ${e}`)}
        );
}

export async function writeTextToClipboard(str: string | undefined | null): Promise<void>
{
    if (str === null || str === undefined)
        str = '';

    await vscode.env.clipboard.writeText(str);
}

export async function isBuildDirValid(buildDir: string): Promise<string | null>
{
    const files = ["compile_commands.json", "project.json", "args.gn"];
    const missingFiles: string[] = [];
    if (!exists(buildDir)) {
        return `Output directory does not exist: ${buildDir}`;
    }
    for (const file of files) {
        const filePath = path.join(buildDir, file);
        if (!exists(filePath)) {
            missingFiles.push(file);
        }
    }

    return missingFiles.length === 0 ? null : 'Missing files in output folder: ' + missingFiles.join(', ');
}

export function withoutException<T>(promise: Promise<T>): Promise<{ result: T | null, error: Error | null }>;
export function withoutException<T>(func: () => T, result: T): T;
export function withoutException<T>(functionOrPromise: (() => T) | Promise<T>, result?: T): T | Promise<{ result: T | null, error: Error | null }>
{
    if (functionOrPromise instanceof Promise) {
        return functionOrPromise.then(
            result => ({ result, error: null }),
            error => ({ result: null, error }),
        );
    } else {
        try {
            return functionOrPromise();
        } catch (error) {
            return result!;
        }
    }
}
