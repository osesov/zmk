import path from "path";
import fs from "fs";
import vscode from "vscode";
import { SourceFileConfiguration } from "vscode-cpptools";
import { MutableSourceFileConfiguration } from "./SourceFileConfiguration";

// GN's project.json format is not documented anywhere, so this is just a guess based on the output of `gn desc --format=json`
export interface ProjectJsonTarget {
    type: 'action' | 'source_set' | 'group' | 'shared_library' | 'static_library' | 'executable';
    args: string[] | undefined;
    deps: string[] | undefined;
    inputs: string[] | undefined;
    metadata: { [k: string]: unknown }  | undefined; // ???
    externs: { [k: string]: unknown }  | undefined; // ???
    outputs: string[] | undefined;
    public: string | undefined;
    public_configs: string[] | undefined;
    script: string | undefined;
    testonly: boolean | undefined;
    toolchain: string | undefined;
    visibility: string[] | undefined;
    configs: string[] | undefined;

    defines: string[] | undefined;
    include_dirs: string[] | undefined;
    cflags: string[] | undefined;
    cflags_cc: string[] | undefined;
    ldflags: string[] | undefined;
    lib_dirs: string[] | undefined;
    libs: string[] | undefined;
}

interface ProjectJsonTool
{
    command: string | undefined;
    default_output_dir: string | undefined;
    default_output_extension: string | undefined;
    description: string | undefined;
    lib_dir_switch: string | undefined;
    lib_switch: string | undefined;
    output_prefix: string | undefined;
    outputs: string[] | undefined;
    framework_dir_switch: string | undefined;
    framework_switch: string | undefined;
    weak_framework_switch: string | undefined;
    depfile: string | undefined;
}

interface ProjectJsonToolchain
{
    [k: string]: ProjectJsonTool
}

export interface ProjectJsonFile {
    build_settings: {
        build_dir: string
        default_toolchain: string
        gen_input_files: string[]
        root_path: string
    },
    targets: { [k: string]: ProjectJsonTarget};
    toolchains: { [k: string]: ProjectJsonToolchain}
}

interface CacheEntry
{
    targets: ProjectJsonTarget[]
    cache: SourceFileConfiguration | undefined;
}

export class ProjectInfo
{
    private projectJsonCache: ProjectJsonFile | null = null;
    private projectJsonMTime: number = 0;
    private projectJsonPath: string | null = null;
    private links: Map<string, CacheEntry> = new Map();
    private static readonly pathRegex = /^[/][/]([^:]+)(:.*)?$/;

    public constructor()
    {
    }

    public reset(): void
    {
        this.projectJsonCache = null;
        this.projectJsonMTime = 0;
        this.projectJsonPath = null;
        this.links.clear();
    }

    private static extractPath(p: string): string | null
    {
        const m = p.match(ProjectInfo.pathRegex);
        if (!m)
            return null;

        return m[1];
    }

    public async load(outputDir: string): Promise<ProjectJsonFile | null>
    {
        const projectJsonPath = path.join(outputDir, 'project.json');
        if (!fs.existsSync(projectJsonPath)) {
            this.reset();
            vscode.window.showErrorMessage(`Failed to find project.json in ${outputDir}. Make sure the build was successful and that the output directory is correct.`);
            return null;
        }

        const file = fs.openSync(projectJsonPath, 'r');
        try {
            const stats = fs.fstatSync(file);
            const mtime = stats.mtime.getTime();
            if (mtime === this.projectJsonMTime && projectJsonPath === this.projectJsonPath) {
                return this.projectJsonCache;
            }

            const content = fs.readFileSync(file, 'utf-8');
            const projectJson = JSON.parse(content) as ProjectJsonFile;

            this.projectJsonMTime = mtime;
            this.projectJsonPath = projectJsonPath;
            this.projectJsonCache = projectJson;

            // prepare links
            this.links.clear();
            for (const [key, target] of Object.entries(projectJson.targets)) {

                const path = ProjectInfo.extractPath(key);
                if (!path)
                    continue;

                if (!this.links.has(path)) {
                    this.links.set(path, { targets: [], cache: undefined });
                }
                this.links.get(path)!.targets.push(target);
            }

            return this.projectJsonCache;
        }

        finally {
            fs.closeSync(file);
        }
    }

    public getContainingFolder(uri: vscode.Uri): CacheEntry | null
    {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            return null;
        }

        // extract relative path from uri
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return null;
        }

        const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
        const parts = relativePath.split(path.sep);
        const postUpdate: string[] = [];

        while (parts.length > 0) {
            const candidatePath = parts.join('/');
            const candidateTarget = this.links.get(candidatePath);

            if (candidateTarget) {

                for (const up of postUpdate) {
                    this.links.set(up, candidateTarget);
                }

                return candidateTarget;
            }
            postUpdate.push(candidatePath);
            parts.pop();
        }

        return null;
    }

    public getSourceFileConfiguration(valhallaDir: string, uri: vscode.Uri, cpp: string | null): MutableSourceFileConfiguration | null
    {
        const entry = this.getContainingFolder(uri);
        if (!entry) {
            return null;
        }

        if (entry.cache) {
            return entry.cache;
        }

        const config: MutableSourceFileConfiguration = {
            defines: [],
            includePath: [],
            compilerPath: cpp ?? '/usr/bin/g++', // TODO: toolchain
            standard: 'c++17', // TODO: guess from toolchain
            intelliSenseMode: 'linux-gcc-x64', // TODO: guess from toolchain
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
                    const p = ProjectInfo.extractPath(includeDir);
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
}
