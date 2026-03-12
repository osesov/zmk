import * as vscode from 'vscode';

// watches both zmk builder and 'gnb' tasks running
export interface IBuildStatusService
{
    onBuildComplete: vscode.Event<boolean>
}
