import * as vscode from "vscode";
import { ProjectJsonFile, ProjectJsonLinkUnit } from "../components/ProjectInfo";
import { MutableSourceFileConfiguration, MutableWorkspaceBrowseConfiguration } from "../components/SourceFileConfiguration";

export enum BrowseableType
{
    NON_BROWSEABLE, // cannot be added to browse configuration
    POTENTIALLY,    // can be added to browse configuration, but not explicitly marked as browseable
    EXPLICITLY,     // explicitly marked as browseable
    IMPLICITLY,     // not explicitly marked as browseable, but is in the browse configuration (e.g. as a dependency of an explicitly browseable target)
}

export interface IBrowseSet
{
    isBrowseable(target: string): BrowseableType;
}

export interface IProjectInfoService
{
    onChange: vscode.Event<void>;
    getProjectDescription(): ProjectJsonFile | null;
    // TODO: Should remove 'cpp' parameter?
    // it is being loaded from compile_commands.json nowm since project.json
    // has 'ccache', and the tool itself is has no path
    getSourceFileConfiguration(uri: vscode.Uri, cpp: string | null): MutableSourceFileConfiguration | null;
    getBrowseConfiguration(): MutableWorkspaceBrowseConfiguration | null;
    getBrowseSet(): IBrowseSet | null;
    getDependenciesForSourceFile(uri: vscode.Uri): string[] | null;
    getLinkUnits(): ProjectJsonLinkUnit[];
    getLinkUnitsForFile(uri: vscode.Uri): ProjectJsonLinkUnit[] | null;
    getUnitTests(): string[] | null;

    getTargets(filter: (target: string) => boolean): string[];
    getReverseDependencies(target: string): string[] | null;

}
