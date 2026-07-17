import path from "node:path";
import * as vscode from "vscode";
import { parseProjectJson, ProjectInfoManager, ProjectJsonFile, ProjectJsonLinkUnit, ProjectJsonTarget } from "../../components/ProjectInfo";
import { BrowseableType, IBrowseSet, IProjectInfoService } from "../IProjectInfoService";
import { ServiceContainer } from "../ServiceContainer";
import { AppServices } from "../AppServices";
import { Setting, SettingChangeEvent } from "../ISettingsService";
import { SourceFileConfiguration } from "vscode-cpptools";
import { getGNPath, matchPathPrefix, splitPathIntoComponents, parseTarget, fsPathToGNPath, extractPathComponentsFromTargetOrPath } from "../../components/parseTarget";
import { MutableSourceFileConfiguration, MutableWorkspaceBrowseConfiguration } from "../../components/SourceFileConfiguration";
import { build } from "../../components/constants";
import { IWatchedFile } from "../IFileService";
import { SingleUseQueue } from "../../components/SingleUseQueue";

type CacheEntryTarget = ProjectJsonTarget & { name: string };
interface CacheEntry
{
    targets: CacheEntryTarget[]
    cache: SourceFileConfiguration | undefined;
}

function buildLinks(
    projectJson: ProjectJsonFile | null,
    links: Map<string, CacheEntry>,
    partOf: Map<string, string[]>,
): void
{
    links.clear();
    partOf.clear();

    if (!projectJson) {
        return;
    }

    const addPartOf = (source: string, output: string) => {
        if (!partOf.has(source)) {
            partOf.set(source, []);
        }
        partOf.get(source)!.push(output);
    };

    for (const [key, target] of Object.entries(projectJson.targets ?? {})) {

        const parsed = parseTarget(key, false);
        if (!parsed)
            continue;

        const path = parsed.path;

        if (!links.has(path)) {
            links.set(path, { targets: [], cache: undefined });
        }
        links.get(path)!.targets.push({ ...target, name: key });

        // deps
        for (const dep of target.deps ?? []) {
            addPartOf(dep, key);
        }

        const sourceOutputs = target.source_outputs;
        if (sourceOutputs) {
            for (const [source, outputs] of Object.entries(sourceOutputs)) {
                for (const output of outputs) {
                    addPartOf(source, output);
                    addPartOf(output, key);
                }
            }
        }
    }
}

function buildSourceToTargetMap(
    projectJson: ProjectJsonFile | null,
    sourceToTargetCache: Map<string, string[]>,
): void
{
    sourceToTargetCache.clear();

    if (!projectJson) {
        return;
    }

    for (const [key, target] of Object.entries(projectJson.targets ?? {})) {
        const sources = target.sources;
        if (!sources || !Array.isArray(sources)) {
            continue;
        }

        for (const source of sources) {
            if (!sourceToTargetCache.has(source)) {
                sourceToTargetCache.set(source, []);
            }
            sourceToTargetCache.get(source)!.push(key);
        }
    }
}

function buildDepToTargetMap(
    projectJson: ProjectJsonFile | null,
    depToTargetCache: Map<string, string[]>,
): void
{
    depToTargetCache.clear();

    if (!projectJson) {
        return;
    }

    for (const [key, target] of Object.entries(projectJson.targets ?? {})) {
        const deps = target.deps;
        if (!deps || !Array.isArray(deps)) {
            continue;
        }

        for (const dep of deps) {
            if (!depToTargetCache.has(dep)) {
                depToTargetCache.set(dep, []);
            }
            depToTargetCache.get(dep)!.push(key);
        }
    }
}

function isSourceSet(target: ProjectJsonTarget): boolean
{
    return target.type === 'source_set';
}

function isBrowseableTarget(target: ProjectJsonTarget): boolean
{
    return target.type === 'source_set'
        || target.type === 'executable'
        || target.type === 'shared_library'
        || target.type === 'static_library';
}

type ProjectInfoServiceDeps = Pick<AppServices, 'settings' | 'fs' | 'context'>;

export function createProjectInfoService(services: ServiceContainer<AppServices>): ProjectInfoService
{
    return new ProjectInfoService({
        settings: services.get('settings'),
        fs: services.get('fs'),
        context: services.get('context'),
    });
}

export class ProjectInfoService implements IProjectInfoService
{

