import * as vscode from 'vscode';
import { MemoryFileSystemProvider } from '../../components/memoryFs';
import { IReviewService } from '../IReviewService';
import { AppServiceContainer, AppServices } from '../AppServices';
import { zmkCommand } from '../../components/constants';

type ReviewSession = {
    id: string;
    originalUri: vscode.Uri;
    previewUri: vscode.Uri;
    title: string;
};

export class ReviewManager implements vscode.Disposable
{
    private readonly sessions = new Map<string, ReviewSession>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {
        this.disposables.push(
            vscode.commands.registerCommand(zmkCommand.reviewApply, async (uri?: vscode.Uri) => {
                let sessionId = uri?.query;
                if (!sessionId) {
                    sessionId = this.findSessionIdForActiveEditor();
                }
                if (!sessionId) {
                    void vscode.window.showWarningMessage('No active review session.');
                    return;
                }
                await this.apply(sessionId);
            }),

            vscode.commands.registerCommand(zmkCommand.reviewKeepOriginal, async (uri?: vscode.Uri) => {
                let sessionId = uri?.query;
                if (!sessionId) {
                    sessionId = this.findSessionIdForActiveEditor();
                }
                if (!sessionId) {
                    void vscode.window.showWarningMessage('No active review session.');
                    return;
                }
                await this.keepOriginal(sessionId);
            }),

            vscode.workspace.onDidCloseTextDocument((doc) => {
                // Clean up abandoned preview docs when appropriate.
                if (doc.uri.scheme !== ReviewManager.previewScheme) {
                    return;
                }

                const session = [...this.sessions.values()].find(s => s.previewUri.toString() === doc.uri.toString());
                if (session) {
                    this.sessions.delete(session.id);
                }
            })
        );
    }

    public dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.sessions.clear();
    }

    public static readonly previewScheme = 'zmk-review';

    public async reviewTextDocument(
        originalUri: vscode.Uri,
        proposedText: string,
        title?: string
    ): Promise<string> {
        if (!title)
            title = 'Review Changes';
        const originalDoc = await vscode.workspace.openTextDocument(originalUri);

        const sessionId = this.createSessionId();
        const previewUri = originalUri.with({
            scheme: ReviewManager.previewScheme,
            path: originalUri.path,
            query: sessionId
        });

        await this.writePreview(previewUri, proposedText);

        const session: ReviewSession = {
            id: sessionId,
            originalUri,
            previewUri,
            title,
        };
        this.sessions.set(sessionId, session);

        await vscode.commands.executeCommand(
            'vscode.diff',
            originalUri,
            previewUri,
            title,
            {
                preview: false,
                preserveFocus: false,
            } satisfies vscode.TextDocumentShowOptions
        );

        return sessionId;
    }

    private async apply(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            void vscode.window.showWarningMessage('Review session not found.');
            return;
        }

        const previewDoc = await vscode.workspace.openTextDocument(session.previewUri);
        const originalDoc = await vscode.workspace.openTextDocument(session.originalUri);

        const fullRange = new vscode.Range(
            originalDoc.positionAt(0),
            originalDoc.positionAt(originalDoc.getText().length)
        );

        const edit = new vscode.WorkspaceEdit();
        edit.replace(session.originalUri, fullRange, previewDoc.getText());

        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) {
            void vscode.window.showErrorMessage('Failed to apply reviewed changes.');
            return;
        }

        await originalDoc.save().then(() => undefined, () => undefined);
        await this.closeVisibleReviewEditors(session);
        this.sessions.delete(sessionId);

        void vscode.window.showInformationMessage('Changes applied.');
    }

    private async keepOriginal(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }

        await this.closeVisibleReviewEditors(session);
        this.sessions.delete(sessionId);

        void vscode.window.showInformationMessage('Original kept.');
    }

    private async closeVisibleReviewEditors(session: ReviewSession): Promise<void> {
        const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);

        for (const tab of tabs) {
            const input = tab.input;

            if (input instanceof vscode.TabInputTextDiff) {
                const left = input.original.toString();
                const right = input.modified.toString();

                const a = session.originalUri.toString();
                const b = session.previewUri.toString();

                if (
                    (left === a && right === b) ||
                    (left === b && right === a)
                ) {
                    await vscode.window.tabGroups.close(tab, true);
                }
            } else if (input instanceof vscode.TabInputText) {
                const uri = input.uri.toString();
                if (uri === session.previewUri.toString()) {
                    await vscode.window.tabGroups.close(tab, true);
                }
            }
        }
    }

    private findSessionIdForActiveEditor(): string | undefined {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
            return undefined;
        }

        if (uri.scheme === ReviewManager.previewScheme) {
            return uri.query || undefined;
        }

        for (const session of this.sessions.values()) {
            if (session.originalUri.toString() === uri.toString()) {
                return session.id;
            }
        }

        return undefined;
    }

    private async writePreview(uri: vscode.Uri, text: string): Promise<void> {
        // Requires a FileSystemProvider for custom scheme.
        const bytes = Buffer.from(text, 'utf8');
        await vscode.workspace.fs.writeFile(uri, bytes);
    }

    private createSessionId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

export class ReviewService implements IReviewService
{
    private readonly reviewManager: ReviewManager;

    constructor(deps: Pick<AppServices, 'context'>)
    {
        const memfs = new MemoryFileSystemProvider();
        const context = deps.context;

        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(
                ReviewManager.previewScheme,
                memfs,
                { isCaseSensitive: true }
            )
        );

        this.reviewManager = new ReviewManager(context);
        context.subscriptions.push(this.reviewManager);
    }

    public async reviewTextDocument(
        originalUri: vscode.Uri,
        proposedText: string,
        title?: string
    ): Promise<string> {
        return await this.reviewManager.reviewTextDocument(originalUri, proposedText, title);
    }

}

export function createReviewService(services: AppServiceContainer): ReviewService
{
    return new ReviewService({
        context: services.get('context'),
    });
}
