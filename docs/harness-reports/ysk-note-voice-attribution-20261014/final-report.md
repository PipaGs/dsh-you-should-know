# Final report — ysk-note-voice-attribution-20261014

**Статус:** READY_FOR_CHATGPT_REVIEW · DSH не мержит и не релизит.
**Product head:** ещё не закоммичен на момент записи этого отчёта; отчёт фиксирует
pre-commit dirty tree, который будет закоммичен как product commit (SHA вписывается в PR).
**База:** origin/main ec07de154aa36688db6e8fe85cbf7c1233fac9ab (tag v0.4.3).
**Ветка:** feat/ysk-note-voice-attribution-20261014 (создана от origin/main в основном worktree).
**PR:** один, из этой ветки в main; точный PR head фиксируется в описании PR.
**Инструмент:** DeepSeek Harness, supervised goal goal-session-00884197-8db0-428f-8d80-1e12b03695f6, mode strict.

---

## 1. Что просили

Реализовать одобренное улучшение Claude Code 2.1.288 для проекта dsh-you-should-know:
human-facing notes должны использовать поддерживаемую доказательствами атрибуцию актора
(«we», «the main agent», «you») по ответственности за решение. Сохранить human-only
изоляцию, JSON-контракт, язык, privacy и все текущие фичи. Работать через TDD, опираться
на официальный upstream-evidence, обновить ledger/тесты/отчёт, подготовить один PR и
остановиться на ревью ChatGPT; не мержить и не релизить.

Источник требования — уже зафиксированный в репозитории gap
`U-2.1.288-note-voice` со статусом `missing` / `deferred` и своим testable acceptance
(docs/upstream/ledger.json до этого изменения).

## 2. Границы (scope / write set)

Изменено (рабочее дерево на базе ec07de1):

- `lib/core.js` — одна новая строка в `REVIEW_INSTRUCTIONS`: правило выбора voice по
  ответственности, с нейтральным fallback и запретом приписывать вину. JSON-контракт не изменён.
- `test/core.test.js` — +2 регрессионных теста (сначала RED) + импорт
  `buildReviewerSystemPrompt`.
- `docs/upstream/ledger.json` — item `U-2.1.288-note-voice` переведён
  `missing/deferred -> equivalent/applicable`, добавлен source третьего цикла, обновлены
  `taskId`, `generatedAt`, `local.head`, записан lastOutage.
- `docs/upstream/evidence/claude-code-upstream-20261014.json` — сырой upstream-снапшот цикла:
  новый источник со SHA-256, matched lines, outage, `carriedOver` для прежних источников.
- `docs/upstream/README.md` — baseline head, таблица источников, строка паритета 2.1.288.
- `docs/upstream/workflow.md` — не изменялся (контракт уже описывает required record keeping).
- `test/upstream-ledger.test.js` — структурный тест развязан от конкретного taskId/версии и
  дополнен проверкой существования baseline-commit в репозитории.
- `README.md` — абзац про note voice и обновлённая ссылка на upstream-паритет.
- `docs/harness-reports/ysk-note-voice-attribution-20261014/evidence/*` — сырые логи,
  provenance, security/diff sanity, копия официального changelog.