    private readonly settings: AppServices['settings'];
    private readonly fileWatcher: IWatchedFile<ProjectJsonFile>;
    private readonly disposables: vscode.Disposable[] = [];
    private projectJson: ProjectJsonFile | null = null;
    private readonly links: Map<string, CacheEntry> = new Map();
    private readonly partOf: Map<string, string[]> = new Map();
    private readonly sourceToTargetCache: Map<string, string[]> = new Map();
    private readonly depToTargetCache: Map<string, string[]> = new Map();

    private readonly _onChange = new vscode.EventEmitter<void>();
    private disposed = false;
    private reloadVersion = 0;

    public readonly onChange: vscode.Event<void> = this._onChange.event;

    constructor(services: ProjectInfoServiceDeps)
    {
        this.settings = services.settings;
        this.fileWatcher = services.fs.createWatchedFile("project.json", parseProjectJson);

        this.disposables.push(
            this.fileWatcher,
            this._onChange,
            this.settings.onChange((event: SettingChangeEvent) => {
                if (event.affects(Setting.outputDir)) {
                    this.fileWatcher.setBaseDir(this.settings.get(Setting.outputDir));
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                void this.resetFile();
            }),
            this.fileWatcher.onChange(() => {
                void this.resetFile();
            }),
        );

        this.fileWatcher.setBaseDir(this.settings.get(Setting.outputDir));
        void this.resetFile();
        services.context.subscriptions.push(this);
    }

    public dispose(): void
    {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.reloadVersion += 1;

        for (const disposable of this.disposables.splice(0).reverse()) {
            disposable.dispose();
        }
    }

    public get loaded(): boolean
    {
        return this.projectJson !== null;
    }

    private async resetFile(): Promise<void>
    {
        const currentReload = ++this.reloadVersion;
        this.projectJson = await this.fileWatcher.read();
        if (this.disposed || currentReload !== this.reloadVersion) {
            return;
        }

        buildLinks(this.projectJson, this.links, this.partOf);

        buildSourceToTargetMap(this.projectJson, this.sourceToTargetCache);
        buildDepToTargetMap(this.projectJson, this.depToTargetCache);

        this._onChange.fire();
    }

    public getProjectDescription(): ProjectJsonFile | null
    {
        return this.projectJson;
    }

    private getContainingFolder(uri: vscode.Uri): {
        valhallaDir: string,
        gnPath: string,
        target: CacheEntry,
    } | null
    {
        // extract relative path from uri
        const valhallaDir = this.settings.get(Setting.valhallaDir);
        if (!valhallaDir) {
            return null;
        }

        const relativePath = path.relative(valhallaDir, uri.fsPath);
        const parts = splitPathIntoComponents(relativePath);
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
                    gnPath: candidatePath,
                };
            }
            postUpdate.push(candidatePath);
            parts.pop();
        }

        return null;
    }


    public getSourceFileConfiguration(uri: vscode.Uri, cpp: string | null): MutableSourceFileConfiguration | null
    {
        const containingFolder = this.getContainingFolder(uri);
        if (!containingFolder) {
            return null;
        }

        const entry = containingFolder.target;
        const valhallaDir = containingFolder.valhallaDir;
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
        const containingFolderPath = extractPathComponentsFromTargetOrPath(containingFolder.gnPath);

        type QueueItem = CacheEntryTarget;
        const queue: SingleUseQueue<QueueItem> = new SingleUseQueue<QueueItem>(item => item.name);
        for (const t of entry.targets) {
            queue.enqueue(t);
        }

        while (queue.isNotEmpty) {
            const target = queue.dequeue()!;

            const definitiveTarget = (
                target.type === 'shared_library'
                || target.type === 'static_library'
                || target.type === 'executable'
                || target.type === 'source_set'
            );

            if (definitiveTarget) {
                // relay on this configuration
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

            // recursively add dependencies from sub-folders
            if (target.type === 'source_set' || target.type === 'group') {
                for (const dep of target.deps ?? []) {

                    if (!matchPathPrefix(dep, containingFolderPath))
                        continue;

                    const depTarget = this.projectJson?.targets?.[dep];
                    if (depTarget) {
                        queue.enqueue({...depTarget, name: dep});
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

        const browseTargets = this.settings.get(Setting.browseTargets) ?? [];
        const valhallaDir = this.settings.get(Setting.valhallaDir);
        if (!valhallaDir) {
            return null;
        }

        const dirSet = new Set<string>();
        const includeAll = browseTargets.length === 0;

        const addTarget = (target: ProjectJsonTarget) => {
            if (!isBrowseableTarget(target)) {
                return;
            }

            for (const source of target.sources ?? []) {
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

        if (includeAll) { // enumerate all the items in the project

            for (const target of Object.values(projectJson.targets)) {
                addTarget(target);
            }
        }

        else { // include some: only those that are dependencies of the specified targets

            const queue = [...browseTargets];
            const visited = new Set<string>();

            while (queue.length > 0) {
                const current = queue.shift()!;
                if (visited.has(current)) {
                    continue;
                }
                visited.add(current);

                const target = projectJson.targets[current];
                if (!target) {
                    continue;
                }

                addTarget(target);

                for (const dep of target.deps ?? []) {
                    if (!visited.has(dep) && isSourceSet(projectJson.targets[dep])) {
                        queue.push(dep);
                    }
                }
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

    getDependenciesForSourceFile(uri: vscode.Uri): string[] | null
    {
        const result: string[] = [];
        const valhallaDir = this.settings.get(Setting.valhallaDir);
        if (!valhallaDir) {
            return null;
        }

        const relativePath = path.relative(valhallaDir, uri.fsPath);
        const ninjaTarget = "//" + relativePath.replace(/\\/g, '/');

        const queue = [ninjaTarget];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) {
                continue;
            }
            visited.add(current);
            result.push(current);

            const parts = this.partOf.get(current);
            if (!parts) {
                continue;
            }

            for (const part of parts) {
                if (!visited.has(part)) {
                    queue.push(part);
                }
            }
        }

        return result.length > 0 ? result : null;
    }

    getLinkUnits(): ProjectJsonLinkUnit[]
    {
        const targets = this.projectJson?.targets;
        if (!targets || typeof targets !== 'object') {
            return [];
        }

        const result: ProjectJsonLinkUnit[] = [];
        for (const [name, target] of Object.entries(targets)) {
            if (target.type !== 'shared_library'
                && target.type !== 'static_library'
                && target.type !== 'executable') {
                continue;
            }

            result.push({
                target: name,
                type: target.type,
            });
        }

        result.sort((a, b) => a.target.localeCompare(b.target));
        return result;
    }

    getLinkUnitsForFile(uri: vscode.Uri): ProjectJsonLinkUnit[] | null
    {
        const valhallaDir = this.settings.get(Setting.valhallaDir);
        if (!valhallaDir) {
            return null;
        }

        const relativePath = path.relative(valhallaDir, uri.fsPath);
        const ninjaTarget = "//" + relativePath.replace(/\\/g, '/');

        // 1st: find file among 'source_outputs'
        // if this is a source_set, then find the source_set name
        // in the 'deps' of the link units
        // continue until we find the link unit or exhaust the graph

        const candidates = [...this.sourceToTargetCache.get(ninjaTarget) || []];
        const result: ProjectJsonLinkUnit[] = [];
        const resultSet = new Set<string>();
        const allTargets = this.projectJson?.targets;
        if (!allTargets || typeof allTargets !== 'object' || !candidates || candidates.length === 0) {
            return null;
        }

        // second step: for each target, find link units that depend on it (directly or indirectly)
        while (candidates.length > 0) {
            const target = candidates.shift()!;
            const targetInfo = allTargets[target];
            if (!targetInfo) {
                continue;
            }

            if (targetInfo.type === 'shared_library'
                || targetInfo.type === 'static_library'
                || targetInfo.type === 'executable')
            {
                if (!resultSet.has(target)) {
                    resultSet.add(target);
                    result.push({
                        target,
                        type: targetInfo.type,
                    });
                }
            }

            if (targetInfo.type === 'source_set'
                || targetInfo.type === 'shared_library'
                || targetInfo.type === 'static_library')
            {
                candidates.push(...this.depToTargetCache.get(target) || []);
            }
        }

        return result.length > 0 ? result : null;
    }

    getUnitTests(): string[] | null
    {
        return ProjectInfoManager.getUnitTests(this.projectJson);
    }

    getLinkUnitSources(targetName: string): string[] | null
    {
        const target = this.projectJson?.targets?.[targetName];
        if (!target) {
            return null;
        }

        const sources = target.sources;
        if (!sources || !Array.isArray(sources)) {
            return null;
        }

        const valhallaDir = this.settings.get(Setting.valhallaDir);
        if (!valhallaDir) {
            return null;
        }

        const result: string[] = [];
        for (const source of sources) {
            if (typeof source !== 'string')
                continue;
            const gnPath = getGNPath(source, false);
            if (!gnPath)
                continue;

            const sourcePath = path.join(valhallaDir, gnPath);
            result.push(sourcePath);
        }

        // enumerate 'deps' and find all 'source_set's, then enumerate their sources as well
        const queue = [...target.deps ?? []];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) {
                continue;
            }
            visited.add(current);

            const currentTarget = this.projectJson?.targets?.[current];
            if (!currentTarget) {
                continue;
            }

            if (currentTarget.type === 'source_set') {
                const deps = currentTarget.deps;
                if (deps && Array.isArray(deps)) {
                    for (const dep of deps) {
                        if (!visited.has(dep)) {
                            queue.push(dep);
                        }
                    }
                }
            }

            if (currentTarget.sources && Array.isArray(currentTarget.sources)) {
                for (const source of currentTarget.sources) {
                    if (typeof source !== 'string')
                        continue;
                    const gnPath = getGNPath(source, false);
                    if (!gnPath)
                        continue;

                    const sourcePath = path.join(valhallaDir, gnPath);
                    result.push(sourcePath);
                }
            }
        }

        return result.length > 0 ? result : null;
    }


    public getBrowseSet(): IBrowseSet
    {
        const browseSet = new Set<string>(this.settings.get(Setting.browseTargets));
        const browseableTypeCache = new Map<string, BrowseableType>();
        const indirectlyBrowseableDeps = new Set<string>();
        const includeAll = browseSet.size === 0;

        if (includeAll) {
            return {
                isBrowseable: (target: string): BrowseableType => {
                    return BrowseableType.IMPLICITLY;
                }
            };
        }

        for (const target of browseSet) {
            const deps = this.projectJson?.targets?.[target]?.deps;
            if (deps && Array.isArray(deps)) {
                for (const dep of deps) {
                    indirectlyBrowseableDeps.add(dep);
                }
            }
        }

        const calculateBrowseableType = (target: string): BrowseableType => {
            if (browseSet.has(target)) {
                return BrowseableType.EXPLICITLY;
            }

            const projectJson = this.projectJson;
            if (!projectJson || !projectJson.targets) {
                return BrowseableType.NON_BROWSEABLE;
            }

            const targetInfo = projectJson.targets[target];
            if (!targetInfo) {
                return BrowseableType.NON_BROWSEABLE;
            }

            if (!isBrowseableTarget(targetInfo)) {
                return BrowseableType.NON_BROWSEABLE;
            }

            const targets = this.depToTargetCache.get(target);
            if (!targets || targets.length === 0) {
                return BrowseableType.POTENTIALLY;
            }

            if (!isSourceSet(targetInfo))
                return BrowseableType.POTENTIALLY;

            for (const sourceSet of targets) {
                const browseableType = calculateBrowseableType(sourceSet);
                if (browseableType === BrowseableType.EXPLICITLY || browseableType === BrowseableType.IMPLICITLY) {
                    return BrowseableType.IMPLICITLY;
                }
            }

            return BrowseableType.POTENTIALLY;
        }

        const isBrowseableWithCache = (target: string): BrowseableType => {
            if (browseableTypeCache.has(target)) {
                return browseableTypeCache.get(target)!;
            }

            const browseableType = calculateBrowseableType(target);
            browseableTypeCache.set(target, browseableType);
            return browseableType;
        };

        return {
            isBrowseable: (target: string): BrowseableType => {
                return isBrowseableWithCache(target);
            }
        };
    }

    getTargets(filter: (target: string) => boolean): string[]
    {
        const targets = this.projectJson?.targets;
        if (!targets || typeof targets !== 'object') {
            return [];
        }

        const result: string[] = [];
        for (const [name, target] of Object.entries(targets)) {
            if (filter(name)) {
                result.push(name);
            }
        }

        result.sort((a, b) => a.localeCompare(b));
        return result;
    }

    getReverseDependencies(target: string): string[] | null
    {
        const reverseDeps = this.depToTargetCache.get(target);
        if (!reverseDeps || reverseDeps.length === 0) {
            return null;
        }
        return [...reverseDeps].sort((a, b) => a.localeCompare(b));
    }

}
