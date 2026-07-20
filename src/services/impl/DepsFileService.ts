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


const enable = true;

export class DepsFileService implements IDepsFileService, vscode.Disposable
{
    private static readonly DEBOUNCE_DELAY_MS = 3000;

    private readonly context: vscode.ExtensionContext;
    private readonly _onChange = new vscode.EventEmitter<void>();
    private readonly fileWatcher: IWatchedFile<never>;
    private readonly settings: ISettingsService;
    private readonly disposables: vscode.Disposable[] = [];
    private deps: PairedDependencies | null = null;
    private disposed = false;
    private fileTime: number | null = null;
    private child: child_process.ChildProcessWithoutNullStreams | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
                this.scheduleReset();
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

        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        if (this.child) {
            this.child.kill('SIGTERM');
            this.child = null;
        }

        for (const disposable of this.disposables.splice(0).reverse()) {
            disposable.dispose();
        }
    }

    private scheduleReset(): void
    {
        // Eagerly kill any running process — its result will be ignored
        if (this.child) {
            this.child.kill('SIGTERM');
        }

        if (this.debounceTimer !== null) {
            // Burst mode: reset the debounce timer and wait before processing
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.debounceTimer = null;
                void this.resetFile();
            }, DepsFileService.DEBOUNCE_DELAY_MS);
        } else {
            // First change or quiet period: process immediately.
            // Set a guard timer so rapid follow-up changes enter burst mode.
            this.debounceTimer = setTimeout(() => {
                this.debounceTimer = null;
            }, DepsFileService.DEBOUNCE_DELAY_MS);
            void this.resetFile();
        }
    }

    // it would be better to load file using 'ninja -t deps' command, but it
    // seems to lock the '.ninja_deps' and/or '.ninja_log' files and prevents
    // build process to write to them, so for now we just read the file directly
    //
    // More details in the comments of the 'loadFile' method below
    private async loadFileDirectly(fileName: string, outputDir: string | undefined): Promise<PairedDependencies | null>
    {
        if (!outputDir)
            return Promise.resolve(null);

        const trimNullBytes = (str: string): string => {
            const nullIndex = str.indexOf('\0');
            return nullIndex >= 0 ? str.substring(0, nullIndex) : str;
        }
        type Entry = { name: string, mtime: bigint, deps: number[] };

        const paths = new Map<number, Entry>();
        const deps: Dependencies = {};
        const rdeps: Dependencies = {};

        // deal with file being written. Buffer should throw and error if access
        // out of range. Parser would stop and return what it has read so far.
        // We will try to read the file again on next change event.
        try {
            const currentVersion = 4;
            const buffer: Buffer = await fs.readFile(fileName);
            let offset = 0;

            const header = buffer.toString('utf8', offset, offset + 12);
            offset += 12;

            const version = buffer.readUInt32LE(offset);
            offset += 4;

            if (buffer.length < offset) {
                throw new Error(`Unexpected .ninja_deps file format: buffer too short`);
            }

            if (header !== '# ninjadeps\n' || version !== currentVersion) {
                throw new Error(`Unexpected .ninja_deps file format: header=${header}, version=${version}`);
            }

            while (offset < buffer.length) {
                const recordLength = buffer.readUInt32LE(offset);
                offset += 4;

                const isDeps = (recordLength & 0x80000000) !== 0;
                const size = recordLength & 0x7FFFFFFF;

                if (isDeps) {
                    if (size % 4 !== 0) {
                        throw new Error(`Unexpected .ninja_deps file format: deps record size is not a multiple of 4`);
                    }

                    // The ID of the path for which we're listing the dependencies.
                    const pathId = buffer.readUInt32LE(offset);
                    offset += 4;

                    // Followed by the mtime in nanoseconds as u64 (8 bytes) in version 4, or in seconds as u32 (4 bytes) in version 3.
                    // - On Windows, the year 2000 is used as the epoch instead of the Unix epoch.
                    // - The value 0 means 'does not exist'. 1 is used for mtimes that were actually 0.

                    const mtime = version === 4 ? buffer.readBigUInt64LE(offset) : BigInt(buffer.readUInt32LE(offset));
                    offset += version === 4 ? 8 : 4;

                    // Followed by the IDs of all the dependencies (paths).
                    let numDeps = (size - (version === 4 ? 12 : 8)) / 4;

                    const pathEntry = paths.get(pathId);
                    if (!pathEntry) {
                        throw new Error(`Unexpected .ninja_deps file format: path ID ${pathId} not found`);
                    }

                    pathEntry.mtime = mtime;
                    pathEntry.deps = [];
                    for (let i = 0; i < numDeps; i++) {
                        const depId = buffer.readUInt32LE(offset);
                        offset += 4;

                        // console.log(`Dependency record: ${pathId} -> ${depId}, mtime=${mtime}`);
                        pathEntry.deps.push(depId);
                    }
                }
                else { // path record
                    if (size <= 4) {
                        throw new Error(`Unexpected .ninja_deps file format: path record size is zero`);
                    }

                    const pathLength = size - 4;
                    const pathStr = trimNullBytes(buffer.toString('utf8', offset, offset + pathLength));
                    offset += pathLength;

                    // the last 4 bytes are ID (2-complemented)
                    const id = ~buffer.readUInt32LE(offset);
                    offset += 4;

                    // console.log(`Path record: ${pathStr} -> ${id}`);
                    paths.set(id, {
                        name: pathStr,
                        mtime: BigInt(0),
                        deps: [],
                    });
                }
            }
        }

        catch (err) {
            // This might happen if the build process is running and the .ninja_deps file is being written
            // to while we are reading it.
            //
            console.error(`Failed to read .ninja_deps file: ${err}. Ignore and wait for next change event.`);
        }

        // resolve all paths to absolute paths
        for (const entry of paths.values()) {
            entry.name = path.resolve(outputDir, entry.name);
        }

        // finally transform dependencies
        for (const [id, entry] of paths.entries()) {
            const target = entry.name;

            entry.deps.map(depId => {
                const depEntry = paths.get(depId);
                return depEntry ? depEntry.name : null;
            }).filter(depName => depName !== null).forEach(depName => {
                const dep = depName!;
                if (!deps[target]) {
                    deps[target] = [];
                }
                deps[target].push(dep);

                if (!rdeps[dep]) {
                    rdeps[dep] = [];
                }
                rdeps[dep].push(target);
            });
        }
        return { deps, rdeps };
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

        if (!enable)
            return;

        if (this.fileTime === null || mtime > this.fileTime) {
            this.fileTime = mtime;
            const data = await this.loadFileDirectly(fileName, this.settings.get(Setting.outputDir));
            // const data = await this.loadFile(this.context, this.settings.get(Setting.outputDir));
            if (mtime === this.fileTime) {
                this.deps = data;
                this._onChange.fire();
            }
        }
    }

    private async killAndWait(signal: NodeJS.Signals = 'SIGTERM') {
        // If the process already exited, resolve immediately
        const child = this.child;
        if (!child || child.exitCode !== null || child.signalCode !== null) {
            return;
        }

        return new Promise((resolve) => {
            // 'close' ensures stdio streams are also completely closed
            child.on('close', (code, signal) => {
                resolve({ code, signal });
            });

            // Send the kill signal to the child process
            child.kill(signal);
        });
    }

    // it might interfere with build process, disable for now
    //
    // IF I run that concurrently with build process, for some reasons
    // '.ninja_log' file stops to appear in the output folder, and if ninja is
    // run with '-t explain' options, it shows following lines:
    //
    // ```
    // ninja explain: command line not found in log for obj/components/common_runtime/src/crt/core.ArgumentList.o
    // ninja explain: obj/components/common_runtime/src/crt/core.ArgumentList.o is dirty
    // ...
    // ```
    //
    // The suspect is that the 'ninja -t deps' locks the '.ninja_deps' file and
    // the build process cannot write to it while the DepsFileService is reading
    // it
    //
    // Workaround is to make a copy of the '.ninja_deps' file and read from that
    // copy. However that seems to require copying '.ninja_deps' along with all
    // '*.ninja' files including the toolchain.ninja, and these, which are
    // located in the subfolders of the 'obj' folder.
    //
    // So here i am reading the '.ninja_deps' file directly. Hope it would not change
    // format in the future.
    //
    private async loadFile(context: vscode.ExtensionContext, outputDir: string | undefined): Promise<PairedDependencies | null>
    {
        if (!outputDir) {
            return Promise.resolve(null);
        }

        if (this.child) {
            await this.killAndWait();
            this.child = null;
        }

        const ninja = await getBundledNinjaPath(context);

        return new Promise((resolve, reject) => {
            const that_child = child_process.spawn(ninja, ['-t', 'deps'], { cwd: outputDir, shell: false });
            this.child = that_child;

            let output = '';
            that_child.stdout.on('data', (data) => {
                output += data.toString();
            });

            that_child.stderr.on('data', (data) => {
                if (that_child === this.child) {
                    console.error(`Ninja process error: ${data.toString()}`);
                }
            });

            that_child.on('error', (err) => {
                if (that_child === this.child) {
                    console.error(`Failed to start Ninja process: ${err}`);
                }
                resolve(null);
            });

            that_child.on('close', (code) => {
                if (code !== 0) {
                    if (that_child === this.child) {
                        console.error(`Ninja process exited with code ${code}`);
                    }
                    resolve(null);
                    return;
                }

                if (that_child !== this.child) {
                    resolve(null);
                    return;
                }

                const deps = parseNinjaDeps(output, outputDir);
                this.child = null;
                resolve(deps);
            });
        });
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
