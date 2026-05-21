const esbuild = require('esbuild');
const package = require('./package.json');
const child_process = require('child_process');

if (process.argv.includes('--prepublish')) {
  console.log(`Checking if version ${package.version} already exists as a remote git tag...`);
  child_process.execSync('git fetch --tags origin --prune', { stdio: 'inherit' });
  const output = child_process.execSync(`git ls-remote origin refs/tags/${package.version}`, { stdio: ['ignore', 'pipe', 'inherit'] });

  if (output.toString().trim()) {
    console.error(`Version ${package.version} already exists as a git tag. Please remove the existing tag before publishing.`);
    process.exit(1);
  }

  console.log(`Version ${package.version} is available for publishing.`);
  return;
}

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  minify: false,

  // jsonc-parser is imported from 'main' field, while expected to be imported from 'module'.
  mainFields: ['module', 'main'],
}).catch(() => process.exit(1));
