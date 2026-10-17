#!/usr/bin/env node
// Resolve every relative markdown link and heading anchor in README.md and
// docs/reference.md as they exist in the repository.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

let bad = 0
for (const file of ['README.md', 'docs/reference.md']) {
  const text = readFileSync(file, 'utf8')
  const anchors = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1]))
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1]
    if (/^(https?:|mailto:)/.test(link)) continue
    const [rel, anchor] = link.split('#')
    const target = resolve(dirname(file), rel || file)
    if (!existsSync(target)) {
      console.log(`BROKEN FILE   ${file} -> ${link}`)
      bad += 1
      continue
    }
    if (anchor) {
      const targetText = readFileSync(target, 'utf8')
      const targetAnchors = [...targetText.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1]))
      if (!targetAnchors.includes(anchor)) {
        console.log(`BROKEN ANCHOR ${file} -> ${link}`)
        bad += 1
        continue
      }
    }
    console.log(`OK ${file} -> ${link}`)
  }
}
console.log(`\nbroken links/anchors: ${bad}`)
process.exit(bad ? 1 : 0)
