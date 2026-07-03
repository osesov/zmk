import * as vscode from "vscode";
import { ArgsMap } from "../components/ArgsFile";

export interface IArgsFileService
{
    readonly onChange: vscode.Event<void>;
    readonly loaded: boolean;
    getArgs(): ArgsMap | null;
}
