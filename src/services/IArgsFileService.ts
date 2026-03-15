import * as vscode from "vscode";
import { ArgsMap } from "../components/ArgsFile";

export interface IArgsFileService
{
    onChange: vscode.Event<void>;
    getArgs(): ArgsMap | null;
}
