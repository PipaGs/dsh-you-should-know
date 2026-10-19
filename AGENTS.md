# Repository rules

This file is the authoritative rule set for work in this repository. It applies
to every contributor and every agent that changes the repository. Product
documentation stays in README.md and docs/reference.md; this file governs how
repository-facing work is written, reviewed, and recorded.

## Rules index

| Surface | Authority |
|---|---|
| Repository-facing language and process rules | this file |
| Product overview, install, and user-facing behavior | README.md |
| Deep contracts, schemas, and internals | docs/reference.md |
| Task-owned reports and raw evidence | docs/harness-reports/ |

## English-only repository artifacts

All new or modified repository-facing prose must be written in English. This is
mandatory, not a preference. It covers, at minimum:

- pull request titles and descriptions;
- commit messages, including the subject and body;
- review comments, issue comments, and other review-thread prose;
- task-owned final reports under docs/harness-reports/;
- documentation, release notes, changelogs, and README or reference text;
- code comments and any other prose committed to the repository.

The rule is about repository artifacts, not human chat. Chat responses may be
written in the human's language, including Russian, and that choice is not
changed by this rule. The test is the destination: text that will be committed,
posted to a pull request or issue, or read as project documentation is
repository-facing and must be English; a conversational reply is not.

Raw command output is evidence and is preserved as captured. Authored prose
that introduces, summarizes, or explains that output is repository-facing and
must be English.

## Historical artifacts and corrections

Existing historical artifacts are not silently rewritten. If an old report,
commit, or other record contains non-English prose, preserve it and add a
separate dated English addendum or correction. The addendum must:

- state that it is an addendum, name the original artifact, and give its date;
- summarize the facts in English without editing the original bytes;
- record any process deviation explicitly; and
- link to this rule.

Do not translate or rewrite historical evidence in place. A correction is a new
artifact, not an edit to the old one.

Known historical deviation: PR #19 (merged as
5929bb3547ba7c8f9f91e711a30880b9d201ea94) used Russian prose for its title,
body, commit messages, and task-owned report. This rule did not exist at that
time. The original artifacts are preserved, and the dated English addendum is
[english-addendum-20261019.md](docs/harness-reports/ysk-version-bump-0.4.5-20261019/english-addendum-20261019.md).

## Review checklist

Before opening or updating a pull request, confirm:

- every new repository-facing prose block is English;
- the pull request title and description are English;
- every new commit message is English;
- new review comments are English;
- the task-owned final report and its authored evidence are English, except for
  preserved historical artifacts or dated English addenda; and
- the applicable repository checks pass (npm test, npm run check, and
  git diff --check for code or multi-file changes).

## Scope and precedence

Within this repository, this file is the authoritative rule for
repository-facing prose. It does not govern chat language. A direct human
instruction can override a project rule; absent such an instruction, this rule
is mandatory.
