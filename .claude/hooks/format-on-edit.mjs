#!/usr/bin/env node
// PostToolUse hook (Edit|Write|MultiEdit): run Prettier on backend TypeScript
// files right after Claude changes them. Never blocks: formatting problems are
// reported, and `yarn format:check` in CI is the real gate.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let filePath;
try {
  filePath = JSON.parse(Buffer.concat(chunks).toString('utf8')).tool_input
    ?.file_path;
} catch {
  process.exit(0);
}
if (!filePath || !filePath.endsWith('.ts')) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const backendDir = path.join(projectDir, 'backend');
const absolute = path.resolve(projectDir, filePath);
const prettier = path.join(backendDir, 'node_modules', '.bin', 'prettier');

const inBackend = absolute.startsWith(backendDir + path.sep);
const inDeps = absolute.includes(`${path.sep}node_modules${path.sep}`);
if (!inBackend || inDeps || !existsSync(absolute) || !existsSync(prettier)) {
  process.exit(0);
}

try {
  execFileSync(prettier, ['--write', '--log-level', 'warn', absolute], {
    cwd: backendDir,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
} catch (error) {
  process.stderr.write(
    `prettier could not format ${absolute}: ${error.stderr ?? error.message}\n`,
  );
}
process.exit(0);
