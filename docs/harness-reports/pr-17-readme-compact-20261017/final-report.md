# Final report — pr-17-readme-compact-20261017

**Статус:** READY_FOR_CHATGPT_REVIEW · merge, tag, release, publish и install не выполнялись.
**TASK_ID:** не передан владельцем; исторический TASK_ID отсутствует. Идентичность задачи — PR #17, ветка `docs/readme-compact-reference` и review comment `6238502543`. TASK_ID не выдумывался.
**База (PR base):** `48630cae8c42d5e4a5f39d71a5e3e2ee1b3f932e` (origin/main).
**Preliminary head:** `70b538e705de0546da34e04f2dba5d1c6ae8776a` — head, на котором ChatGPT вернул CHANGES_REQUIRED.
**Final source/evidence commit:** `549bf7d32abbd39d664460cc522b75ead89d80a3` — на нём выполнены финальные pack/тесты/линки/diff/security; это parent текущего PR head.
**Report commit:** docs-only коммит с этим отчётом и финальными логами; точный SHA — в PR #17 head и handoff, потому что файл входит в тот же коммит.
**PR:** [#17](https://github.com/PipaGs/dsh-you-should-know/pull/17).
**Инструмент:** DeepSeek Harness, supervised goal `goal-session-35b69f35-145e-4032-bc80-56afdd4ffe70`, revision 1, mode strict.

---

## 1. Что просили

Исходный intent владельца: сократить README, перенеся детали в `docs/reference.md`, сохранив рабочие ссылки, тестовые якоря, продуктовый код и human-only invariant.

ChatGPT review вернул CHANGES_REQUIRED (comment `6238502543`, 2026-10-17T18:23:20Z) с тремя пунктами:

1. **REPORT_NOT_REVIEWABLE:** в PR нет task-owned `final-report.md` с acceptance matrix, идентичностью, baseline/final SHA, reviewable evidence, `DIFF_SANITY`, `SECURITY_SANITY`, `VISUAL_GATE` и правдивыми пометками об external research/debugging.
2. **Проверить package-состав:** README ссылается на `./docs/reference.md`, а `package.json` `files` не включает `docs`. Нужен `npm pack --dry-run --json`; при подтверждении — минимальный адресный фикс, гипотезу не выдавать за причину.
3. После правок актуализировать evidence, повторить инвалидированные проверки, сделать diff/security sanity, проверить remote branch/head, отправить тот же PR на повторное ревью; merge не выполнять.

## 2. Границы (scope / write set)

| Файл | Изменение |
|---|---|
| `README.md` | Сокращён: 437 → 223 строки, 9 223 → 3 046 слов; детали вынесены в reference (коммит `70b538e`). |
| `docs/reference.md` | Новый файл, 302 строки: полные контракты, схемы, runtime, update checker, limitations, test coverage. |
| `package.json` | Одна строка: `docs/reference.md` добавлен в `files`. |
| `docs/harness-reports/pr-17-readme-compact-20261017/final-report.md` | Этот отчёт (report commit). |
| `docs/harness-reports/pr-17-readme-compact-20261017/evidence/*` | Сырые логи и воспроизводимые скрипты (source commit + report commit). |

Не тронуто: `lib/*`, `test/*`, `cordis.patch.yml`, `docs/upstream/*`, исторические `docs/harness-reports/ysk-*`, версии, теги, релизы. Merge/tag/publish/install не выполнялись.

## 3. История попыток и состояние

| Шаг | Факт | Evidence |
|---|---|---|
| 1 | PR #17 открыт с head `70b538e`: только README и `docs/reference.md`. | PR #17 |
| 2 | ChatGPT вернул CHANGES_REQUIRED: нет отчёта, package-состав не проверен. | comment `6238502543` |
| 3 | `npm pack` на `70b538e` воспроизвёл отсутствие reference. | `evidence/pack-before.txt`, `pack-before.json` |
| 4 | Добавлен адресный фикс `package.json` + evidence. | commit `549bf7d` |
| 5 | На `549bf7d` повторены pack, links, targeted/full tests, diff/security sanity; добавлен этот отчёт. | `evidence/*-final.txt` |
| 6 | Push и проверка remote/PR — после этого коммита; результат в handoff. | `git ls-remote`, `gh pr view` |

Перед началом раунда local head = remote head = `70b538e`; ветка была checked out в одном worktree, незапушенных коммитов не было. Других писателей в эту ветку не обнаружено (`evidence/provenance.txt`).

## 4. Package-дефект: подтверждение, причина, фикс

**Симптом (воспроизведён):** `npm pack --dry-run --json` на `70b538e` вернул 17 файлов; `README.md: true`, `docs/reference.md: false`. Ссылка `./docs/reference.md` в упакованном README не разрешалась.

**Причина (установлена прямым evidence, не гипотеза):** `package.json` `files` содержал только `lib`, `cordis.patch.yml`, `README.md`, `LICENSE`. `docs/reference.md` под этот whitelist не попадал.

**Минимальный фикс:** в `files` добавлена одна строка `"docs/reference.md"`. Больше ничего в `package.json` не менялось; `dependencies` не менялись.

**Проверка после фикса:**

| Проверка | Результат | Лог |
|---|---|---|
| `npm pack --dry-run --json` на `549bf7d` | 18 файлов, `README.md: true`, `docs/reference.md: true`, EXIT 0 | `pack-after-final.txt` |
| Реальный `npm pack` + `tar -xzf` | `docs/reference.md` присутствует в tarball, 18 entries | `pack-tarball-files.txt`, `links-final.txt` |
| Относительные ссылки внутри пакета | новая ссылка `docs/reference.md` и все её анкоры OK; `docs/reference.md -> ../README.md` OK | `links-final.txt` |
| Относительные ссылки и анкоры в репозитории | 0 битых, EXIT 0 | `repo-link-check.txt`, `links-final.txt` |

**Про `docs/upstream/README.md`:** эта ссылка в упакованном README остаётся неразрешённой, но это **не регрессия этого PR**. На базовом коммите `48630ca` README уже ссылался на `docs/upstream/README.md`, а `files` уже не включал `docs` (`evidence/preexisting-upstream-link.txt`). Файл не менялся; расширение scope на упаковку всего maintainer-документа не делалось.

**Окружение:** первый вызов `npm pack` в sandbox не смог записать дефолтный npm log dir; повтор с временными `npm_config_cache`/`npm_config_logs_dir` дал EXIT 0. На состав пакета это не влияет.

## 5. Acceptance matrix

| AC | Требование | Статус | Доказательство |
|---|---|---|---|
| AC1 | README короче, детали перенесены в `docs/reference.md` | **PASS** | 437 → 223 строки, 9 223 → 3 046 слов; reference 302 строки; коммит `70b538e` |
| AC2 | Ссылки README/reference валидны в репозитории | **PASS** | 0 битых ссылок/анкоров, EXIT 0 (`links-final.txt`) |
| AC3 | Новая reference доступна в распространяемом пакете | **PASS** | pack: 18 файлов, reference true; tarball + link check (`pack-after-final.txt`, `links-final.txt`) |
| AC4 | Продуктовый код и human-only invariant не изменены | **PASS** | `lib/`, `test/`, `cordis.patch.yml` не менялись; invariant-тесты в targeted 20/20 |
| AC5 | Тестовые якоря README сохранены | **PASS** | `release-consistency` и `install-discovery` зелёные в targeted 20/20 |
| AC6 | Полный suite зелёный на финальном source | **PASS** | 562/562, 0 fail, EXIT 0 (`test-full-final.txt`) |
| AC7 | Reviewable отчёт и evidence в PR | **PASS** | этот файл + `evidence/*` в report commit |
| AC8 | Diff/security sanity | **PASS** | 17 файлов, +1471/−310; 0 секретов, 0 приватных путей; whitespace EXIT 0 (`diff-sanity.txt`, `security-sanity.txt`) |
| AC9 | Remote/PR parity, без merge | **PASS (post-push)** | `git ls-remote` и `gh pr view` после push; merge/tag не выполнялись; точный head — в handoff |

## 6. Evidence index

| Файл | Что содержит | Ключевой результат |
|---|---|---|
| `provenance.txt` | base/head, PR, comment, worktrees, remote refs | `70b538e` → `549bf7d` |
| `pack-before.txt` / `pack-before.json` | pack до фикса | 17 файлов, reference отсутствует |
| `pack-after.txt` / `pack-after.json` | pack сразу после фикса (pre-commit) | 18 файлов, reference есть |
| `pack-after-final.txt` | pack на source commit | 18 файлов, reference есть, EXIT 0 |
| `pack-tarball-files.txt` | содержимое реального tarball | 18 entries, reference есть |
| `pack-link-check.txt` | ссылки в распакованном пакете | новая ссылка OK; upstream — pre-existing |
| `links-final.txt` | финальные link-check пакета и репозитория | packaged ref OK; repo 0 битых |
| `repo-link-check.txt` | ссылки/анкоры в репозитории | 0 битых, EXIT 0 |
| `preexisting-upstream-link.txt` | база `48630ca`: README → upstream, files без docs | подтверждает pre-existing |
| `test-targeted.txt` / `test-targeted-final.txt` | targeted suite | 20/20, EXIT 0 |
| `test-full.txt` / `test-full-final.txt` | полный suite | 562/562, EXIT 0 |
| `diff-sanity.txt` | name-status/stat/numstat/check | 17 файлов, whitespace clean |
| `security-sanity.txt` | scans и package diff | 0 секретов/путей, deps не менялись |
| `check-packaged-links.mjs`, `check-repo-links.mjs` | воспроизводимые проверки ссылок | используются логами выше |

## 7. Детали проверок

| Метрика | Base `48630ca` | Final source `549bf7d` |
|---|---|---|
| README | 437 строк / 9 223 слова / 61 667 chars | 223 / 3 046 / 21 102 |
| `docs/reference.md` | отсутствует | 302 строки / 6 368 слов / 42 781 chars |
| `package.json` `files` | без docs | `docs/reference.md` включён |
| Test suite | — | 562/562, 0 fail |
| Targeted (release-consistency, install-discovery, invariant) | — | 20/20, 0 fail |

UTC-время запусков и полные выводы — в `evidence/test-*-final.txt` и `evidence/pack-after-final.txt`. Команды и exit codes записаны в заголовках логов.

## 8. DIFF_SANITY

`git diff 48630ca..549bf7d`: 17 файлов, +1471/−310; README `96/310`, `docs/reference.md` новый, `package.json` `1/0`, остальное — evidence.

- `git diff --check`: пусто, EXIT 0.
- Продуктовые пути (`lib/`, `test/`, `cordis.patch.yml`) не изменены: `none`.
- Исторические отчёты и `docs/upstream/*` не изменены.
- `package.json` diff — только строка `docs/reference.md` в `files`; `dependencies` те же.

## 9. SECURITY_SANITY

- Секреты в diff: 0 совпадений (`gh[pousr]_…`, `sk-…`, `AKIA…`, private key).
- Приватные домашние пути `/Users/...` в изменённых файлах: 0.
- `dependencies` не менялись; новых импортов, роутов, auth-механизмов нет.
- Human-only invariant: `lib/*` не менялся; invariant-тесты входят в targeted 20/20 (включая English-only scan).
- Отчёт и evidence используют `<home>`/`<tmp>` вместо абсолютных путей.

## 10. EXTERNAL_RESEARCH и DEBUGGING_PROTOCOL

- **EXTERNAL_RESEARCH: NOT PERFORMED.** Веб-поиск и внешние API не использовались; источник фактов — локальный `npm pack`, git и GitHub PR metadata.
- **DEBUGGING_PROTOCOL: applied in reduced form.** Симптом (в упакованном README нет цели ссылки) → воспроизведение `npm pack` до фикса → подтверждённая причина (`files` whitelist) → минимальный фикс → проверка после фикса. Конкурирующие гипотезы не заявлялись; это packaging-дефект, не дефект продуктового кода.

## 11. VISUAL_GATE

**NOT REQUIRED.** Изменения docs/config-only: README, reference, `package.json` `files` и evidence. UI, layout, design tokens и runtime-поведение не менялись; скриншоты и визуальная проверка не применимы.

## 12. Ограничения и что не проверялось

- `scripts/install-smoke.mjs` (живая GitHub-установка) не запускался: для docs/packaging-изменения достаточно offline `npm pack`; сетевые установки не заявляются.
- Pre-existing ссылка `docs/upstream/README.md` в упакованном README не исправлялась — вне scope этого PR, доказано на базе.
- Точный SHA report commit не может быть вписан в сам файл; он фиксируется в PR head и handoff.
- Merge, tag, release, publish, install и правка исторических отчётов не выполнялись.

## 13. Handoff

READY_FOR_CHATGPT_REVIEW. Source/evidence commit `549bf7d32abbd39d664460cc522b75ead89d80a3`; отчёт и финальные логи — в report commit, который станет PR head. Merge не выполнять.
