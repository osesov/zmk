import * as vscode from 'vscode';
import { AppServiceContainer, AppServices } from '../AppServices';
import { IVirtualDocumentProvider } from '../IVirtualDocumentProvider';

const documentSchema = 'valhalla';

type VirtualDocumentProviderDeps = Pick<AppServices, 'context'>;

export function createVirtualDocumentProvider(services: AppServiceContainer): VirtualDocumentProvider
{
    return new VirtualDocumentProvider({
        context: services.get('context'),
    });
}

export class VirtualDocumentProvider implements vscode.TextDocumentContentProvider, IVirtualDocumentProvider
{
    private onDidChangeEvent = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEvent.event;

    private documentContentMap = new Map<string, string>();

    constructor(deps: VirtualDocumentProviderDeps)
    {
        deps.context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider(documentSchema, this)
        );
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
