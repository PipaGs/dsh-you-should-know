// Contract: the PR patch, not only a clean tree, must pass `git diff --check`.
//
// The earlier gate ran `git diff --check` against the index and working tree
// only. A committed hunk with a whitespace error therefore passed that gate:
// the tree was clean, so there was nothing for the index-only diff to inspect.
//
// This test diffs the PR base commit against the working tree, which is also
// the committed range once the change is committed. That makes the same check
// usable before and after commit, and makes it inspect the PR patch itself.
//
// The base is the PR base commit by default; set PR_BASE_SHA to audit a
// different base. The test skips when it cannot inspect that range: no .git,
// no git binary, no HEAD commit, base commit missing from the checkout (for
// example a shallow clone), or base not an ancestor of HEAD.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PR_BASE = '0419b70797a8d37db245d55817a7be273b5edcdb'
const prBase = process.env.PR_BASE_SHA?.trim() || DEFAULT_PR_BASE

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
}

test('the PR patch from the base commit has no whitespace errors', (t) => {
  if (!existsSync(join(repoRoot, '.git'))) {
    t.skip('not a git checkout')
    return
  }
  try {
    git(['--version'])
  } catch {
    t.skip('git is not available')
    return
  }
  try {
    git(['rev-parse', '--verify', 'HEAD'])
  } catch {
    t.skip('the git repository has no HEAD commit')
    return
  }
  try {
    git(['cat-file', '-e', prBase + '^{commit}'])
  } catch {
    t.skip('base commit ' + prBase + ' is not present in this checkout')
    return
  }
  try {
    git(['merge-base', '--is-ancestor', prBase, 'HEAD'])
  } catch (error) {
    if (error?.status === 1) {
      t.skip('base commit ' + prBase + ' is not an ancestor of HEAD')
      return
    }
    throw error
  }

  let stdout
  try {
    stdout = git(['diff', '--check', prBase])
  } catch (error) {
    const captured = String(error.stdout ?? '') + String(error.stderr ?? '')
    assert.fail(
      'git diff --check ' + prBase + ' reported whitespace errors:\n' + captured.trim(),
    )
    return
  }

  assert.equal(stdout, '', 'git diff --check ' + prBase + ' must print nothing on success')
})
