#!/usr/bin/env node
// PreToolUse hook (Edit|Write|MultiEdit). Exit code 2 blocks the tool call and
// sends stderr back to Claude as the reason.
//  - Committed Prisma migrations are immutable: already applied databases would
//    drift from the history. New or uncommitted migrations stay editable.
//  - Real .env files hold secrets; only the samples may be edited.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let filePath;
try {
  filePath = JSON.parse(Buffer.concat(chunks).toString('utf8')).tool_input
    ?.file_path;
} catch {
  process.exit(0); // not our business if the payload is unexpected
}
if (!filePath) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const relative = path
  .relative(projectDir, path.resolve(projectDir, filePath))
  .split(path.sep)
  .join('/');

function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

if (/^backend\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(relative)) {
  let tracked = false;
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relative], {
      cwd: projectDir,
      stdio: 'ignore',
    });
    tracked = true;
  } catch {
    tracked = false;
  }
  if (tracked) {
    block(
      `Blocked: ${relative} is a committed migration and must not change. ` +
        'Create a new migration instead (see the db-migration skill).',
    );
  }
}

const base = path.posix.basename(relative);
if (/^\.env(\..+)?$/.test(base) && !/^\.env\.(sample|example)$/.test(base)) {
  block(
    `Blocked: ${relative} may contain real secrets. Edit .env.sample or ` +
      'backend/.env.example instead, and ask the user to update their own .env.',
  );
}

process.exit(0);
