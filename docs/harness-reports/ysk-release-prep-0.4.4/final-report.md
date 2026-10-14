# Final report — ysk-release-prep-0.4.4

**Статус:** READY_FOR_CHATGPT_REVIEW · DSH не создаёт тег, не публикует release, не
устанавливает плагин, не мержит и не self-approve.
**База:** origin/main `b11537934f54dad82a28404b735e6c4e7bc387c0` (merge PR #15;
подтверждено `git rev-parse origin/main` и `git ls-remote`, evidence/provenance.json).
**Ветка:** `chore/ysk-release-prep-0.4.4` (worktree `.worktrees/ysk-release-prep-0.4.4`;
создан от origin/main, других worktree не касались).
**Product commit:** `2acaed19e8944df165d8bc57820d9f4081659ad8` (версия/README/тесты).
**Evidence commit:** финальный коммит этой ветки (добавляет только
`docs/harness-reports/ysk-release-prep-0.4.4/`; точный SHA — в PR head, потому что
этот отчёт входит в тот же коммит).
**TASK_ID:** ysk-release-prep-0.4.4 (новый).
**Кандидат:** `v0.4.4` — patch-инкремент; тег **не создан**.
**PR:** один, из этой ветки в main; точный head фиксируется в описании PR.
**Инструмент:** DeepSeek Harness, supervised goal
`goal-session-eee9b689-f761-468c-a033-71861ee32e18`, revision 2, mode strict.

---

## 1. Что просили

Stage 6 release preparation: определить фактический следующий semver по
конвенциям репозитория, синхронизировать version-mirrors, подготовить точные
release notes для PRs #12–#15, усилить обнаружение stale version/install-ref
тестами (TDD), собрать evidence, открыть **один** PR в main и остановиться на
ревью ChatGPT. Запрещено: tag/publish/release/install/merge, любая мутация
установленного плагина, профиля, Desktop, чужих веток и worktrees; никакого
provider inference, balance-вызовов, платных запросов; никаких wallet-балансов,
API-ключей и приватных путей в публичных артефактах.

## 2. Границы (scope / write set)

Продуктовый дифф (13 insertions / 13 deletions, 6 файлов):

| Файл | Что |
|---|---|
| `package.json` | `version` 0.4.3 → 0.4.4 |
| `lib/index.js` | `PLUGIN_VERSION` 0.4.3 → 0.4.4 |
| `README.md` | Status-строка, tag-pinned install-адрес `#v0.4.3` → `#v0.4.4`, self-check sample (pluginVersion/runtimeVersion/installedVersion/update.currentVersion) |
| `test/invariant.test.js` | литерал версии манифеста → 0.4.4 |
| `test/plugin.test.js` | три литерала self-check payload → 0.4.4 |
| `test/update-route.test.js` | литерал «PLUGIN_VERSION mirrors package.json» → 0.4.4 |

Новые файлы:

| Файл | Что |
|---|---|
| `test/release-consistency.test.js` | новый offline release-гейт: patch-инкремент, согласие package.json/`PLUGIN_VERSION`/README install-адреса, README self-check sample, отсутствие stale `0.4.3` в released-артефактах |
| `docs/harness-reports/ysk-release-prep-0.4.4/final-report.md` | этот отчёт |
| `docs/harness-reports/ysk-release-prep-0.4.4/release-notes-v0.4.4.md` | **кандидат** текста GitHub Release, не опубликован |
| `docs/harness-reports/ysk-release-prep-0.4.4/evidence/*` | сырые логи, provenance, ls-remote |

Не тронуто: `lib/*` кроме константы версии, `cordis.patch.yml`, `docs/upstream/`
(включая `ledger.json` и `README.md`), все исторические
`docs/harness-reports/ysk-*`, `scripts/*`, существующие тесты кроме трёх
версионных литералов. Тег `v0.4.3`, GitHub Release `v0.4.3`, managed Desktop,
профиль, чужие worktrees и ветки не изменялись.

## 3. Аудит базы, тега и конвенций

