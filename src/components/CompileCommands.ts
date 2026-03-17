import vscode from "vscode";

export interface CompileCommandEntry {
    file: string;
    command: string;
    directory: string;
}

export type CompileCommandsFile = CompileCommandEntry[];

export function parseCompileCommands(content: string): CompileCommandsFile
{
    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            return parsed as CompileCommandsFile;
        } else {
            vscode.window.showErrorMessage("Invalid compile_commands.json format: expected an array.");
            return [];
        }
    } catch (e) {
        vscode.window.showErrorMessage("Failed to parse compile_commands.json: " + e);
        return [];
    }
}