Не тронуто: package.json (версия остаётся 0.4.3), cordis.patch.yml, scripts/*, LICENSE,
lib/client.js, lib/language.js, lib/review-profile.js, lib/review-strictness.js,
lib/evidence.js, lib/explain.js, lib/feedback.js, lib/adaptive.js, lib/runtime.js,
lib/self-check.js, lib/update.js, lib/index.js. Чужие worktrees и ветки не изменялись.

## 3. Аудит базы и окружения

| Факт | Значение |
| --- | --- |
| Репозиторий | https://github.com/PipaGs/dsh-you-should-know |
| Локальный main до работы | 5d60d66, отставал от origin/main на 12 коммитов |
| origin/main | ec07de154aa36688db6e8fe85cbf7c1233fac9ab (tag v0.4.3) |
| Действие | `git merge --ff-only origin/main` (5d60d66 -> ec07de1), затем branch feat/ysk-note-voice-attribution-20261014 |
| Открытые PR | нет (все PR 1..11 merged) |
| Node / npm | node v26.9.0; `npm run check` и `npm test` репозитория |
| Прежняя related-задача | docs/ysk-upstream-adoption (PR #11, merged); PR уже merged, поэтому создан новый task ID и воспроизведена регрессия |
| Отчётная конвенция | docs/harness-reports/<TASK_ID>/final-report.md |

## 4. Upstream-факты (официальный текст)

Источники этого цикла:

| Источник | Тип | Привязка | Дата |
| --- | --- | --- | --- |
| https://code.claude.com/docs/en/changelog.md | официальная served-страница changelog | sha256 dfc62da25a39339848ffedb7cf2beadf51f41458d7b681d79d25b22274550d5e | снято 2026-10-14T09:54:42Z |
| https://github.com/anthropics/claude-code/releases/tag/v2.1.287 | GitHub release | tag v2.1.287, immutable | опубликован 2026-10-01T18:00:22Z |
| https://github.com/anthropics/claude-code/blob/db93774d73e8fdbaf315a6f4c175ae99ad3d515a/CHANGELOG.md | CHANGELOG.md прошлого цикла | commit db93774d73e8fdbaf315a6f4c175ae99ad3d515a | commit 2026-10-14T02:49:24Z |

Дословная цитата 2.1.288 (строка 924 сырого снапшота):

> Improved "You should know" notes to say "we", "the main agent" or "you" depending on who was responsible for a decision

Сырая копия страницы: `docs/harness-reports/ysk-note-voice-attribution-20261014/evidence/upstream-changelog-20261014.md`,
sha256 `dfc62da25a39339848ffedb7cf2beadf51f41458d7b681d79d25b22274550d5e`.

Source outage этого цикла (честно): в окружении `raw.githubusercontent.com` и
`api.github.com` резолвились в non-public адреса, поэтому прямой GitHub-fetch не удался и
был записан как outage, а не «no change». Тот же текст был перечитан на официальной
served-странице changelog (curl GET 200, без аутентификации). Baseline прошлого цикла
(db93774, sha256 7abf62a9…) сохранён как `carriedOver` и не перезаписан. Приватные
внутренности upstream по-прежнему не реконструировались.

## 5. Что реализовано

Минимальное trusted-изменение промпта (lib/core.js, `REVIEW_INSTRUCTIONS`), одна строка:

> Let the note voice follow who was responsible for a decision, using only what the excerpt
> itself supports: "we" when the human and the agent decided together, "the main agent" when
> an action or choice is the agent's, and "you" when the decision or the consequence is the
> human's or when the note addresses the human directly. Never attribute a decision, an
> action, or the blame for one to a party the excerpt does not show; when responsibility is
> unclear, keep the note neutral and state only what happened.

Свойства:

- явные кейсы «agent», «human/shared», «none/neutral»;
- решение о voice всегда опирается только на excerpt (evidence-supported), blame не
  изобретается; при неясности — нейтральное изложение факта;
- text-only инструкция: новых полей JSON, роутов, config-ключей и host-поведения нет;
- `note` остаётся human-facing, `action` — agent-facing, human-only изоляция не затронута.

Ledger обновлён честно: item `U-2.1.288-note-voice` теперь `equivalent / applicable` с
parity notes, ссылкой на `lib/core.js`, `test/core.test.js`, `README.md` и
`docs/upstream/ledger.json`; acceptance закрыт ссылкой на эту задачу.

## 6. TDD

- RED: `node --test-reporter=tap --test test/core.test.js` до правки `lib/core.js` —
  `not ok 39 the note voice follows who was responsible for the decision, without invented blame`,
  `not ok 40 the note voice depends on the excerpt, not on an unsupported guess`,
  `# tests 73 / pass 71 / fail 2` (evidence/test-run-red.txt).
- GREEN: после добавления строки — `# tests 73 / pass 73 / fail 0`.
- Ни один существующий тест не ослаблен; изменение ledger-теста — реакция на смену
  baseline-цикла, не ослабление гейта (см. Rulings).

## 7. AC matrix

| AC | Требование | Статус | Доказательство |
| --- | --- | --- | --- |
| AC-1 | Human-facing note использует `we` / `the main agent` / `you` по ответственности | PASS | `lib/core.js:635`; `test/core.test.js` (2 теста); composed `buildReviewerSystemPrompt` несёт правило и три label |
| AC-2 | Атрибуция поддерживается доказательствами, без invented blame; неясность — нейтрально | PASS | строка «using only what the excerpt itself supports… Never attribute… keep the note neutral»; `assert.match(voiceRule, /when responsibility is unclear, keep the note neutral/)` |
| AC-3 | Human-only изоляция сохранена | PASS | `test/invariant.test.js` 11/11; grep по lib/ не находит steer/followup/inject/transcript/tools.register/systemPrompt |
| AC-4 | JSON-контракт, язык, privacy и текущие фичи сохранены | PASS | контракт не менялся (только текст инструкции); `test/language.test.js`, `test/review-profile.test.js` и весь suite зелёные |
| AC-5 | Ledger обновлён с evidence | PASS | ledger item-2.1.288 `equivalent/applicable`, `localEvidence` (4 существующих пути), новый source с SHA-256 и matched lines, outage зафиксирован |
| AC-6 | Один PR, без merge/release | PASS | ветка + один PR; версия 0.4.3 не бампалась; тег не создавался |

## 8. Верификация (raw)

Полные логи закоммичены в docs/harness-reports/ysk-note-voice-attribution-20261014/evidence/.

Финальное дерево (pre-commit, будет закоммичено как product commit):

    npm run check -> EXIT=0 (evidence/check.txt)
    npm test -> tests 495 / pass 495 / fail 0 / cancelled 0 / skipped 0 / todo 0 (evidence/test-run-final.txt)

Целевые прогоны:

    node --test test/core.test.js -> 73/73
    node --test test/upstream-ledger.test.js test/core.test.js test/language.test.js test/invariant.test.js -> 100/100

Историческая справка: базовый main (ec07de1) — 485/485; после PR #11 (upstream adoption) —
493; этот PR добавляет +2 product-теста, итог 495.

## 9. DIFF_SANITY

    $ git diff --stat
     README.md                                          |  4 +-
     docs/upstream/README.md                            |  9 ++--
     docs/upstream/evidence/claude-code-upstream-20261014.json | 53 +++++++++++++++++--
     docs/upstream/ledger.json                          | 60 ++++++++++++++++------
     lib/core.js                                        |  1 +
     test/core.test.js                                  | 23 +++++++++
     test/upstream-ledger.test.js                       | 27 ++++++----
     7 files changed, 142 insertions(+), 35 deletions(-)

- Product-изменение кода — ровно одна строка (`lib/core.js`, +1).
- `lib/client.js` и остальные lib-модули не тронуты; routes/config/UI/version не менялись.
- Новые текстовые артефакты ASCII, JSON валиден.

## 10. SECURITY_SANITY

- Human-only: `test/invariant.test.js` 11/11; в lib/ нет steer/inject/followup/transcript/
  tools.register/systemPrompt (evidence/security-diff-sanity.txt).
- Privacy: новых сетевых путей, телеметрии, роутов и записи в transcript нет.
- Upstream-контент: только короткие официальные фразы, read-only GET без аутентификации;
  внешний код не копировался; в ledger нет ozon/Users/http/chatgpt (проверяется тестом).
- Guardrail теста ledger: source обязан указывать на официальный host
  (github.com/anthropics/claude-code/ или code.claude.com/docs/) и быть либо immutable,
  либо pinned commit SHA, либо иметь content hash.

## 11. EXTERNAL_RESEARCH

- Требовался: да (сверка формулировки 2.1.288 с официальным текстом).
- Использованы только публичные первичные источники Anthropic: served-changelog
  code.claude.com (curl GET, sha256 зафиксирован) и исторический GitHub baseline прошлого
  цикла. GitHub raw/api были недоступны из окружения — записано как outage, не как «no change».
- Context7 MCP не требовался (новых библиотек/API нет).

## 12. VISUAL_GATE

- N/A. Изменение не затрагивает rendered surface: нет правок lib/client.js, UI, routes.
  Визуальное доказательство объективно неприменимо; вместо него — регрессионный тест и
  полные сырые логи.

## 13. Provenance / артефакты

| Артефакт | SHA-256 |
| --- | --- |
| docs/upstream/ledger.json | (см. evidence/artifacts-hashes.txt) |
| docs/upstream/evidence/claude-code-upstream-20261014.json | (см. evidence/artifacts-hashes.txt) |
| docs/upstream/README.md | (см. evidence/artifacts-hashes.txt) |
| test/upstream-ledger.test.js | (см. evidence/artifacts-hashes.txt) |
| test/core.test.js | (см. evidence/artifacts-hashes.txt) |
| lib/core.js | (см. evidence/artifacts-hashes.txt) |

Хэши посчитаны на pre-commit working tree; после commit product SHA вписывается в PR.

## 14. Что не сделано / unresolved

- Merge в main не выполнялся; release/тег не создавались; версия не бампалась.
- Upstream-алгоритм side agent остаётся unknown; переоценка — только при официальном раскрытии.
- Визуальный gate неприменим (нет UI-изменений).

## 15. Rulings

- Rule добавлен в `REVIEW_INSTRUCTIONS` (base policy), а не в profile/strictness-фрагмент.
  Причина: voice — инвариант для всех режимов и не должен зависеть от strictness/custom.
  Цена ошибки: при желании менять voice по режимам потребуется другой hook.
- Формулировка «using only what the excerpt itself supports … when responsibility is unclear,
  keep the note neutral» добавлена поверх upstream-фразы. Причина: goal прямо запрещает
  invent blame; upstream-текст не описывает случай неясной ответственности.
  Цена ошибки: чуть более длинная инструкция.
- Ledger-тест развязан от конкретного `taskId` и версии и переведён на проверку формы
  (semver, tag = v+version, real commit, official host + immutable/pinned/hash).
  Причина: ledger обязан обновляться каждый цикл, а эти поля теперь меняются; тест
  сохраняет все прежние гейты (evidencePath существует, gap требует acceptance, rejected
  требует reason, outage = unknown). Цена ошибки: ослаблен ровно один аспект — конкретное
  значение taskId/версии больше не пинится, но проверяется его форма и реальность commit.
- Прежний GitHub baseline не перезаписан. Причина: immutable evidence hierarchy; новый
  served-источник добавлен отдельной записью с `carriedOver` и outage.
  Цена ошибки: ledger/evidence чуть длиннее.

---

## 16. Review handoff update — 2026-10-14T10:00:03Z

Разделы 1–15 выше — исторические строки pre-commit рабочего дерева; они не переписаны.
Ниже — закрытый handoff-раунд.

- Product commit: `2e8ca59f186d1fa4855b3dc4365a2710572da2dc`
  (`feat: атрибуция voice в note по ответственности (Claude Code 2.1.288)`), запушен в
  `origin/feat/ysk-note-voice-attribution-20261014`.
- PR: https://github.com/PipaGs/dsh-you-should-know/pull/12
  (`--base main`, `--head feat/ysk-note-voice-attribution-20261014`).
- Base: `ec07de154aa36688db6e8fe85cbf7c1233fac9ab` (origin/main, tag v0.4.3).
- Запись отчёта о handoff коммитится после product commit как report-only коммит; его SHA —
  фактический PR head на момент ревью и указан в заголовке PR.
- Верификация product-состояния на 2e8ca59: `npm run check` — OK; `npm test` — tests 495 /
  pass 495 / fail 0; RED-прогон — 2 fail / 71 pass; `test/invariant.test.js` — 11/11.
  Правка отчёта product evidence не инвалидирует.

---

## 17. CHANGES_REQUIRED rev2 corrections — 2026-10-14T10:07:31Z

Разделы 1–16 выше — историческая запись на reviewed head
`9a2803d0835c1819f99ac9a1934f56e03a096652`; они не переписаны. Ниже — один закрытый
review-раунд: сгруппированные исправления по двум findings ChatGPT.

### F1. Полная копия upstream-документа заменена минимальным excerpt

- Было: `evidence/upstream-changelog-20261014.md` — полная копия официальной страницы
  changelog (1,082,335 байт / 1,081,280 символов; GitHub blob
  `a4eeb5ec885ae0e003d22fe2bb2d1c0e2b475d47`), что противоречит политике
  `docs/upstream/README.md` («quote only short official sentences, copy no upstream code»)
  и создаёт лишнюю перераспространение/раздувание репозитория без обнаруживаемой лицензии.
- Стало: файл перезаписан минимальным excerpt — ровно одна официальная фраза версии
  2.1.288, canonical URL, observed timestamp, номер строки наблюдаемого документа и
  sha256 полного документа как provenance наблюдения; полный текст не коммитится.
  Размер: 944 байта (было 1,082,335).
- Метаданные (sha256 `dfc62da2…`) сохранены в ledger source и evidence JSON; это
  наблюдение, а не переупаковка текста.

### F2. Ledger 2.1.288: adapted вместо equivalent, scoped acceptance

- Было: `localStatus: "equivalent"`, acceptance `null`, формулировка «parity present».
- Стало: `localStatus: "adapted"`, `disposition: "applicable"`, `acceptance` со
  `scope: "prompt-composition"` (summary + testableAs). Parity notes прямо разделяют:
  **verified** — composed system prompt содержит правило, base policy идёт первой, owner не
  выдумывается из excerpt; **NOT verified** — живой вывод модели (non-deterministic, live
  model test отсутствует). Поэтому статус adapted, а не equivalent.
- README проекта и `docs/upstream/README.md` приведены к той же формулировке
  (instruction-level adaptation; live model output not verified); добавлена ссылка на
  committed excerpt.
- Ledger-гейт не ослаблен: тест по-прежнему требует acceptance для gap/deferred, reason для
  rejected, существование каждого evidence-пути и official+immutable/pinned источник;
  добавлен явный пропуск для adapted-строки и проверка формы scoped acceptance.

### Демонстрация base policy precedence над Custom

Добавлен регрессионный тест
`test/review-profile.test.js :: the base note-voice rule outranks a Custom reviewer prompt and cannot be replaced`:
даже при Custom-режиме base policy идёт первой, voice-правило присутствует (явная проверка
`voiceRuleAt >= 0`, а не вакуумный indexOf), идёт до `--- BEGIN CUSTOM REVIEWER PROMPT ---`,
no-invented-blame guard тоже до Custom, а hostile Custom-текст сохраняется verbatim как
untrusted data. RED теста зафиксирован: см. новый RED-прогон ниже.

### Верификация (raw, обновлено)

- RED (`test/core.test.js` + `test/review-profile.test.js`): 3 fail / 82 pass
  (evidence/test-run-red.txt).
- GREEN targeted: 93/93; `npm run check` — EXIT=0; `npm test` — **tests 496 / pass 496 / fail 0**
  (evidence/check.txt, evidence/test-run-final.txt).
- `test/invariant.test.js` — 11/11; forbidden delivery seams — no match
  (evidence/security-diff-sanity.txt).
- Рост тестов 495 -> 496: +1 новый precedence-тест в test/review-profile.test.js.

### DIFF_SANITY / SECURITY_SANITY (rev2)

- Изменённые пути: `README.md`, `docs/upstream/README.md`, `docs/upstream/ledger.json`,
  `test/review-profile.test.js`, `test/upstream-ledger.test.js` и evidence-файлы задачи;
  `lib/core.js` — без изменений относительно reviewed head (hash
  `44c816e22900a3def3eb670bc657aedbc7a67baa3f596c9d7c3faa46a0ea0bc9`).
- Net: −11,225 строк (в основном удалённая полная копия changelog).
- Секреты/абсолютные пути/приватные данные не добавлялись; human-only инвариант зелёный.

### Provenance (pre-commit, rev2)

| Артефакт | SHA-256 |
| --- | --- |
| lib/core.js | 44c816e22900a3def3eb670bc657aedbc7a67baa3f596c9d7c3faa46a0ea0bc9 |
| test/core.test.js | 62613b59b95225148ddf792021d51eb10ef5632bc239a7cd4513d8e0b7de878b |
| test/review-profile.test.js | 87c97adf314f5a35d48ee9dda52f25f81c17b67144f66d44f0efb0dc6b1d7aee |
| test/upstream-ledger.test.js | bf8a5fd1e95aaa86e94acfda98acb333e3cba3336b570525b534b6c57418f76b |
| docs/upstream/ledger.json | 55e91d9352df8ee8442355c20b85c9abafd71a83cbae869d12b8a124f875688d |
| docs/upstream/README.md | bf3b266129ed8a4a8d9db21f9d39d44a7cf370af1849002cf093e737e11271e3 |
| README.md | 692b202d57939374f83a451c1b6de0f80c4d729326b4c50640a1c7405e9e034b |
| evidence/upstream-changelog-20261014.md | 6366d8cbb7cffe9cb0ee9aba306fd1c04dd7b1807d4b64fb626972b5fed27ce0 |
| evidence/claude-code-upstream-20261014.json | c5fac2b1502d8a221ec4a7e229012c645f84be0d9310791173af84031e809d7a |

### Handoff rev2

- Тот же PR #12, та же ветка `feat/ysk-note-voice-attribution-20261014`, тот же worktree и
  отчёт; новый PR не создавался, merge/release не выполнялись.
- Первый родительский коммит reviewed head — `9a2803d`; corrective commit и итоговый head
  фиксируются в заголовке PR #12 после push.
- **Статус:** READY_FOR_CHATGPT_REVIEW.
