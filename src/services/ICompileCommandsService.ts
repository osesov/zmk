import * as vscode from "vscode";
import { MutableSourceFileConfiguration } from "../components/SourceFileConfiguration";

export interface ICompileCommandsService
{
    onChange: vscode.Event<void>;

    cxxCompiler: string | null;
    getSourceFileConfiguration(uri: vscode.Uri): MutableSourceFileConfiguration | null;

    // TODO: build browse configuration out of compile_commands.json?
    // we have source paths there and extract include paths from compiler invocation, so it should be possible
}
