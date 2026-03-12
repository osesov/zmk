import * as vscode from 'vscode';

export const documentSchema = 'valhalla';

export interface IVirtualDocumentProvider
{
    uri(path: string): vscode.Uri;
    update(path: string, text: string): vscode.Uri;
}
