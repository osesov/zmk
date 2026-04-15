import path from "node:path";
import * as vscode from "vscode";
import * as cpptools from "vscode-cpptools";
import shell from "shell-quote";

import { ServiceContainer } from "../ServiceContainer";
import { AppServices } from "../AppServices";
import { Setting } from "../ISettingsService";
import { FileWatcher } from "../../components/FileWatcher";
import { build } from "../../components/constants";
import { CompileCommandEntry, CompileCommandsFile, parseCompileCommands } from "../../components/CompileCommands";
import { ICompileCommandsService, SourceFileConfigurationEx } from "../ICompileCommandsService";
import { isDevContainerHost, Mutable } from "../../components/utils";

interface CompileCommandCacheEntry {
    source: CompileCommandEntry;
    parsed: SourceFileConfigurationEx | null;
}

type CompileCommandsCache = Map<string, CompileCommandCacheEntry>;


function buildCache(compileCommands: CompileCommandsFile | null, cache: CompileCommandsCache): string | null
{
    cache.clear();
    let cxxCompiler: string | null = null;

    if (!compileCommands) {
        return null;
    }

    for (const entry of compileCommands) {
        cache.set(path.normalize(entry.file), {
            source: entry,
            parsed: null,
        });

        const word0 = entry.command.split(' ')[0]
        if (word0.includes('++')) {
            cxxCompiler = word0;
        }
    }

    return cxxCompiler;
}

function normalizeArg(arg: shell.ParseEntry): string {
    if (typeof arg === 'string')
        return arg;
    else if ('comment' in arg)
        return arg.comment;
    else
        return arg.op;
}

export class CompileCommandsService implements ICompileCommandsService
{
    private settings: AppServices['settings'];
    private fileWatcher = new FileWatcher("compile_commands.json");
    private compileCommands: CompileCommandsFile | null = null;
    private cache: CompileCommandsCache = new Map();
    private _cxxCompiler: string | null = null;

    private _onChange = new vscode.EventEmitter<void>();
    public readonly onChange: vscode.Event<void> = this._onChange.event;

    constructor(private services: ServiceContainer<AppServices>)
    {
        this.settings = services.get('settings');

        const resetFile = async () => {
            const outputDir = this.settings.get(Setting.outputDir);
            this.fileWatcher.setBaseDir(outputDir);

            const content = await this.fileWatcher.getContentAsync()
            this.compileCommands = content ? parseCompileCommands(content) : null;
            this._cxxCompiler = buildCache(this.compileCommands, this.cache);

            this._onChange.fire();
        }

        this.settings.onChange((event) => event.affects(Setting.outputDir) && resetFile());
        vscode.workspace.onDidChangeWorkspaceFolders(() => resetFile());
        this.fileWatcher.onChange(() => resetFile());

        resetFile();
    }

    get cxxCompiler(): string | null {
        return this._cxxCompiler;
    }

    private parseCompileCommand(command: string): SourceFileConfigurationEx {
        // naive gcc flags parsing
        const words = shell.parse(command);

        const findCommandWord = () => {
            for (const word of words)
                if (typeof word === 'string')
                    return word;

            return undefined;
        }

        const optParser = new class {
            private index = 0;

            get done(): boolean {
                return this.index >= words.length;
            }

            skip(): void {
                while (this.index < words.length) {
                    this.index += 1;
                    const word = words[this.index];
                    if (typeof word !== 'string')
                        continue;

                    else if (!word.startsWith('-'))
                        continue;

                    else
                        break;
                }
            }

            getOpt(name: string, handle: (value: string) => void): boolean
            {
                if (this.index >= words.length) {
                    return false;
                }

                const word = words[this.index];
                if (typeof word !== 'string') {
                    return false;
                }

                if (word === name) {
                    if (this.index + 1 >= words.length) {
                        return false;
                    }
                    handle(words[this.index + 1] as string);
                    this.index += 2;
                    return true;
                }

                if (word.startsWith(name)) {
                    handle(word.slice(name.length));
                    this.index += 1;
                    return true;
                }

                return false;
            }
        }

        const result: Mutable<SourceFileConfigurationEx> = {
            includePath: [],
            defines: [],
            standard: build.defaultCppStandard,
            intelliSenseMode: build.defaultIntelliSenseMode,

            forcedInclude: undefined,
            compilerPath: isDevContainerHost() ? findCommandWord(): undefined,
            compilerArgs: undefined,
            compilerFragments: undefined,
            _compilerPath: isDevContainerHost() ? findCommandWord(): undefined,
            _command: words.map(normalizeArg),
        };

        // let nextIsIncludePath = false;
        // let nextIsDirAfterIncludePath = false;
        // let nextIsSysroot = false;
        const dirAfterIncludePaths: string[] = [];
        // sysroot affects paths, which started with '=' sign
        let sysroot: string | undefined = undefined;

        while (!optParser.done) {
            optParser.getOpt('--sysroot=', value => {sysroot = value;})
            || optParser.getOpt('--sysroot', value => {sysroot = value;})
            || optParser.getOpt('-I', value => {result.includePath.push(value);})
            || optParser.getOpt('-isystem', value => {result.includePath.push(value);})
            || optParser.getOpt('-iquote', value => {result.includePath.push(value);})
            || optParser.getOpt('-idirafter', value => {dirAfterIncludePaths.push(value);})
            || optParser.getOpt('-D', value => {result.defines.push(value);})
            || optParser.getOpt('-std=', value => {result.standard = value as cpptools.CppStandard;})
            || optParser.skip(); // unrecognized option, skip
        }

        result.includePath.push(...dirAfterIncludePaths);

        if (sysroot) {
            result.includePath = result.includePath.map(p => p.startsWith('=') ? path.join(sysroot!, p.substring(1)) : p);
        }

        return result;
    }

    public isFileListed(uri: vscode.Uri): boolean
    {
        return this.cache.has(path.normalize(uri.fsPath));
    }

    public getSourceFileConfiguration(uri: vscode.Uri): SourceFileConfigurationEx | null {
        const filePath = uri.fsPath;

        if (this.cache.size === 0)
            return null;

        const entry = this.cache.get(path.normalize(filePath));
        if (!entry) {
            // vscode.window.showWarningMessage(`No compile command found for ${filePath}. IntelliSense may not work correctly for this file.`);
            return null;
        }

        if (!entry.parsed && entry.source.command) {
            entry.parsed = this.parseCompileCommand(entry.source.command);
        }

        return entry.parsed;
    }

}
