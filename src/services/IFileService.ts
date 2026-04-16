import * as vscode from 'vscode';

export interface IWatchedFile<T> extends vscode.Disposable
{
    readonly onChange: vscode.Event<void>;
    readonly filePath: string | null;

    setBaseDir(baseDir: string | null | undefined): void;
    read(): Promise<T | null>;
}

export type FileParser<T> = (content: string) => T | Promise<T>;

export interface IFileService
{
    createWatchedFile<T = string>(
        fileName: string,
        parser?: FileParser<T>,
    ): IWatchedFile<T>;
}
