import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
			fs.exists(file, (value) => {
					resolve(value);
			});
	});
}

async function findProjectRoot(p: string) : Promise<string> {
	while(true) {
		let file = path.resolve(p, ".gn");

		if (await exists(file)) {
				return p;
		}
		
		let n = path.dirname(p);

		if (p === n) {
				throw new Error("Path not found");
		} else {
				p = n;
		}
	}
}

async function listConfigs() : Promise<string[]> {
	const rootDir: string | undefined = vscode.workspace.getConfiguration().get("zmk.rootDir")
	if (rootDir == undefined)
		return [];

	let configDir = path.resolve(rootDir, "configs");

	return new Promise<string[]>((resolve, _reject) => {
			fs.readdir( configDir, (err, files) => {
					let result : string[] = [];

					files.forEach( file => {
							if (file.endsWith(".yaml") && fs.statSync(path.resolve(configDir, file)).isFile()) {
									console.log(`File: ${file}`);
									result.push(file.substr(0,file.length-5));
							}
					});

					resolve(result);        
			});
	});
}

async function updateConfig() {
	let configuration = vscode.workspace.getConfiguration()

	const quickPick = vscode.window.createQuickPick();
	const options = await listConfigs()
	const current = configuration.get('zmk.config')

	const result = await vscode.window.showQuickPick(options, { canPickMany: false })

	if (result == undefined) {
		return
	}

	console.log(`selected: ${result}`)
	vscode.window.showInformationMessage(`Selected: ${result}`);

	const ok = await configuration.update("zmk.config", result, vscode.ConfigurationTarget.Workspace)
	console.log(`status is ${ok} = ` + configuration.get("zmk.config"))
	loadConfig()
}

async function loadConfig() {
	let configuration = vscode.workspace.getConfiguration()

	const workspaceRoot = vscode.workspace.rootPath
	if (workspaceRoot == undefined)
		return;

	const config = configuration.get("zmk.config");

	const rootDir = await findProjectRoot(workspaceRoot);
	await configuration.update("zmk.rootDir", rootDir, vscode.ConfigurationTarget.Workspace)
	
	const buildDir = path.resolve(rootDir, `out.${config}`);
	await configuration.update("zmk.buildDir", buildDir, vscode.ConfigurationTarget.Workspace)

	const nfsDir = path.resolve(buildDir, "linux/build_nfs_image/home/zodiac")
	await configuration.update("zmk.nfsDir", nfsDir, vscode.ConfigurationTarget.Workspace)

	configuration = vscode.workspace.getConfiguration()
	console.log("zmk.config -> %s", configuration.get("zmk.config"))
	console.log("zmk.target -> %s", configuration.get("zmk.target"))
	console.log("zmk.rootDir -> %s", configuration.get("zmk.rootDir"))
	console.log("zmk.buildDir -> %s", configuration.get("zmk.buildDir"))
	console.log("zmk.nfsDir -> %s", configuration.get("zmk.nfsDir"))
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	loadConfig();

	console.log('Extension "zmk" is active');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('extension.zmkConfig', () => {
		updateConfig()
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
