import path from 'node:path';
import * as vscode from 'vscode';

enum FileState
{
    created,
    changed,
    deleted
}

export class ExternalFile<T> implements vscode.Disposable
{
    private _mtime: number | null = null;
    private _content: T | null = null;
    private _parentDir: string | undefined | null = null;
    private _watcher: vscode.FileSystemWatcher | null = null;
    private readonly _onChange = new vscode.EventEmitter<FileState>();

    constructor(
        public readonly name: string,
        private fileName: string,
        private readonly parser: (content: string) => Promise<T>)
    {
    }

    dispose() {
        if (this._watcher) {
            this._watcher.dispose();
            this._watcher = null;
        }

        this._onChange.dispose();
    }

    private setupWatcher()
    {
        if (this._watcher) {
            this._watcher.dispose();
            this._watcher = null;
        }

        if (this._parentDir) {
            this._watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this._parentDir, this.fileName),
                false, false, false);

            this._watcher.onDidCreate(() => this.invalidate());
            this._watcher.onDidChange(() => this.invalidate());
            this._watcher.onDidDelete(() => this.invalidate());
        }
    }

    private invalidate()
    {
        this._mtime = null;
        this._content = null;
        this._onChange.fire(FileState.deleted);
    }

    async getContent(parentDir ?: string | undefined | null): Promise<T | null>
    {
        try {
            if (parentDir !== undefined) {
                this.parentDir = parentDir;
            }

            if (!this._parentDir) {
                return null;
            }

            const fullPath = path.join(this._parentDir, this.fileName);
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
            if (this._mtime !== stat.mtime) {
                const contentBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fullPath));
                const contentStr = Buffer.from(contentBytes).toString('utf-8');
                this._content = await this.parser(contentStr);
                this._mtime = stat.mtime;
            }
            return this._content;
        } catch (err) {
            this.invalidate();
            return null;
        }
    }

    get parentDir(): string | undefined | null
    {
        return this._parentDir;
    }

    set parentDir(dir: string | undefined | null)
    {
        if (dir === this._parentDir) {
            return;
        }

        this._parentDir = dir;
        this.setupWatcher();
    }

    get onChange(): vscode.Event<FileState>
    {
        return this._onChange.event;
    }
}
