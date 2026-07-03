import * as vscode from "vscode";
import { MutableSourceFileConfiguration } from "../components/SourceFileConfiguration";

export interface SourceFileConfigurationEx extends MutableSourceFileConfiguration {
    _compilerPath: string | undefined
    _command: string[]
}

export interface ICompileCommandsService
{
    readonly onChange: vscode.Event<void>;
    readonly loaded: boolean;
    readonly cxxCompiler: string | null;
    getSourceFileConfiguration(uri: vscode.Uri): SourceFileConfigurationEx | null;
    isFileListed(uri: vscode.Uri): boolean;

    // TODO: build browse configuration out of compile_commands.json?
    // we have source paths there and extract include paths from compiler invocation, so it should be possible
}
