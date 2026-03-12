import * as vscode from 'vscode';
import { ServiceContainer } from '../ServiceContainer';
import { AppServices } from '../AppServices';
import { IVirtualDocumentProvider } from '../IVirtualDocumentProvider';

const documentSchema = 'valhalla';

export class VirtualDocumentProvider implements vscode.TextDocumentContentProvider, IVirtualDocumentProvider
{
    private onDidChangeEvent = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEvent.event;

    private documentContentMap = new Map<string, string>();

    constructor(services: ServiceContainer<AppServices>)
    {
        vscode.workspace.registerTextDocumentContentProvider(documentSchema, this);
    }

    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string>
    {
        return this.documentContentMap.get(uri.toString()) || '';
    }

    uri(path: string): vscode.Uri
    {
        return vscode.Uri.from({ scheme: documentSchema, path });
    }

    update(path: string, text: string): vscode.Uri
    {
        const uri = this.uri(path);
        this.documentContentMap.set(uri.toString(), text);
        this.onDidChangeEvent.fire(uri);
        return uri;
    }
}
