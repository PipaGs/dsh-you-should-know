# Final report — ysk-upstream-adoption-20261014

**Статус:** READY_FOR_CHATGPT_REVIEW · DSH не мержит.
**Product head (docs, tests, README, evidence):** a6ea8e76f22c0a1140989367880c8fd733982cc7
**База:** origin/main b6a202d00e80e6069c07b03e65034b4280756f1d (tag v0.4.3).
**Ветка:** docs/ysk-upstream-adoption (worktree .worktrees/ysk-upstream-adoption).
**PR:** один, из этой ветки в main; точный PR head на момент handoff зафиксирован в описании PR.
**Инструмент:** DeepSeek Harness, supervised goal goal-session-55631b64-b61b-492c-9882-744241e1ae6d, mode strict.

---

## 1. Что просили

Установить минимальный, подтверждённый доказательствами upstream-to-local workflow
для встроенного мода Claude Code «You should know», сохранив собранный продукт v0.4.3.
Ядро уже реализовано — не пересобирать и не перезаписывать. Нужны: версионированная
in-repository оценка upstream baseline/gap и воспроизводимый triage/adoption-процесс,
связывающий официальные upstream-источники с локальными фичами и с последующими
проверяемыми изменениями. Код менять только при доказанной необходимости; иначе
документация и минимально необходимые тесты. Human-only инвариант обязан остаться.

## 2. Границы (scope / write set)

Написано (product commit a6ea8e7):

- docs/upstream/README.md — версионированный baseline, локальная ревизия, таблица паритета.
- docs/upstream/workflow.md — read-only triage/adoption pipeline.
- docs/upstream/ledger.json — машиночитаемый ledger (источники, items, evidence, acceptance, unknown, outage).
- docs/upstream/evidence/claude-code-upstream-20261014.json — сырой снапшот, commit SHA и SHA-256 источников.
- test/upstream-ledger.test.js — структурный контракт ledger (8 тестов).
- README.md — одна строка со ссылкой на baseline.
- docs/harness-reports/ysk-upstream-adoption-20261014/evidence/ — полные логи baseline и финального прогона.

