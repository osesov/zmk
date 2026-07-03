import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

const supportedTargets = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
]);

export async function getBundledNinjaPath(
  context: vscode.ExtensionContext,
): Promise<string> {
  const target = `${process.platform}-${process.arch}`;

  if (!supportedTargets.has(target)) {
    throw new Error(
      `Bundled Ninja is not available for ${target}. ` +
      `Supported targets: ${[...supportedTargets].join(', ')}`,
    );
  }

  const executable = process.platform === 'win32'
    ? 'ninja.exe'
    : 'ninja';

  const executablePath = path.join(
    context.extensionPath,
    'resources',
    'ninja',
    target,
    executable,
  );

  if (process.platform !== 'win32') {
    // Defensive measure in case executable attributes were lost while
    // packaging or transferring the VSIX.
    await fs.chmod(executablePath, 0o755);
  }

  return executablePath;
}
