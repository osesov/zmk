import * as vscode from 'vscode';
import { MutableSourceFileConfiguration } from "../components/SourceFileConfiguration";

export interface IValhallaCppToolsProvider
{
    onDidChangeSourceFileConfiguration: vscode.Event<void>;
    getSourceFileConfiguration(uri: vscode.Uri): Promise<MutableSourceFileConfiguration | undefined | null>;
}