Не тронуто: весь lib/* (включая core.js, client.js, language.js, review-strictness.js,
review-profile.js, runtime.js, update.js, self-check.js), package.json, cordis.patch.yml,
scripts/*, LICENSE. Локальный main (5d60d66, отстаёт от origin/main) не изменялся.
Чужие worktrees (.worktrees/*) и внешние пути не изменялись.

## 3. Аудит базы и окружения

| Факт | Значение |
| --- | --- |
| Репозиторий | https://github.com/PipaGs/dsh-you-should-know |
| Локальный main | 5d60d66, отстаёт от origin/main |
| origin/main | b6a202d00e80e6069c07b03e65034b4280756f1d (tag v0.4.3) |
| Изоляция | worktree .worktrees/ysk-upstream-adoption, ветка docs/ysk-upstream-adoption |
| Node / npm | v26.9.0 (тесты); npm-скрипты репозитория |
| Отчётная конвенция | docs/harness-reports/<TASK_ID>/final-report.md (существующий пример: ysk-empty-state-dock-20261011) |
| Существующий upstream-процесс | не найден; создан минимальный новый |

## 4. Upstream-факты (AC-1) — только официальный текст, факты и unknowns разделены

Официальные источники, versioned:

| Источник | Тип | Привязка | Дата |
| --- | --- | --- | --- |
| https://github.com/anthropics/claude-code/releases/tag/v2.1.287 | GitHub release | tag v2.1.287, immutable | опубликован 2026-10-01T18:00:22Z |
| https://github.com/anthropics/claude-code/blob/db93774d73e8fdbaf315a6f4c175ae99ad3d515a/CHANGELOG.md | CHANGELOG.md | commit db93774d73e8fdbaf315a6f4c175ae99ad3d515a | commit 2026-10-14T02:49:24Z |

Факты (дословно, из официального текста):

- 2.1.287: «Added You should know, a built-in mod where a side agent watches your back and flags things you or Claude might miss. Turn it on with /plugin enable cc-plugin-you-should-know@builtin (for first-party sessions with telemetry on)».
- 2.1.288: notes говорят «we», «the main agent» или «you» в зависимости от того, кто отвечает за решение.
- 2.1.290: исправлено, что notes всегда писались по-английски, независимо от настройки language.

Unknowns (не угадываются):

- Алгоритм side agent (выбор, гейтинг, дедупликация, формат) официально не раскрыт.
  Реконструкция не предпринималась; статьи неизвестны и записаны в openUnknowns ledger.
- Обработка данных мода под его telemetry-гейтом официально не описана; совпадение с
  privacy-моделью плагина не предполагается.

Лицензия upstream: GitHub license API вернул 404 на 2026-10-14 — обнаруживаемого
license-файла нет. Поэтому baseline цитирует только короткие официальные фразы для
фактического трекинга и не копирует upstream-код.

## 5. Что реализовано (AC-2, AC-3)

Workflow (docs/upstream/workflow.md) описывает read-only pipeline:
candidate -> verified -> applicable | deferred | rejected.

- candidate: новое упоминание «You should know» в официальном источнике.
- verified: точная формулировка подтверждена по первичному официальному источнику;
  записаны версия, URL, дата и идентичность источника. Недоступный источник — unknown, не verified.
- applicable: релевантно плагину; локальный статус и named local evidence записаны.
  Паритет есть — acceptance не нужен; реальный gap уходит в отдельную задачу.
- deferred: сигнал реален, но не реализуется сейчас; обязательны проверяемый acceptance и своя задача.
- rejected: не применимо или нарушает инвариант; обязательна причина.

Dedupe: тот же upstream version и та же формулировка — дубликат; позднейший rewrite
обновляет существующий item; разное поведение одного релиза — отдельный item.

Evidence: локальный статус (equivalent, adapted, partial, missing, not-applicable,
unknown) обязан опираться на named local evidence, существующий в репозитории; тест
ledger падает при отсутствующем пути, поэтому заявление о паритете не может быть голословным.

Source outage: недоступный/переехавший/обрезанный источник фиксируется как unknown
для этого цикла и никогда как «no change»; прежний verified baseline сохраняется,
outage и attempted URLs записываются в следующее обновление.

Privacy/licensing/no-auto-edit: triage не редактирует продукт; каждый gap получает
отдельную задачу; upstream-код не копируется; приватный контент не отправляется в
публичный поиск; Scheduled Tasks не создаются и не изменяются.

Seeded comparison (ledger items):

| Upstream | Claim | Local status | Disposition |
| --- | --- | --- | --- |
| 2.1.287 | built-in side agent флагует важное, что пропустили человек или агент | adapted | applicable (паритет есть) |
| 2.1.287 | гейт first-party sessions with telemetry on | not-applicable | rejected (нет telemetry и first-party модели) |
| 2.1.288 | voice: we / the main agent / you по ответственности | missing | deferred (свой testable acceptance) |
| 2.1.290 | notes уважают language setting | equivalent | applicable (паритет есть) |

Единственный подтверждённый gap (2.1.288 note voice) оставлен deferred с acceptance:
prompt-composition тест с фиксированным excerpt, где решение принял агент, проверяет
наличие правила responsibility-attribution; второй кейс — решение принял человек.

## 6. Код не менялся (AC-4)

git diff --name-only b6a202d..a6ea8e7 не содержит ни одного файла lib/*.
Изменён только README.md (одна строка) и добавлены docs/upstream/*, test/upstream-ledger.test.js,
docs/harness-reports/*. Human-only инвариант проверяется test/invariant.test.js, который
входит в зелёный прогон 493/493; новых delivery-shape не появлялось.

## 7. AC matrix

| AC | Требование | Статус | Доказательство |
| --- | --- | --- | --- |
| AC-1 | Человек может найти версионированный первичный upstream-источник и актуальный локальный baseline | PASS | docs/upstream/README.md (источники, tag v2.1.287, commit db93774, local head b6a202d); docs/upstream/ledger.json (upstream.sources, local); evidence JSON с SHA-256 |
| AC-2 | Новый upstream-элемент дедуплицируется, оценивается, получает disposition и трассируется к независимому implementation AC и evidence | PASS | docs/upstream/workflow.md (dedupe + states); ledger item U-2.1.288-note-voice с acceptance; test/upstream-ledger.test.js проверяет уникальность id, допустимые status/disposition, наличие acceptance у gap и существование каждого evidence-пути |
| AC-3 | Отказы источников и unknowns обрабатываются явно | PASS | ledger.outagePolicy (outage -> unknown, never no change); ledger.openUnknowns (алгоритм, data handling); workflow раздел Source outage; тест проверяет оба |
| AC-4 | Human-only инвариант сохранён, нет несвязанного изменения поведения | PASS | lib/* не изменён; test/invariant.test.js зелёный в 493/493; diff только docs/test/README |
| AC-5 | Нет опоры на OZON identity, платную инфраструктуру, угаданные приватные внутренности или отправку приватного контента в публичный поиск | PASS | workflow guardrails; ledger не содержит ozon/Users/http/chatgpt (проверяется тестом); использованы только публичные официальные источники, read-only GET без аутентификации; приватные внутренности не реконструировались |

## 8. Верификация

Полные логи закоммичены: docs/harness-reports/ysk-upstream-adoption-20261014/evidence/test-run-baseline.txt
и .../test-run-final.txt.

База (b6a202d, tag v0.4.3, отдельный worktree .worktrees/ysk-postmerge-verify-0.4.3):

    npm test -> tests 485 / pass 485 / fail 0

Финальное дерево (product head a6ea8e7, worktree .worktrees/ysk-upstream-adoption):

    npm run check -> OK
    npm test -> tests 493 / pass 493 / fail 0 / cancelled 0 / skipped 0 / todo 0

Разница +8 тестов — ровно новый test/upstream-ledger.test.js. Проверка на базовом
worktree выполнена на детачнутом b6a202d; это тот же коммит, что origin/main и tag v0.4.3.

TDD-прогон ledger-теста:

- RED (до ledger/docs): node --test test/upstream-ledger.test.js — 8 fail, 0 pass
  (ENOENT на docs/upstream/ledger.json и отсутствие workflow.md/README.md).
- GREEN (после docs/upstream/*): node --test test/upstream-ledger.test.js — 8 pass, 0 fail.

## 9. DIFF_SANITY

    $ git diff --numstat b6a202d..a6ea8e7
    1    1   README.md
    513  0   docs/harness-reports/ysk-upstream-adoption-20261014/evidence/test-run-baseline.txt
    524  0   docs/harness-reports/ysk-upstream-adoption-20261014/evidence/test-run-final.txt
    61   0   docs/upstream/README.md
    54   0   docs/upstream/evidence/claude-code-upstream-20261014.json
    137  0   docs/upstream/ledger.json
    107  0   docs/upstream/workflow.md
    145  0   test/upstream-ledger.test.js

- merge-base(origin/main, product head) = b6a202d, то есть база — ровно origin/main/tag v0.4.3.
- Изменённых файлов в lib/ — 0. package.json, cordis.patch.yml, scripts/* не тронуты.
- Новых зависимостей, роутов, config-ключей и продуктового поведения нет.
- Все новые текстовые артефакты ASCII; JSON валиден.

## 10. SECURITY_SANITY

- Сетевой доступ только read-only GET к официальным публичным GitHub-эндпоинтам
  (release tag, raw CHANGELOG, license API, list commits). Аутентификация не использовалась,
  cookie/token/заголовки не передавались; приватный контент не отправлялся.
- Секретов, ключей, абсолютных домашних путей (/Users/...), http:// и упоминаний
  сторонних проектов в ledger нет — это проверяет отдельный тест ledger.
- Human-only инвариант: test/invariant.test.js (в составе 493/493) подтверждает отсутствие
  steer/inject/followup, transcript-записи, cookie/token/storage, install/self-modify,
  инструментов и не-English публичного текста.
- Плагин не получил новых записываемых путей: triage-процесс декларативно read-only
  и не исполняется автоматически.

## 11. EXTERNAL_RESEARCH

- Требовался: да, поскольку AC-1/AC-2 опираются на официальный upstream.
- Использованы только публичные первичные источники Anthropic под
  https://github.com/anthropics/claude-code/ : immutable release v2.1.287 и CHANGELOG.md,
  привязанный к полному commit SHA. Сторонние зеркала, блоги и приватные внутренности не использовались.
- Сырой снапшот и SHA-256 зафиксированы в docs/upstream/evidence/claude-code-upstream-20261014.json.
- Context7 MCP не требовался (новых библиотек/API нет).

## 12. VISUAL_GATE

- N/A. Изменение не затрагивает ни один rendered surface: нет правок lib/client.js,
  нет новых UI-элементов, нет изменений маршрутов или схемы notes. Визуальное
  доказательство объективно неприменимо; вместо него добавлен структурный тест ledger
  и полные логи прогонов.

## 13. Provenance / артефакты

| Артефакт | SHA-256 |
| --- | --- |
| docs/upstream/ledger.json | 83b787087def6b92bc048411c5bff03651abafbf907bbfdea395e04d9213a5aa |
| docs/upstream/evidence/claude-code-upstream-20261014.json | 154dbe12aa99b9ae594a30fcb8cb30325588b938b2b068cda041d71f9b332530 |
| docs/upstream/README.md | 16fa512092546b773813e7ae64678b257994fd46c83043b03168d54e38f83a1c |
| docs/upstream/workflow.md | 6f33d4b6510af0b6fcfd1f75c1f88e86c5eb014e248511ad06c8cd0d879d52e9 |
| test/upstream-ledger.test.js | 3c1f86efd5a6f7e22a2bb4b035b0c9912760188c9306f8a6e7607b8a246f8223 |

Хэши посчитаны на product head a6ea8e7. Upstream SHA-256: release API 0fb6f575..., CHANGELOG 7abf62a9...

## 14. Что не сделано / unresolved

- U-2.1.288 (note voice) сознательно deferred: это продуктовое поведение промпта,
  которое требует своей задачи, RED->GREEN и отдельного evidence. В рамках этого scope не реализуется.
- Upstream-алгоритм остаётся unknown; открыт для переоценки только при официальном раскрытии.
- Merge в main не выполнялся: PR оставлен на независимое ревью ChatGPT.
- Автоматизация (Scheduled Tasks) не создавалась и не изменялась; внешнее weekly read-only
  уведомление «You Should Know Upstream» используется как intake-триггер и не пересоздаётся.

## 15. Rulings

- Docs-only + один структурный тест вместо правки промпта под 2.1.288. Причина: goal
  прямо допускает docs/workflow-only и запрещает расширять scope; изменение voice —
  отдельное продуктовое поведение. Цена ошибки: gap остаётся нереализованным до своей задачи.
- Ledger сделан машиночитаемым с отдельным тестом, а не только markdown-таблицей.
  Причина: AC-2 требует проверяемую трассировку evidence; тест ловит голословный паритет
  и молчаливое «tracked» у реального gap. Цена ошибки: при смене схемы нужно править тест.
- Baseline при 2.1.288/2.1.290 опирается на CHANGELOG.md, привязанный к commit SHA,
  а не к web-странице main. Причина: main мутабелен; короткие официальные фразы должны
  оставаться проверяемыми. Цена ошибки: SHA нужно обновлять при переоценке.
