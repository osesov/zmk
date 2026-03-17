import path from "node:path";
import * as vscode from "vscode";
import { parseProjectJson, ProjectJsonFile, ProjectJsonTarget } from "../../components/ProjectInfo";
import { IProjectInfoService } from "../IProjectInfoService";
import { ServiceContainer } from "../ServiceContainer";
import { AppServices } from "../AppServices";
import { Setting } from "../ISettingsService";
import { FileWatcher } from "../../components/FileWatcher";
import { SourceFileConfiguration } from "vscode-cpptools";
import { getGNPath, parseTarget } from "../../components/parseTarget";
import { MutableSourceFileConfiguration, MutableWorkspaceBrowseConfiguration } from "../../components/SourceFileConfiguration";
import { build } from "../../components/constants";
import { findProjectRoot, findProjectRootUri } from "../../components/utils";

interface CacheEntry
{
    targets: ProjectJsonTarget[]
    cache: SourceFileConfiguration | undefined;
}

function buildLinks(projectJson: ProjectJsonFile | null, links: Map<string, CacheEntry>): void
{
    links.clear();

    if (!projectJson) {
        return;
    }

    for (const [key, target] of Object.entries(projectJson.targets ?? {})) {

        const parsed = parseTarget(key, false);
        if (!parsed)
            continue;

        const path = parsed.path;

        if (!links.has(path)) {
            links.set(path, { targets: [], cache: undefined });
        }
        links.get(path)!.targets.push(target);
    }
}

export class ProjectInfoService implements IProjectInfoService
{

    private settings: AppServices['settings'];
    private fileWatcher = new FileWatcher("project.json");
    private projectJson: ProjectJsonFile | null = null;
    private links: Map<string, CacheEntry> = new Map();

    private _onChange = new vscode.EventEmitter<void>();

    public readonly onChange: vscode.Event<void> = this._onChange.event;

    constructor(private services: ServiceContainer<AppServices>)
    {
        this.settings = services.get('settings');

        const resetFile = async () => {
            const outputDir = this.settings.get(Setting.outputDir);
            this.fileWatcher.setBaseDir(outputDir);

            const content = await this.fileWatcher.getContentAsync()
            this.projectJson = content ? parseProjectJson(content) : null;
            buildLinks(this.projectJson, this.links);

            this._onChange.fire();
        }

        this.settings.onChange(() => resetFile());
        vscode.workspace.onDidChangeWorkspaceFolders(() => resetFile());
        this.fileWatcher.onChange(() => resetFile());

        resetFile();
    }

    public getProjectDescription(): ProjectJsonFile | null
    {
        return this.projectJson;
    }

    private getContainingFolder(uri: vscode.Uri): { valhallaDir: string, target: CacheEntry } | null
    {
        // extract relative path from uri
        const valhallaDir = findProjectRoot(uri.fsPath);
        if (!valhallaDir) {
            return null;
        }

        const relativePath = path.relative(valhallaDir, uri.fsPath);
        const parts = relativePath.split(path.sep);
        const postUpdate: string[] = [];

        while (parts.length > 0) {
            const candidatePath = parts.join('/');
            const candidateTarget = this.links.get(candidatePath);

            if (candidateTarget) {

                for (const up of postUpdate) {
                    this.links.set(up, candidateTarget);
                }

                return {
                    target: candidateTarget,
                    valhallaDir,
                };
            }
            postUpdate.push(candidatePath);
            parts.pop();
        }

        return null;
    }

    public getSourceFileConfiguration(uri: vscode.Uri, cpp: string | null): MutableSourceFileConfiguration | null
    {
        const candidate = this.getContainingFolder(uri);
        if (!candidate) {
            return null;
        }

        const entry = candidate.target;
        const valhallaDir = candidate.valhallaDir;
        if (entry.cache) {
            return entry.cache;
        }

        const config: MutableSourceFileConfiguration = {
            defines: [],
            includePath: [],
            compilerPath: cpp ?? build.defaultCompilerPath, // TODO: toolchain
            standard: build.defaultCppStandard, // TODO: guess from toolchain
            intelliSenseMode: build.defaultIntelliSenseMode, // TODO: guess from toolchain
        };

        const defines = new Set<string>();
        const includeSeen = new Set<string>();

        for (const target of entry.targets) {
            for (const define of target.defines ?? []) {
                if (!defines.has(define)) {
                    defines.add(define);
                    config.defines.push(define);
                }
            }

            for (const includeDir of target.include_dirs ?? []) {
                if (!includeSeen.has(includeDir)) {
                    includeSeen.add(includeDir);
                    const p = getGNPath(includeDir, false);
                    if (p) {
                        const fullPath = path.join(valhallaDir, p);
                        config.includePath.push(fullPath);
                    }
                }
            }
        }

        entry.cache = config;
        return config;
    }

    public getBrowseConfiguration(): MutableWorkspaceBrowseConfiguration | null
    {
        // type": "(source_set|shared_library|static_library|executable)
        const projectJson = this.projectJson;
        if (!projectJson || !projectJson.targets) {
            return null;
        }

        if (typeof projectJson.targets !== 'object') {
            return null;
        }

        const valhallaDir = this.settings.get(Setting.valhallaDir);
        if (!valhallaDir) {
            return null;
        }

        const dirSet = new Set<string>();
        for (const target of Object.values(projectJson.targets)) {
            if (target.type !== 'source_set'
                && target.type !== 'executable'
                && target.type !== 'shared_library'
                && target.type !== 'static_library') {
                continue;
            }

            if (!target.sources)
                continue;

            for (const source of target.sources) {
                if (typeof source !== 'string')
                    continue;
                const gnPath = getGNPath(source, false);
                if (!gnPath)
                    continue;

                const sourcePath = path.join(valhallaDir, gnPath);
                if (gnPath.startsWith("out."))
                    continue; // skip generated files
                const dirName = path.dirname(sourcePath);

                dirSet.add(dirName);
            }
        }

        const compiler = this.settings.get(Setting.compiler);
        const cppStandard = (this.settings.get(Setting.cppStandard) ?? build.defaultCppStandard) as MutableWorkspaceBrowseConfiguration['standard'];

        const browseConfig: MutableWorkspaceBrowseConfiguration = {
            browsePath: Array.from(dirSet),
            standard: cppStandard,

            compilerPath: compiler && compiler.length > 0 ? compiler[0] : undefined,
            compilerArgs: compiler && compiler.length > 0 ? compiler.slice(1) : undefined,
        };

        return browseConfig;
    }
}
