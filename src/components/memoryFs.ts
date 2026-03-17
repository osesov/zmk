import * as vscode from 'vscode';

type Entry = FileEntry | DirectoryEntry;

class FileEntry {
    public readonly type = vscode.FileType.File;
    public ctime = Date.now();
    public mtime = Date.now();
    public size = 0;

    constructor(public data: Uint8Array = new Uint8Array()) {
        this.size = data.byteLength;
    }
}

class DirectoryEntry {
    public readonly type = vscode.FileType.Directory;
    public ctime = Date.now();
    public mtime = Date.now();
    public size = 0;
    public readonly entries = new Map<string, Entry>();
}

export class MemoryFileSystemProvider implements vscode.FileSystemProvider
{
    private readonly root = new DirectoryEntry();
    private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    public readonly onDidChangeFile = this.emitter.event;

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        return this.lookup(uri, false);
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const dir = this.lookupAsDirectory(uri, false);
        return [...dir.entries].map(([name, entry]) => [name, entry.type]);
    }

    createDirectory(uri: vscode.Uri): void {
        const basename = this.basename(uri);
        const parent = this.lookupParentDirectory(uri);
        if (!parent.entries.has(basename)) {
            parent.entries.set(basename, new DirectoryEntry());
            this.fireSoon({ type: vscode.FileChangeType.Created, uri });
        }
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const file = this.lookupAsFile(uri, false);
        return file.data;
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void {
        const basename = this.basename(uri);
        const parent = this.lookupParentDirectory(uri);
        const existing = parent.entries.get(basename);

        if (existing instanceof DirectoryEntry) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }

        if (!existing && !options.create) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        if (existing && !options.overwrite) {
            throw vscode.FileSystemError.FileExists(uri);
        }

        const file = existing instanceof FileEntry ? existing : new FileEntry();
        file.mtime = Date.now();
        file.data = content;
        file.size = content.byteLength;
        parent.entries.set(basename, file);

        this.fireSoon({
            type: existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created,
            uri,
        });
    }

    delete(uri: vscode.Uri, options: { recursive: boolean }): void {
        const basename = this.basename(uri);
        const parent = this.lookupParentDirectory(uri);
        if (!parent.entries.delete(basename)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        this.fireSoon({ type: vscode.FileChangeType.Deleted, uri });
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        const entry = this.lookup(oldUri, false);
        const oldParent = this.lookupParentDirectory(oldUri);
        const newParent = this.lookupParentDirectory(newUri);
        const newName = this.basename(newUri);

        if (!options.overwrite && newParent.entries.has(newName)) {
            throw vscode.FileSystemError.FileExists(newUri);
        }

        oldParent.entries.delete(this.basename(oldUri));
        newParent.entries.set(newName, entry);

        this.fireSoon(
            { type: vscode.FileChangeType.Deleted, uri: oldUri },
            { type: vscode.FileChangeType.Created, uri: newUri }
        );
    }

    private lookup(uri: vscode.Uri, silent: false): Entry;
    private lookup(uri: vscode.Uri, silent: boolean): Entry | undefined;
    private lookup(uri: vscode.Uri, silent: boolean): Entry | undefined {
        const parts = uri.path.split('/').filter(Boolean);
        let entry: Entry = this.root;

        for (const part of parts) {
            if (!(entry instanceof DirectoryEntry)) {
                throw vscode.FileSystemError.FileNotADirectory(uri);
            }

            const child = entry.entries.get(part);
            if (!child) {
                if (silent) {
                    return undefined;
                }
                throw vscode.FileSystemError.FileNotFound(uri);
            }

            entry = child;
        }

        return entry;
    }

    private lookupAsDirectory(uri: vscode.Uri, silent: boolean): DirectoryEntry {
        const entry = this.lookup(uri, silent);
        if (!entry || !(entry instanceof DirectoryEntry)) {
            throw vscode.FileSystemError.FileNotADirectory(uri);
        }
        return entry;
    }

    private lookupAsFile(uri: vscode.Uri, silent: boolean): FileEntry {
        const entry = this.lookup(uri, silent);
        if (!entry || !(entry instanceof FileEntry)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return entry;
    }

    private lookupParentDirectory(uri: vscode.Uri): DirectoryEntry {
        const parent = uri.with({ path: uri.path.replace(/\/[^/]+$/, '') || '/' });
        return this.lookupAsDirectory(parent, false);
    }

    private basename(uri: vscode.Uri): string {
        const idx = uri.path.lastIndexOf('/');
        return idx >= 0 ? uri.path.slice(idx + 1) : uri.path;
    }

    private fireSoon(...events: vscode.FileChangeEvent[]): void {
        this.emitter.fire(events);
    }
}
