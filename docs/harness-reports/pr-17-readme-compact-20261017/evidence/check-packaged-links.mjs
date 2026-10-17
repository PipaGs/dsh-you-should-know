#!/usr/bin/env node
// Resolve every relative markdown link in the packaged README and reference.
// The new docs/reference.md link is the regression under test; the
// docs/upstream link is a pre-existing repo-only pointer and is reported
// separately instead of failing this check.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('usage: node check-packaged-links.mjs <package-root>')
  process.exit(2)
}

const files = ['README.md', 'docs/reference.md']
let missing = 0
let newReferenceBroken = false

for (const file of files) {
  const abs = join(root, file)
  if (!existsSync(abs)) {
    console.log(`MISSING FILE: ${file}`)
    missing += 1
    if (file === 'docs/reference.md') newReferenceBroken = true
    continue
  }
  const text = readFileSync(abs, 'utf8')
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1]
    if (/^(https?:|mailto:|#)/.test(link)) continue
    const rel = link.split('#')[0]
    const target = resolve(dirname(abs), rel)
    const ok = existsSync(target)
    const note = !ok && file === 'README.md' && rel === './docs/upstream/README.md'
      ? ' (pre-existing, out of scope)'
      : ''
    console.log(`${ok ? 'OK    ' : 'BROKEN'} ${file} -> ${link}${note}`)
    if (!ok) {
      missing += 1
      if (file === 'README.md' && rel === './docs/reference.md') newReferenceBroken = true
    }
  }
}

console.log(`\nrelative links missing: ${missing}`)
console.log(`new docs/reference.md link broken: ${newReferenceBroken}`)
process.exit(newReferenceBroken ? 1 : 0)
