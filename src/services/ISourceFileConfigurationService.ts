import * as vscode from 'vscode';
import { MutableSourceFileConfiguration, MutableWorkspaceBrowseConfiguration } from "../components/SourceFileConfiguration";

export interface ISourceFileConfigurationService
{
    onDidChangeSourceFileConfiguration: vscode.Event<void>;
    onDidChangeBrowseConfiguration: vscode.Event<void>;
    onDidProvidedSourceFileConfiguration: vscode.Event<{ uri: vscode.Uri, configuration: MutableSourceFileConfiguration | null }>;

    getSourceFileConfiguration(uri: vscode.Uri): Promise<MutableSourceFileConfiguration | undefined | null>;
    getBrowseConfiguration(): Promise<MutableWorkspaceBrowseConfiguration | null>;
	getDependenciesForSourceFile(uri: vscode.Uri): string[] | null;
}
