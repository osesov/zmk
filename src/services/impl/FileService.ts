import path from 'node:path';
import * as vscode from 'vscode';
import { FileParser, IFileService, IWatchedFile } from '../IFileService';

export function stringParser(content: string): string
{
    return content;
}

export class FileWatcher<T = string> implements IWatchedFile<T>
{
    private _watcher: vscode.FileSystemWatcher | null = null;
    private readonly _onChange = new vscode.EventEmitter<void>();
    private baseDir: string | null | undefined = null;
    private _content: T | null = null;
    private _mtime: number | null = null;
    private hasCachedContent = false;

    constructor(
        private readonly fileName: string,
        private readonly parser: FileParser<T>,
    )
    {
    }

    dispose() {
        if (this._watcher) {
            this._watcher.dispose();
            this._watcher = null;
        }

        this._onChange.dispose();
    }

    get onChange(): vscode.Event<void> {
        return this._onChange.event;
    }

    public setBaseDir(baseDir: string | null | undefined)
    {
        if (this.baseDir === baseDir) {
            return;
        }

        this.baseDir = baseDir;
        this.resetCache();
        this.setupWatcher();
        this.invalidate();
    }

    private setupWatcher()
    {
        if (this._watcher) {
            this._watcher.dispose();
            this._watcher = null;
        }

        if (!this.baseDir || !this.fileName) {
            return;
        }

        this._watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.baseDir, this.fileName),
            false, false, false);

        this._watcher.onDidCreate(() => this.invalidate());
        this._watcher.onDidChange(() => this.invalidate());
        this._watcher.onDidDelete(() => this.invalidate());
    }

    public get filePath(): string | null {
        if (!this.baseDir) {
            return null;
        }

        return path.join(this.baseDir, this.fileName);
    }

    public async read(): Promise<T | null>
    {
        const filePath = this.filePath;
        if (!filePath) {
            this.resetCache();
            return null;
        }

        try {
            const uri = vscode.Uri.file(filePath);
            const stat = await vscode.workspace.fs.stat(uri);

            if (this.hasCachedContent && this._mtime === stat.mtime) {
                return this._content;
            }

            const contentBytes = await vscode.workspace.fs.readFile(uri);
            const contentStr = Buffer.from(contentBytes).toString('utf-8');

            this._content = await this.parser(contentStr);
            this._mtime = stat.mtime;
            this.hasCachedContent = true;

            return this._content;
        } catch {
            this.resetCache();
            return null;
        }
    }

    private invalidate(): void
    {
        this.resetCache();
        this._onChange.fire();
    }

    private resetCache(): void
    {
        this._content = null;
        this._mtime = null;
        this.hasCachedContent = false;
    }
}

export function createFileService(): IFileService
{
    return new FileService();
}

export class FileService implements IFileService
{
    createWatchedFile<T = string>(fileName: string, parser: FileParser<T>): IWatchedFile<T>
    {
        return new FileWatcher(fileName, parser);
    }
}
