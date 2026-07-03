import * as child_process from "child_process";
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from "vscode";
import { AppServices, AppServiceContainer } from "../AppServices";
import { ISettingsService, Setting, SettingChangeEvent } from "../ISettingsService";
import { IWatchedFile } from "../IFileService";
import { IDepsFileService } from "../IDepsFileService";
import { getBundledNinjaPath } from "../../components/ninja";

export type DepsFileServiceDeps = Pick<AppServices, 'fs' | 'settings' | 'context'>;

export function createDepsFileService(services: AppServiceContainer): DepsFileService
{
    return new DepsFileService({
        fs: services.get('fs'),
        settings: services.get('settings'),
        context: services.get('context'),
    });
}

type Dependencies = {
    [key: string]: string[];
};

type PairedDependencies = {
    deps: Dependencies;
    rdeps: Dependencies;
};

const fileName = '.ninja_deps';

function parseFile(): never {
    throw new Error("Not implemented yet");
}

function parseNinjaDeps(output: string, outputDir: string): PairedDependencies {
    const resolveFile = (filePath: string): string => {
        return path.resolve(outputDir, filePath);
    }

    const deps: Dependencies = {};
    const rdeps: Dependencies = {};

    const lines = output.split('\n');
    let target : string | null = null;

    // Parse file in following format:
    // ```deps
    // obj/components/powerup-library/sources/basic/basic.DefaultValue.o: #deps 2, deps mtime 1783078816420249070 (VALID)
    //     ../components/powerup-library/sources/basic/DefaultValue.cpp
    //     ../components/powerup-library/library/basic/DefaultValue.h
    //
    // obj/components/powerup-library/sources/basic/basic.Command.o: #deps 2, deps mtime 1783078816422249078 (VALID)
    //     ../components/powerup-library/sources/basic/Command.cpp
    //     ../components/powerup-library/library/basic/Command.h
    // ...
    // ```

    for (const line of lines) {
        if (line.trim() === '') {
            continue;
        }

        if (!line.startsWith(' ')) {
            // This is a target line
            const parts = line.split(':');
            if (parts.length > 0) {
                target = resolveFile(parts[0].trim());
                deps[target] = [];
            }
        } else if (target) {
            // This is a dependency line
            const dep = resolveFile(line.trim());
            deps[target].push(dep);

            if (!rdeps[dep]) {
                rdeps[dep] = [];
            }
            rdeps[dep].push(target);
        }
    }

    return { deps, rdeps };
}

async function loadFile(context: vscode.ExtensionContext, outputDir: string | undefined): Promise<PairedDependencies | null>
{
    if (!outputDir) {
        return Promise.resolve(null);
    }

    const ninja = await getBundledNinjaPath(context);

    return new Promise((resolve, reject) => {
        const child = child_process.spawn(ninja, ['-t', 'deps'], { cwd: outputDir });

        let output = '';
        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            console.error(`Ninja process error: ${data.toString()}`);
        });

        child.on('error', (err) => {
            console.error(`Failed to start Ninja process: ${err}`);
            resolve(null);
        });

        child.on('close', (code) => {
            if (code !== 0) {
                console.error(`Ninja process exited with code ${code}`);
                resolve(null);
                return;
            }

            const deps = parseNinjaDeps(output, outputDir);
            resolve(deps);
        });
    });
}

async function getFileMTime(filePath: string): Promise<number | null> {
    try {
        const stats = await fs.stat(filePath);
        return stats.mtimeMs;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            // File does not exist
            return null;
        }
        throw err;
    }
}

export class DepsFileService implements IDepsFileService, vscode.Disposable
{
    private readonly context: vscode.ExtensionContext;
    private readonly _onChange = new vscode.EventEmitter<void>();
    private readonly fileWatcher: IWatchedFile<never>;
    private readonly settings: ISettingsService;
    private readonly disposables: vscode.Disposable[] = [];
    private deps: PairedDependencies | null = null;
    private disposed = false;
    private fileTime: number | null = null;

    public readonly onChange: vscode.Event<void> = this._onChange.event;

    constructor(services: DepsFileServiceDeps)
    {
        this.context = services.context;
        this.settings = services.settings;
        this.fileWatcher = services.fs.createWatchedFile(fileName, parseFile);

        this.disposables.push(
            this.fileWatcher,
            this._onChange,
            this.settings.onChange((event: SettingChangeEvent) => {
                if (event.affects(Setting.outputDir)) {
                    this.fileWatcher.setBaseDir(this.settings.get(Setting.outputDir));
                }
            }),
            this.fileWatcher.onChange(() => {
                this.resetFile();
            }),
        );

        this.fileWatcher.setBaseDir(this.settings.get(Setting.outputDir));
        this.resetFile();
        services.context.subscriptions.push(this);
    }

    public dispose(): void
    {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        this.fileTime = null;
        this.deps = null;

        for (const disposable of this.disposables.splice(0).reverse()) {
            disposable.dispose();
        }
    }

    private async resetFile(): Promise<void>
    {

        const fileName = this.fileWatcher.filePath;

        if (this.disposed) {
            return;
        }

        if (!fileName) {
            if (this.deps !== null) {
                this.deps = null;
                this._onChange.fire();
            }
            return;
        }

        const mtime = await getFileMTime(fileName);
        if (mtime === null) {
            if (this.deps !== null) {
                this.deps = null;
                this._onChange.fire();
            }
            return;
        }

        if (this.fileTime == null || mtime > this.fileTime) {
            this.fileTime = mtime;
            const data = await loadFile(this.context, this.settings.get(Setting.outputDir));
            if (mtime === this.fileTime) {
                this.deps = data;
                this._onChange.fire();
            }
        }
    }

    public get loaded(): boolean
    {
        return this.deps !== null;
    }

    public isKnownFile(uri: vscode.Uri): boolean
    {
        if (!this.deps) {
            return false;
        }

        const filePath = uri.fsPath;
        return this.deps.rdeps.hasOwnProperty(filePath);
    }

}
