import * as cpptools from "vscode-cpptools";
import { Mutable } from "./utils";

export type MutableSourceFileConfiguration = Mutable<cpptools.SourceFileConfiguration>;
export type MutableWorkspaceBrowseConfiguration = Mutable<cpptools.WorkspaceBrowseConfiguration>;
export type IntelliSenseMode = MutableSourceFileConfiguration['intelliSenseMode'];
export type CompilerStandard = MutableSourceFileConfiguration['standard'];
