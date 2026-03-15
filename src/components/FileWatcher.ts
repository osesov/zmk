import path from 'path';
import fs from 'fs';
import * as vscode from 'vscode';

export class FileWatcher implements vscode.Disposable
{
    private _watcher: vscode.FileSystemWatcher | null = null;
    private readonly _onChange = new vscode.EventEmitter<void>();
    private baseDir: string | null | undefined = null;

    constructor(private readonly fileName: string)
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

        this.setupWatcher();
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

        const dir = this.baseDir;
        const fileName = this.fileName;

        this._watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(dir, fileName),
            false, false, false);

        this._watcher.onDidCreate(() => this._onChange.fire());
        this._watcher.onDidChange(() => this._onChange.fire());
        this._watcher.onDidDelete(() => this._onChange.fire());
    }

    public get filePath(): string | null {
        if (!this.baseDir) {
            return null;
        }

        return path.join(this.baseDir, this.fileName);
    }

    public getContent(): string | null
    {
        const filePath = this.filePath;

        if (!filePath || !fs.existsSync(filePath))
            return null;

        return fs.readFileSync(filePath, 'utf-8');
    }

    public async getContentAsync(): Promise<string | null>
    {
        const filePath = this.filePath;

        if (!filePath)
            return null;

        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
        } catch {
            return null;
        }

        return fs.promises.readFile(filePath, 'utf-8');
    }
}
