import * as vscode from 'vscode';

import { AppServiceContainer, AppServices } from "../AppServices";
import { Setting } from "../ISettingsService";
import { IUpdateService } from "../IUpdateService";

const repoName = 'osesov/zmk';
const apiRepo = `https://api.github.com/repos/${repoName}`;

enum UpdateCheckResult {
    NoUpdate,
    UpdateAvailable,
    Error
}

type GithubReleaseAsset = {
    name: string;
    browser_download_url: string;
};

type GithubRelease = {
    tag_name: string;
    html_url: string;
    assets: GithubReleaseAsset[];
};

type UpdateResult = {
    ok: UpdateCheckResult.UpdateAvailable
    version: string;
    release: GithubRelease;
    vsix: GithubReleaseAsset;
} | {
    ok: UpdateCheckResult.NoUpdate
} | {
    ok: UpdateCheckResult.Error;
    error: string;
}

function latestReleaseURL(): string
{
    return `${apiRepo}/releases/latest`;
}

type UpdateServiceDeps = Pick<AppServices, 'settings' | 'context'>;

export function createUpdateService(services: AppServiceContainer): UpdateService
{
    return new UpdateService({
        settings: services.get('settings'),
        context: services.get('context'),
    });
}

export class UpdateService implements IUpdateService
{
    constructor(private deps: UpdateServiceDeps)
    {
        this.checkForUpdatesAndNotify();
    }

    async checkForUpdatesAndNotify(): Promise<void>
    {
        const result = await this.checkForUpdates();
        if (result.ok === UpdateCheckResult.UpdateAvailable) {
            const message = `A new version of the ZMK extension is available: ${result.version}. Please update to the latest version for the best experience.`;
            vscode.window.showInformationMessage(message, 'View on GitHub').then(selection => {
                if (selection === 'View on GitHub') {
                    vscode.env.openExternal(vscode.Uri.parse(result.release.html_url));
                }
            });

            // vscode.window.showInformationMessage(message, 'Update Now').then(async selection => {
            //     if (selection === 'Update Now') {
            //         // need to download the vsix locally and install it
            //         await vscode.commands.executeCommand('workbench.extensions.installExtension', result.vsix.browser_download_url);
            //         vscode.window.showInformationMessage('The update has been installed. Please reload VS Code to apply the update.', 'Reload Now').then(reloadSelection => {
            //             if (reloadSelection === 'Reload Now') {
            //                 vscode.commands.executeCommand('workbench.action.reloadWindow');
            //             }
            //         });
            //     }
            // });
        }
        else if (result.ok === UpdateCheckResult.Error) {
            vscode.window.showErrorMessage('Failed to check for updates. Please try again later.');
        }
    }

    private compareVersions(v1: string, v2: string): number
    {
        const v1Parts = v1.split('.').map(Number);
        const v2Parts = v2.split('.').map(Number);
        const length = Math.max(v1Parts.length, v2Parts.length);

        for (let i = 0; i < length; i++) {
            const v1Part = v1Parts[i] || 0;
            const v2Part = v2Parts[i] || 0;
            if (v1Part > v2Part) return 1;
            if (v1Part < v2Part) return -1;
        }
        return 0;
    }

    async checkForUpdates(): Promise<UpdateResult>
    {
        // once a day check for updates

        try {

            const settings = this.deps.settings;
            const updateCheckTime = settings.get(Setting.lastUpdateCheck);
            const currentVersion = this.deps.context.extension.packageJSON.version;
            const now = new Date;

            if (updateCheckTime) {
                const updateCheckDate = new Date(updateCheckTime);
                if (now.toDateString() === updateCheckDate.toDateString()) {
                    return { ok: UpdateCheckResult.NoUpdate };
                }
            }

            const githubResponse = await fetch(latestReleaseURL());
            if (!githubResponse.ok) {
                console.error('Failed to check for updates: ', githubResponse.statusText);
                return { ok: UpdateCheckResult.Error, error: githubResponse.statusText };
            }
            const githubData: GithubRelease = await githubResponse.json() as GithubRelease;
            console.log(githubData);

            const availableVersion = githubData.tag_name.startsWith('v') ? githubData.tag_name.substring(1) : githubData.tag_name;

            if (this.compareVersions(availableVersion, currentVersion) <= 0) {
                return { ok: UpdateCheckResult.NoUpdate };
            }

            const vsix = githubData.assets.find(asset => asset.name.endsWith('.vsix'));

            if (!vsix) {
                console.error('No .vsix asset found in the latest release');
                return { ok: UpdateCheckResult.Error, error: 'No .vsix asset found in the latest release' };
            }

            return { ok: UpdateCheckResult.UpdateAvailable, version: availableVersion, release: githubData, vsix: vsix };
        }
        catch (error) {
            console.error('Failed to check for updates:', error);
            return { ok: UpdateCheckResult.Error, error: (error as Error).message };
        }

        finally {
            this.deps.settings.updateGlobalState(Setting.lastUpdateCheck, new Date().toISOString());
        }
    }

}
