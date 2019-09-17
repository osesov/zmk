// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

async function updateConfig() {
	let configuration = vscode.workspace.getConfiguration()

	const quickPick = vscode.window.createQuickPick();
	const options = ["aaa", "bbb"]
	const current = configuration.get('zmk.config')

	const result = await vscode.window.showQuickPick(options, { canPickMany: false })

	if (result == undefined) {
		return
	}

	console.log(`selected: ${result}`)
	vscode.window.showInformationMessage(`Selected: ${result}`);

	const ok = await configuration.update("zmk.config", result, vscode.ConfigurationTarget.Workspace)
	console.log(`status is ${ok} = ` + configuration.get("zmk.config"))
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "zmk" is now active!');

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
