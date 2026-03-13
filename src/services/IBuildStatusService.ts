import * as vscode from 'vscode';
import { CompletableFeature } from '../components/promise';

// watches both zmk builder and 'gnb' tasks running
export interface IBuildStatusService
{
    initialBuildStatus: CompletableFeature<boolean>;
    onBuildComplete: vscode.Event<boolean>
}
