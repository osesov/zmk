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

export function findProjectRoot(p: string) : string {
    while(true) {
        const file = path.resolve(p, ".gn");

        if (exists(file)) {
            return p;
        }

        const n = path.dirname(p);

        if (p === n) {
            throw new Error("Valhalla root not found");
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

    return findProjectRoot(workspaceRoot);
}

export function isDevContainerHost(): boolean {
    return vscode.env.remoteName === 'dev-container';
}
