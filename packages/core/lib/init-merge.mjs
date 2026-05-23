import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertWorkspaceNotNestedInsideInstall } from './paths.mjs';

export async function planWorkspaceMerge({ templateDir, workspaceRoot }) {
  if (!workspaceRoot) throw new Error('planWorkspaceMerge requires workspaceRoot');
  // M4.24 / ADR-0006: refuse workspaces nested inside the CoCoder install repo
  // before doing any planning work. The check is a no-op for out-of-tree targets.
  await assertWorkspaceNotNestedInsideInstall(workspaceRoot);
  const templateFiles = await collectFiles(templateDir);
  const actions = [];
  for (const relativePath of templateFiles) {
    if (isPrivatePath(relativePath)) continue;
    const sourcePath = path.join(templateDir, relativePath);
    const targetPath = path.join(workspaceRoot, relativePath);
    const targetExists = await exists(targetPath);
    if (!targetExists) {
      actions.push({ action: 'add', relativePath, sourcePath, targetPath });
      continue;
    }
    const [source, target] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(targetPath, 'utf8')]);
    actions.push({
      action: source === target ? 'unchanged' : 'preserve-user-edit',
      relativePath,
      sourcePath,
      targetPath
    });
  }
  return {
    ok: true,
    actions,
    add: actions.filter((item) => item.action === 'add').map((item) => item.relativePath),
    preserve: actions.filter((item) => item.action === 'preserve-user-edit').map((item) => item.relativePath),
    unchanged: actions.filter((item) => item.action === 'unchanged').map((item) => item.relativePath)
  };
}

export async function applyWorkspaceInit({ templateDir, workspaceRoot, merge = false }) {
  const plan = await planWorkspaceMerge({ templateDir, workspaceRoot });
  const applied = [];
  const skipped = [];
  const conflicts = [];

  for (const action of plan.actions) {
    if (action.action === 'add') {
      await mkdir(path.dirname(action.targetPath), { recursive: true });
      await copyFile(action.sourcePath, action.targetPath);
      applied.push(action.relativePath);
      continue;
    }
    if (action.action === 'unchanged') {
      skipped.push(action.relativePath);
      continue;
    }
    if (action.action === 'preserve-user-edit') {
      conflicts.push(action.relativePath);
      if (!merge) {
        continue;
      }
    }
  }

  return {
    ok: true,
    merge,
    plan,
    applied,
    skipped,
    conflicts
  };
}

async function collectFiles(root) {
  const files = [];
  await walk(root, '');
  return files.sort();

  async function walk(currentRoot, prefix) {
    const entries = await import('node:fs/promises').then(({ readdir }) => readdir(currentRoot, { withFileTypes: true }));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(currentRoot, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function isPrivatePath(relativePath) {
  if (relativePath === 'cocoder/local/README.md' || relativePath === 'cocoder/local/.gitignore') {
    return false;
  }
  return relativePath === 'cocoder/local' || relativePath.startsWith('cocoder/local/');
}
