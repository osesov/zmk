import * as vscode from 'vscode';
import { MutableSourceFileConfiguration } from "../components/SourceFileConfiguration";

export interface IValhallaCppToolsProvider
{
    onDidChangeSourceFileConfiguration: vscode.Event<void>;
    getProvidedConfiguration(uri: vscode.Uri): MutableSourceFileConfiguration | null;
}
