import * as vscode from 'vscode';
import { MutableSourceFileConfiguration, MutableWorkspaceBrowseConfiguration } from "../components/SourceFileConfiguration";

export interface ISourceFileConfigurationService
{
    onDidChangeSourceFileConfiguration: vscode.Event<void>;
    getSourceFileConfiguration(uri: vscode.Uri): Promise<MutableSourceFileConfiguration | undefined | null>;
    getBrowseConfiguration(): Promise<MutableWorkspaceBrowseConfiguration | null>;
	getDependenciesForSourceFile(uri: vscode.Uri): string[] | null;
}
