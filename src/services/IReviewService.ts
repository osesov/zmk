import * as vscode from 'vscode';

export interface IReviewService
{
    reviewTextDocument(
        originalUri: vscode.Uri,
        proposedText: string,
        title?: string
    ): Promise<string>
}