| Факт | Значение | Evidence |
|---|---|---|
| origin/main | `b11537934f54dad82a28404b735e6c4e7bc387c0` | provenance.json |
| Открытые PR | нет | `gh pr list --state open` → `[]` |
| Последний remote-тег до релиза | `v0.4.3` (и больше ничего) | `ls-remote` (read-only) → evidence |
| Старый tag pointer | annotated object `7d392bd65e07fdbd42530e56d32698a05edeba52` → commit `b6a202d00e80e6069c07b03e65034b4280756f1d` («Merge pull request #10») | `git cat-file -p v0.4.3`, remote |
| GitHub Release v0.4.3 | существует, `targetCommitish: main`, создан 2026-10-13T14:51:08Z | `gh release view v0.4.3` |

**Конвенция версионирования (проверена по истории):** patch-инкремент на каждый
смерженный блок изменений; все зеркала синхронизируются одним коммитом.
Предпоследний цикл (`v0.4.2 → v0.4.3`, PR #10) менял ровно те же 6 файлов и
README-адрес. Тогда же было доказано, что install-адрес — enforcement-зеркало:
`test/install-discovery.test.js` требует, чтобы каждый `dsh plugin add` адрес в
README равнялся `github:PipaGs/dsh-you-should-know#v${package.json version}`.

**Release-конвенция публикации:** GitHub Release с телом из секций
`## Highlights`, `## Install`, `## Verification on the merged commit`
(проверено `gh release view v0.4.3` / `v0.4.2`). Тег — annotated (у `v0.4.3`
тело тега = `v0.4.3`), ставится на merge-коммит PR.

**Кандидат `v0.4.4` обоснован:** после `v0.4.3` смержены PRs #12–#15. #12 добавил
правило voice в существующий prompt (новая инструкция, без изменения JSON-контракта
и поведения host/client), #13–#15 — офлайн-оценку, live-runner и offline-рекалибровку.
Ломающих изменений нет, удаления функциональности нет; по фактической политике
репозитория это следующий patch. Более высокая версия (0.5.0) не следует из
конвенции и не подтверждена ни одним продуктовым breaking change.

## 4. Acceptance criteria и результат

| AC | Требование | Статус | Доказательство |
|---|---|---|---|
| AC1 | Кандидат версии и все зеркала = 0.4.4 | **PASS** | `package.json`/`PLUGIN_VERSION`/README: Status, install-адрес, self-check sample; `test/release-consistency.test.js` 4/4 |
| AC2 | Тесты фиксируют stale version/install-ref (TDD RED → GREEN) | **PASS** | RED: 3/3 fail на unbumped источнике; контролируемая репродукция гейта: 2/4 fail; GREEN: 4/4 и 555/555 |
| AC3 | Единственный offline-инкремент, никаких новых зависимостей/роутов/полей | **PASS** | numstat: 6 файлов, +1 файл теста; `package.json` `files`/`dependencies` не менялись |
| AC4 | `npm run check` | **PASS** | `check-final.txt`, `EXIT=0` |
| AC5 | `npm test` (полный suite) | **PASS** | `test-run-final.txt`: 555/555, 0 fail, `EXIT=0` |
| AC6 | Human-only invariant не ослаблен | **PASS** | `invariant-final.txt`: 11/11; `lib/client.js` не менялся |
| AC7 | Upstream ledger baseline/tag semantics корректны | **PASS** | `test/upstream-ledger.test.js` 8/8 (в составе 24/24 invariants+ledger+install-discovery) |
| AC8 | Install/discovery тесты и README-адрес | **PASS** | `test/install-discovery.test.js` зелёный; адрес = `pinnedSpec(manifest.version)` |
| AC9 | Историческое evaluation не переписано, parity не заявлен | **PASS** | `docs/harness-reports/ysk-*` и `docs/upstream/*` без изменений; release notes говорят 0 PASS / 2 FAIL / 2 SILENT, `adapted`, no parity |
| AC10 | Security/privacy public artifacts | **PASS** | §7 |
| AC11 | Ровно один PR, без tag/publish/install | **PASS** | PR один; `provenance.json.notExecuted`; тег `v0.4.4` отсутствует |

## 5. RED → GREEN

**RED (version mirrors).** Сначала обновлены версионные литералы в трёх тестах,
источник остался `0.4.3` (`evidence/test-run-red-version-mirrors.txt`, `EXIT=1`):

```text
✖ the manifest declares the bundle, the client half, and no build step      '0.4.3' !== '0.4.4'
✖ the authenticated self-check route reports only the bounded running plugin state  '0.4.3' !== '0.4.4'
✖ the exported plugin version mirrors package.json                          '0.4.3' !== '0.4.4'
ℹ tests 3   ℹ pass 0   ℹ fail 3
```

**Контролируемая репродукция нового release-гейта.**
`test/release-consistency.test.js` (ожидания 0.4.4) запущен на дереве, где
`package.json`/`lib/index.js` временно возвращены к `0.4.3`
(`evidence/test-run-red-release-consistency-repro.txt`): 2/4 fail, в том числе
`no released artifact still documents the previous version`. Затем источники
восстановлены (`0.4.4`); гейт снова 4/4.

**GREEN.** Финальное дерево:

```text
$ node --test test/release-consistency.test.js
ℹ tests 4   ℹ pass 4   ℹ fail 0           (test-run-green-release-consistency.txt)

$ node --test test/invariant.test.js test/upstream-ledger.test.js test/install-discovery.test.js
ℹ tests 24  ℹ pass 24  ℹ fail 0           (test-run-green-invariants-ledger-install.txt)

$ npm run check    # EXIT=0                (check-final.txt)
$ npm test
ℹ tests 555  ℹ pass 555  ℹ fail 0  EXIT=0 (test-run-final.txt)
```

Baseline на той же базе `b115379` до правок: `npm run check` EXIT=0,
`npm test` 551/551 (`check-baseline.txt`, `test-run-baseline.txt`). Дельта
+4 теста — ровно новый release-гейт; регрессий нет.

## 6. Release publication sequence (выполняет владелец/ChatGPT после merge)

DSH **не выполнял** ни одного шага ниже; порядок следует из фактической
release-конвенции и из того факта, что GitHub install резолвит **опубликованный**
тег, а не ветку.

1. **Merge** этого PR в main (ChatGPT). Зафиксировать точный merge-коммит
   `<MERGE_SHA>`.
2. **Проверка на merge-коммите:** `git checkout <MERGE_SHA> && npm run check && npm test`
   (ожидание: 555/555; `test/release-consistency.test.js` 4/4). Проверить, что
   `package.json == PLUGIN_VERSION == README install-адрес == 0.4.4`.
3. **Annotated tag** на merge-коммит:
   `git tag -a v0.4.4 <MERGE_SHA> -m v0.4.4` (совпадает с формой тега `v0.4.3`).
   **Точный объект кандидата: тэг `v0.4.4`, target = merge-коммит этого PR.**
   До merge target неизвестен — DSH намеренно не выдумывает его.
4. **Push тега:** `git push origin v0.4.4`. Снять `git ls-remote --tags` и
   зафиксировать object/target.
5. **GitHub Release** `v0.4.4` из кнопки/CLI, body — из
   `docs/harness-reports/ysk-release-prep-0.4.4/release-notes-v0.4.4.md`
   (заполнить фактические числа verification на merge-коммите; candidate text
   публикуется дословно, кроме этих чисел).
6. **Install-проверка (опционально, отдельно от prep):** `npm run smoke:install`
   уже можно запускать с адресом `github:PipaGs/dsh-you-should-know#v0.4.4`
   (он резолвится только после шага 4). Скрипт создаёт временные каталоги в
   `$TMPDIR` и удаляет их; профиль/Desktop не трогает.

**Compatibility/ownership.** Тег `v0.4.4` не конфликтует ни с одним существующим
(refs/tags: v0.3.1…v0.4.3). Изменения совместимы: JSON-контракт reviewer'а, роуты,
конфиг и human-only изоляция не менялись; правило voice — только текст инструкции.
Публикация тега/релиза — за владельцем/ChatGPT, DSH не self-approve.

**Rollback.** Source-инкремент откатывается обычным revert-коммитом; тег и GitHub
Release удаляются/переносятся владельцем. Если тег ещё не отправлен — удалить
локально. Если отправлен и найден дефект — `git tag -f`/пересоздание Release
**только с явного решения владельца** (перезапись опубликованного тега меняет
immutable ref для уже установивших). Корректная альтернатива без перезаписи — выпустить
следующий patch. README до публикации тега указывает на ещё не существующий ref —
это та же конвенция, что и в прошлом релизе (README `#v0.4.3` до появления тега);
установка по нему до шага 4 не удастся, self-check/update-check продолжат работать
и показывать адрес.

## 7. Security / privacy sanity

- Продуктовый дифф содержит только version-строки; `git grep` по диффу не находит
  ключей, токенов, пути `/Users/...`, приватных данных.
- Новый `test/release-consistency.test.js` читает только файлы репозитория, сети
  не касается; `node --check` и 4/4 зелёные.
- Ни одного provider-вызова, balance-вызова или платного запроса не сделано.
  Единственная сетевая операция за задачу — read-only
  `git ls-remote --tags --refs https://github.com/PipaGs/dsh-you-should-know.git`
  (проверка последнего тега), результат в `evidence/ls-remote-tags-before-release.txt`.
- Публичные артефакты: `package.json` `files` = `["lib","cordis.patch.yml","README.md","LICENSE"]`
  (npm-тарбол новых файлов не получает). GitHub-install ставит репозиторий целиком,
  поэтому `scripts/` и `test/` публичны; они не содержат секретов: `DEEPSEEK_API_KEY`
  читается только из окружения, не логируется и не пишется в отчёт,
  live-runner двойной gate `--live --confirm-spend`.
- Wallet-балансы: в публичной истории уже лежат `balance-before.json`/`balance-after.json`
  без чисел (только 200/available и пометка, что суммы не коммитятся). В этом PR
  новых balance-артефактов нет.
- Human-only invariant: `lib/client.js` и host-логика не менялись; 11/11 invariant
  тестов зелёные; никаких новых путей к primary agent.

## 8. Rulings

- **Взят `v0.4.4`, не `0.5.0`.** Конвенция — patch на смерженный блок; #12–#15 не
  ломают API/контракт и не удаляют функциональность. Цена ошибки: если ревьюер решит,
  что новое правило voice заслуживает minor, потребуется переименовать кандидата до
  публикации тега (обратимо, тег ещё не создан).
- **`docs/upstream/ledger.json` и `docs/upstream/README.md` не обновлялись.**
  Их `local.version/tag/head` описывают *baseline*, на котором снимался
  upstream-цикл (`v0.4.3` → `ec07de1`), а не текущий релиз; `test/upstream-ledger.test.js`
  требует лишь внутренней согласованности (`tag === 'v' + version`, head — реальный
  коммит). Обновление до `0.4.4` потребовало бы head merge-коммита, которого ещё
  нет, и создало бы ложное утверждение о несуществующем теге. Цена ошибки: если
  ревьюер захочет «живой» ledger, это отдельная правка после публикации тега.
- **Исторические отчёты не переписывались.** `equivalent` → `adapted` — forward-only
  correction, сделанная **раньше** stage 5 (PRs #11–#14); stage 5 (PR #15) явно
  `docs/upstream/ledger.json` **не изменял**, а сохранил `localStatus: adapted` /
  `liveVerification.status: run-no-pass` как есть (см. stage-5 report §12). Этот PR
  ledger тоже не трогает: `git diff origin/main -- docs/upstream/ledger.json` пуст.
- **`npm run smoke:install` не запускался.** Скрипт не мутирует `~/.dsh` (временные
  каталоги в `$TMPDIR`), но требует сети и **опубликованного** тега; `v0.4.4` ещё нет.
  Offline-эквивалент (`test/install-discovery.test.js`) и release-гейт закрывают
  обнаружение и адрес в CI; smoke логично запускать после публикации.
- **Release notes добавлены в report-каталог, а не в README.** Публичный
  release-note артефакт репозитория — GitHub Release body; в репозитории нет
  CHANGELOG. Выдумывать новый публичный файл-конвенцию не стал.

## 9. Что не сделано / unresolved

- Тег `v0.4.4`, push тега, GitHub Release, npm publish, установка — **не выполнены**
  (вне scope).
- Установленный плагин/профиль/Desktop не обновлялись; прежний `v0.4.3` остаётся
  установленным и рабочим.
- Точный target нового тега (merge-коммит) будет известен после merge.
- Merge не выполнялся; PR # (номер) оставлен на ревью ChatGPT.
- `npm run smoke:install` отложен до появления тега.

## 10. External research

- **NOT REQUIRED.** Изменение не вводит библиотек/API/версий зависимостей;
  Context7 и веб-поиск не требовались. Единственная внешняя операция — read-only
  `git ls-remote` к собственному репозиторию (см. §7).

---

## Review update — round 1 (2026-10-14, CHANGES_REQUIRED по PR #16)

Ревью ChatGPT на точном head `61e020f3015511613a719758b0a87b555cbc915d` вернуло
CHANGES_REQUIRED. Весь фидбек текущего head прочитан и сгруппирован; правки внесены
одним batch. Разделы §1–§10 выше сохранены как исходный handoff; ниже — только новые
факты и исправления этого раунда.

### F1 (blocker) — ложная семантика stage 5 в release notes

Прежний текст `release-notes-v0.4.4.md` утверждал, что «semantic review found the
two FAIL verdicts to be proxy false positives» и что «the two SILENT cases [were]
legitimate silence». Оба утверждения противоречат merged stage-5 report (PR #15):

- lexical false positive ровно один — agent-owned FAIL (сработал маркер
  `your instruction` на пользовательском constraint), v2 переводит его в PASS;
- human-owned FAIL остаётся **повторяющейся substantive attribution gap**: v2-статус
  FAIL, human-ownership в note по-прежнему отсутствует;
- joint SILENT → `EXPECTED_SILENCE` (excerpt вне selection gate);
- unclear SILENT → `SILENT_UNKNOWN` (gate не доказан), а не «подтверждённая тишина».

Исправлено фактически и минимально: §`## Evaluation status` в release notes теперь
даёт точные статусы (исторический v1 0 PASS / 2 FAIL / 2 SILENT; v2-ретроспектива
1 PASS, 1 FAIL, 1 EXPECTED_SILENCE, 1 SILENT_UNKNOWN на сохранённом тексте, не новый
model run), отдельно называет единственный lexical false positive, оставляет
human-owned FAIL как gap, и прямо пишет, что **generated model pass не заявляется**,
а **полный сырой reply исторического прогона не сохранён**.

### F2 — ложная атрибуция ledger к PR #15

Прежняя формулировка «Semantic recalibration of the ledger item (PR #15) …
equivalent corrected forward» неверна: stage 5 (PR #15) `docs/upstream/ledger.json`
**не изменял**. Зафиксировано: stage 5 откалибровал **evaluator** и **сохранил**
существующую ledger-запись (`localStatus: adapted`, `liveVerification.status:
run-no-pass`), а `equivalent → adapted` было исправлено раньше (PRs #11–#14).
Тот же факт поправлен в §8 (Rulings) выше; `git diff origin/main -- docs/upstream/ledger.json`
пуст (ledger этим PR не трогается).

### F3 — гигиена локальных путей в новых публичных evidence

В новых stage-6 evidence-файлах были абсолютные пути вида
`file://<local-abs-worktree>/…` (2 в `test-run-red-release-consistency-repro.txt`,
3 в `test-run-red-version-mirrors.txt`). Префикс заменён на `file://<repo>/`; числовые
исходы и assertions не изменялись. Дополнительно исправлен ошибочный `EXIT=0` в
repro-логе на фактический `EXIT=1` (2/4 fail) — это тоже не меняет исход. Запись о
санитизации — `evidence/path-sanitization-note.txt` (новый файл, append-only).
Исторические отчёты и прежние evidence **не изменялись**.
После санитизации поиск абсолютного домашнего префикса по
`docs/harness-reports/ysk-release-prep-0.4.4/` даёт пусто (команда без самого
префикса — в `evidence/path-sanitization-note.txt`).

### F4 — publication body начинается с Highlights

Раньше файл начинался с `# Proposed release notes — v0.4.4` и статус-преамбулы.
Теперь `release-notes-v0.4.4.md` начинается строкой 1 с `## Highlights` и является
точным телом GitHub Release; кандидат-метаданные и карта источников вынесены в
`release-notes-v0.4.4-candidate.md`.

### F5 — новый read-only regression

`test/release-notes-consistency.test.js` (offline, без сети): тело начинается с
`## Highlights`; точные v1/v2 статусы; отсутствие обоих ложных утверждений
(«proxy false positives», «legitimate silence», «equivalent → adapted»);
явные «no generated model pass» и «historical full raw reply … not preserved»;
ledger «retained, not edited by stage 5»; merged stage-5 report всё ещё содержит
четыре ретро-статуса; исторический live-record 0/2/2 и `equivalenceClaimed: false`.
Контролируемый RED: на pre-fix теле release notes гейт дал 5/7 fail
(`evidence/test-run-red-release-notes.txt`), после правки 7/7 pass.

### Verification round 1

| Проверка | Результат | Evidence |
|---|---|---|
| `test/release-notes-consistency.test.js` | 7/7 pass | `test-run-green-release-notes.txt` |
| controlled RED на pre-fix notes | 5/7 fail | `test-run-red-release-notes.txt` |
| `test/release-consistency.test.js` | 4/4 pass | `test-run-green-release-consistency-rev2.txt` |
| `test/release-notes-consistency.test.js` | 7/7 pass | `test-run-green-release-notes.txt` |
| `npm test` | 562/562, 0 fail (на final tree round 1) | `test-run-final-rev2.txt` |
| `npm run check` | EXIT=0 | `check-final-rev2.txt` |
| invariants / ledger / install-discovery | 24/24 | `test-run-green-invariants-ledger-install-rev2.txt` |
| version mirrors | 0.4.4 во всех зеркалах | `version-scan-rev2.txt` |
| secret/diff sanity | без секретов и абсолютных путей | `security-diff-sanity-rev2.txt` |
| `lib/**` | изменена только константа версии | `diff-summary-rev2.txt` |

`v0.4.4`, tag/release/install/merge и платные/provider-вызовы по-прежнему **не
выполнялись**.
