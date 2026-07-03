import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import * as tar from 'tar';

const NINJA_VERSION = '1.13.2';

const targets = [
  { target: 'darwin-arm64', executable: 'ninja' },
  { target: 'darwin-x64', executable: 'ninja' },
  { target: 'linux-arm64', executable: 'ninja' },
  { target: 'linux-x64', executable: 'ninja' },
  { target: 'win32-arm64', executable: 'ninja.exe' },
  { target: 'win32-x64', executable: 'ninja.exe' },
];

const repositoryRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);

const outputRoot = path.join(repositoryRoot, 'resources', 'ninja');

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npmPack(packageSpec, destination) {
  const result = spawnSync(
    npmExecutable(),
    [
      'pack',
      packageSpec,
      '--json',
      '--pack-destination',
      destination,
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `npm pack failed for ${packageSpec} with exit code ${result.status}`,
    );
  }

  let output;

  try {
    output = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Cannot parse npm pack output for ${packageSpec}: ${result.stdout}`,
      { cause: error },
    );
  }

  const filename = output[0]?.filename;

  if (!filename) {
    throw new Error(`npm pack did not return a filename for ${packageSpec}`);
  }

  return path.join(destination, filename);
}

async function prepareTarget(tempRoot, definition, copyLegalFiles) {
  const packageName = `ninja-runtime-${definition.target}`;
  const packageSpec = `${packageName}@${NINJA_VERSION}`;

  console.log(`Fetching ${packageSpec}`);

  const packageTemp = path.join(tempRoot, definition.target);
  const extractRoot = path.join(packageTemp, 'extracted');

  // console.log(`Extracting ${packageSpec} to ${extractRoot}`);

  await mkdir(extractRoot, { recursive: true });

  const archive = npmPack(packageSpec, packageTemp);

  await tar.x({
    file: archive,
    cwd: extractRoot,
  });

  const packageRoot = path.join(extractRoot, 'package');
  const sourceExecutable = path.join(
    packageRoot,
    'bin',
    definition.executable,
  );

  // Verify that extraction actually produced the expected file.
  await readFile(sourceExecutable);

  const targetDirectory = path.join(outputRoot, definition.target);
  const targetExecutable = path.join(
    targetDirectory,
    definition.executable,
  );

  await mkdir(targetDirectory, { recursive: true });
  await copyFile(sourceExecutable, targetExecutable);

  if (!definition.target.startsWith('win32-')) {
    await chmod(targetExecutable, 0o755);
  }

  if (copyLegalFiles) {
    await copyFile(
      path.join(packageRoot, 'LICENSE'),
      path.join(outputRoot, 'LICENSE'),
    );

    // await copyFile(
    //   path.join(packageRoot, 'NOTICE'),
    //   path.join(outputRoot, 'NOTICE'),
    // );
  }
}

async function main() {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), 'extension-ninja-runtime-'),
  );

  try {
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true });

    for (const [index, target] of targets.entries()) {
      await prepareTarget(tempRoot, target, index === 0);
    }

    console.log(`Ninja ${NINJA_VERSION} copied to ${outputRoot}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
