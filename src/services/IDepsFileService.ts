import * as vscode from "vscode";

export interface IDepsFileService
{
    readonly onChange: vscode.Event<void>;
    readonly loaded: boolean;

    isKnownFile(uri: vscode.Uri): boolean;
}
