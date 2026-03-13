import path from "path";
import fs from "fs";
import vscode from "vscode";
import shell from "shell-quote";
import * as cpptools from "vscode-cpptools";
import { isDevContainerHost, Mutable } from "./utils";
import { MutableSourceFileConfiguration } from "./SourceFileConfiguration";
import { build } from "./constants";

export interface CompileCommandEntry {
    file: string;
    command: string;
    directory: string;
}

export type CompileCommandsFile = CompileCommandEntry[];

interface SourceFileConfigurationEx extends MutableSourceFileConfiguration {
    _compilerPath: string
}

interface CompileCommandCacheEntry {
    source: CompileCommandEntry;
    parsed: SourceFileConfigurationEx | null;
}

type CompileCommandsCache = Map<string, CompileCommandCacheEntry>;

export class CompileCommands {

    private compileCommandsCache: CompileCommandsCache = new Map();
    private compileCommandsMTime: number = 0;
    private compileCommandsPath: string | null = null;
    private cppCompiler: string | null = null;

    public reset(): void {
        this.compileCommandsCache.clear();
        this.compileCommandsMTime = 0;
        this.compileCommandsPath = null;
        this.cppCompiler = null;
    }

    public async load(outputDir: string): Promise<CompileCommandsCache | null> {
        const compileCommandsPath = path.join(outputDir, 'compile_commands.json');
        if (!fs.existsSync(compileCommandsPath)) {
            vscode.window.showErrorMessage(`Failed to find compile_commands.json in ${outputDir}. Make sure the build was successful and that the output directory is correct.`);
            return null;
        }

        const file = fs.openSync(compileCommandsPath, 'r');
        try {
            const stats = fs.fstatSync(file);
            const mtime = stats.mtime.getTime();
            if (mtime === this.compileCommandsMTime && compileCommandsPath === this.compileCommandsPath) {
                return this.compileCommandsCache;
            }

            const content = fs.readFileSync(file, 'utf-8');
            const compileCommands = JSON.parse(content) as CompileCommandsFile;

            this.compileCommandsMTime = mtime;
            this.compileCommandsPath = compileCommandsPath;
            this.compileCommandsCache.clear();

            for (const entry of compileCommands) {
                this.compileCommandsCache.set(path.normalize(entry.file), {
                    source: entry,
                    parsed: null,
                });

                const word0 = entry.command.split(' ')[0]
                if (word0.includes('++')) {
                    this.cppCompiler = word0;
                }
            }

            return this.compileCommandsCache;
        }

        finally {
            fs.closeSync(file);
        }
    }

    private parseCompileCommand(command: string): SourceFileConfigurationEx {
        // naive gcc flags parsing
        const words = shell.parse(command);
        const result: Mutable<SourceFileConfigurationEx> = {
            includePath: [],
            defines: [],
            standard: build.defaultCppStandard,
            intelliSenseMode: build.defaultIntelliSenseMode,

            forcedInclude: undefined,
            compilerPath: isDevContainerHost() ? words[0] as string : undefined,
            compilerArgs: undefined,
            compilerFragments: undefined,
            _compilerPath: words[0] as string // TODO: not safe?
        };

        for (const word of words) {
            if (typeof word !== 'string') {
                continue; // skip shell operators like &&, ||, etc.
            }

            if (word.startsWith('-I')) {
                result.includePath.push(word.slice(2));
            } else if (word.startsWith('-D')) {
                result.defines.push(word.slice(2));
            } else if (word.startsWith('-std=')) {
                result.standard = word.slice(5) as cpptools.CppStandard;

                if (result.standard.includes('++'))
                    this.cppCompiler = words[0] as string; // TODO: not safe?
            }
        }

        return result;
    }

    public getSourceFileConfiguration(uri: vscode.Uri): SourceFileConfigurationEx | null {
        const filePath = uri.fsPath;

        if (this.compileCommandsCache.size === 0)
            return null;

        const entry = this.compileCommandsCache.get(path.normalize(filePath));
        if (!entry) {
            // vscode.window.showWarningMessage(`No compile command found for ${filePath}. IntelliSense may not work correctly for this file.`);
            return null;
        }

        if (!entry.parsed && entry.source.command) {
            entry.parsed = this.parseCompileCommand(entry.source.command);

            // const includes = this.getSystemIncludes();
            // entry.parsed.includePath.push(...includes);
        }

        return entry.parsed;
    }

    get cpp(): string | null {
        return this.cppCompiler;
    }
}
