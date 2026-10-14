# Final report — ysk-note-voice-eval-20261014

**Статус:** READY_FOR_CHATGPT_REVIEW · DSH не мержит и не релизит.
**База:** origin/main 7b4ba87ba36e61fcf778541338402981b8791524 (PR #12 merged;
release tag v0.4.3 указывает на ec07de154aa36688db6e8fe85cbf7c1233fac9ab).
**Ветка:** test/ysk-note-voice-eval-20261014 (создана от 7b4ba87 в отдельном worktree).
**TASK_ID:** ysk-note-voice-eval-20261014 (новый; не переиспользует закрытую
задачу ysk-note-voice-attribution-20261014).
**PR:** один, из этой ветки в main; точный PR head фиксируется в описании PR.
**Инструмент:** DeepSeek Harness, supervised goal
goal-session-e96c6eb6-ea2c-418a-b700-7b42a69ea59b, revision 1, mode strict.

---

## 1. Что просили

Следующий этап: evidence-backed live-model оценка voice-правила Claude Code
2.1.288, смерженного в PR #12. Нужна минимальная воспроизводимая ограниченная
оценка на синтетических сценариях: (1) решение явно принадлежит main agent,
(2) человеку, (3) совместное, (4) ответственность неясна — note нейтрален.
Проверить, что note-to-human и optional action разделены, а blame не
выдумывается. Ограничение владельца: никаких дополнительных платных сервисов,
подписок, настройки провайдеров и новой внешней инфраструктуры. Наличие
credential само по себе не доказывает нулевой инкрементальный расход. Live
вызовы — только если существующий entitlement и нулевой incremental spend
реально установлены по доступным метаданным; иначе безопасный opt-in
evaluator и все невыполненные live-кейсы NOT_RUN с точным blocker. Нельзя
вызывать модель через неодобренный платный маршрут и нельзя фабриковать live
результаты или повышать статус ledger без valid evidence.

## 2. Аудит базы и окружения

| Факт | Значение |
| --- | --- |
| Репозиторий | PipaGs/dsh-you-should-know |
| origin/main | 7b4ba87ba36e61fcf778541338402981b8791524 (feat: атрибуция voice ... (#12)) |
| Release tag v0.4.3 | ec07de154aa36688db6e8fe85cbf7c1233fac9ab (main до PR #12) |
| Открытые PR | нет (gh pr list — пусто; pull refs 1..12) |
| Merged voice-правило | lib/core.js:635, REVIEW_INSTRUCTIONS; sha256 lib/core.js 44c816e22900a3def3eb670bc657aedbc7a67baa3f596c9d7c3faa46a0ea0bc9 |
| Изолированный worktree | .worktrees/ysk-note-voice-eval (HEAD 7b4ba87) |
| Node / npm | node v26.9.0 |
| Installed desktop plugin | dsh-you-should-know@0.4.3 (github tag v0.4.3), core.js sha256 b05226c5… — старее merged PR #12, то есть хостовый дефолт собрал бы более старый промпт |
| Отчётная конвенция | docs/harness-reports/<TASK_ID>/final-report.md |

WRITE SET (disjoint): scripts/note-voice-eval.mjs, test/note-voice-eval.test.js,
package.json (только scripts), docs/upstream/ledger.json, docs/upstream/README.md,
docs/harness-reports/ysk-note-voice-eval-20261014/**. lib/** не тронут.
Чужие worktrees и ветки не изменялись.

## 3. Аудит маршрута и стоимости (решение: live NOT_RUN)

Проверено по метаданным, без чтения значений секретов:

- ~/.dsh/.credentials.yaml содержит refs DEEPSEEK_API_KEY и
  OPENROUTER_API_KEY; оба провайдера тарифицируются за токены. Значения не
  читались.
- ~/.dsh/settings.yaml.imported задаёт agent-default-model:
  provider=deepseek-official, model=deepseek-flash. Reviewer route по
  умолчанию автоматический и резолвится в DeepSeek-маршрут (lib/core.js).
- Ни в ~/.dsh, ни в DSH checkout не найдено метаданных о subscription,
  included quota, free tier или local/offline route. Локальной бесплатной
  модели нет.
- Наличие credential не доказывает нулевой incremental spend; платный token
  usage через reviewer route не исключён. Поэтому live-вызовы НЕ выполнялись.

**Ruling:** live evaluation не запускалась; все 4 кейса NOT_RUN. Blocker:
отсутствует подтверждённый zero-incremental-cost маршрут; credential — не
доказательство. Цена ошибки при обратном решении: реальный платный расход и
нарушение owner constraint.

## 4. Что реализовано

scripts/note-voice-eval.mjs — opt-in, fail-closed evaluator (без сети):

- SYNTHETIC_CASES — ровно 4 синтетических нечувствительных сценария
  (agent-owned, human-owned, joint, unclear) с фиксированными excerpt и
  детерминированным ожиданием владельца.
- attributeOwners / adjudicateCase — детерминированная лексическая
  адъюдикация по явным маркерам ответственности (agent / we / you-ownership);
  неадресное you should ... владением не считается. unclear проходит
  только при полном отсутствии атрибуции — иначе FAIL «attribution invented».
- note-to-human и optional action адъюдицируются раздельно: voice считается по
  note, action репортится отдельно со своими маркерами.
- Терминальные статусы различимы: PASS, FAIL, INVALID, SILENT, DROPPED,
  TIMEOUT, NOT_RUN.
- Границы EVAL_LIMITS: maxCases 4, maxAttemptsPerCase 1, concurrency 1,
  callTimeoutMs 20000, totalDeadlineMs 90000, maxReplyChars 4000; скрытых
  retry нет.
- resolveLiveGate fail-closed: нужен и --live, и явная аттестация
  YSK_EVAL_COST_ATTESTATION=zero-incremental-cost; по умолчанию disabled.
- Standalone CLI не открывает сетевое соединение вообще; live-исполнение
  возможно только через stream, переданный хостом. --print-prompts печатает
  точные промпты для внешнего прогона.
- runEvaluation пинует версию промпта (promptVersion, sha256
  REVIEW_INSTRUCTIONS), фиксирует route, если он передан, и всегда ставит
  equivalenceClaimed: false + явные limitations.

test/note-voice-eval.test.js — 15 offline contract-тестов (без сети).

package.json — добавлен ручной eval:note-voice; syntax-check скрипта
добавлен в существующие check и test. Автоматических сетевых вызовов в
npm test нет.

## 5. TDD

- RED (сначала тест, модуля ещё нет): node --test test/note-voice-eval.test.js
  → ERR_MODULE_NOT_FOUND .../scripts/note-voice-eval.mjs, fail 1
  (evidence/test-run-red.txt).
- GREEN targeted: node --test test/note-voice-eval.test.js → tests 15 /
  pass 15 / fail 0.
- Полный suite: npm test → tests 511 / pass 511 / fail 0
  (evidence/test-run-final.txt). База 7b4ba87 — 496; +15 evaluator-тестов.

## 6. AC matrix

| AC | Требование | Статус | Доказательство |
| --- | --- | --- | --- |
| AC1 | 4 синтетических labelled кейса, non-sensitive fixed excerpts, детерминированные критерии, per-case output или NOT_RUN с reason | PASS | SYNTHETIC_CASES (4), тест AC1; default run JSON содержит 4 записи со статусом NOT_RUN и reason |
| AC2 | Ограничены usage/concurrency/timeout; route/version при наличии; без ключей/приватного; invalid/silent/dropped ≠ PASS | PASS | EVAL_LIMITS; runEvaluation возвращает promptVersion/route; тесты AC2; equivalenceClaimed:false; секреты не читаются |
| AC3 | Live только при доказанном cost-neutral; иначе NOT_RUN + precise blocker; offline contract-тесты валидны | PASS | resolveLiveGate fail-closed; default run — 4 NOT_RUN; live-путь проверен на инъецированном синтетическом stream (1 попытка/кейс) |
| AC4 | Никогда не выводить гарантированную upstream-эквивалентность из короткой выборки | PASS | equivalenceClaimed:false; LIMITATIONS; ledger остаётся adapted, не equivalent |
| AC5 | JSON note/action/importance, язык, отсутствие steering, human-only инвариант не изменён | PASS | adjudicateCase разделяет note/action; тест no steering channel; lib/** не тронут; test/invariant.test.js зелёный |

AC denominator: 5 AC, attempted 5, pass 5 (offline). Живые кейсы: 0 запущено,
4 NOT_RUN. Реальные PASS/FAIL живой модели: 0 — не фабрикуются.

## 7. Верификация (raw)

Финальное дерево, залогировано в docs/harness-reports/ysk-note-voice-eval-20261014/evidence/:

    npm run check -> EXIT=0 (evidence/check.txt)
    npm test -> tests 511 / pass 511 / fail 0 (evidence/test-run-final.txt)
    node --test test/note-voice-eval.test.js -> 15/15
    node scripts/note-voice-eval.mjs -> live:false, notRun:4, pass:0, fail:0,
      promptVersion 5c1fae1bef435a32416e5e85f7b3c58b2fbc3ee3138020ca3a029f3e781feac3
      (evidence/note-voice-eval-not-run.json)
    RED -> ERR_MODULE_NOT_FOUND (evidence/test-run-red.txt)

## 8. DIFF_SANITY

- Product-код (lib/**) — 0 изменений. Правки: package.json (scripts),
  docs/upstream/ledger.json, docs/upstream/README.md, новые
  scripts/note-voice-eval.mjs, test/note-voice-eval.test.js, evidence/report.
- См. evidence/diff-summary.txt.

## 9. SECURITY_SANITY

- Human-only инвариант: test/invariant.test.js зелёный; lib/ не изменён.
- Evaluator не содержит сетевых примитивов (fetch(, node:http(s),
  XMLHttpRequest) — проверяется тестом и grep.
- Evaluator читает только явную аттестационную переменную; credentials и
  session content не читаются. В вывод попадают только синтетические тексты.
- В ledger нет приватных данных, абсолютных путей, ключей и unrelated-project
  ссылок (структурный тест ledger + grep).

## 10. EXTERNAL_RESEARCH

- Требовался: нет. Новых библиотек/API/версий нет; официальный upstream-текст
  2.1.288 уже зафиксирован в ledger и evidence прошлой задачи. Внешние данные
  не загружались.

## 11. VISUAL_GATE

- N/A. Изменение не затрагивает rendered surface (нет правок lib/client.js,
  UI, routes). Визуальное доказательство объективно неприменимо.

## 12. Provenance / артефакты

См. evidence/artifacts-hashes.txt (sha256 на pre-commit working tree).
SHA product/report-коммитов вписываются в PR после push.

## 13. Что не сделано / unresolved

- Live-вывод модели не проверен: 4/4 кейса NOT_RUN из-за отсутствия
  подтверждённого zero-incremental-cost маршрута.
- Ledger: U-2.1.288-note-voice остаётся adapted / applicable; добавлен
  liveVerification.status = not-run и scoped sample limitations. Статус НЕ
  повышен до equivalent.
- Адъюдикация — детерминированный лексический proxy, а не семантическое
  доказательство; это прямо записано в limitations.
- Merge/release/version bump не выполнялись.

## 14. Rulings

- Live evaluation не запускалась (см. §3). Причина: нет доказанного
  zero-incremental-cost маршрута. Цена ошибки: отсутствует живое evidence —
  именно это и зафиксировано, без подмены.
- Адъюдикация сделана детерминированной лексической, а не ещё одним model
  call. Причина: не плодить платные вызовы и оставить проверяемый критерий.
  Цена ошибки: возможны false FAIL/PASS на нестандартных формулировках; это
  отмечено в limitations.
- Standalone CLI намеренно не содержит provider-клиента. Причина: не создавать
  обходной платный маршрут. Цена ошибки: live-прогон требует хостовой
  интеграции через инъецированный stream.
- Ledger не переведён в equivalent. Причина: нет живого evidence. Цена
  ошибки: статус остаётся консервативным.

---

## 15. Review handoff — 2026-10-14T11:06:11Z

Разделы 1–14 выше — историческая запись pre-commit рабочего дерева; они не
переписаны. Ниже — закрытый handoff-раунд.

- Task commit: 147ed784ace2b0f3d55019da8aed322ffc7e7a0b
  (test: добавить opt-in fail-closed оценку note voice (2.1.288)),
  запушен в origin/test/ysk-note-voice-eval-20261014.
- PR: https://github.com/PipaGs/dsh-you-should-know/pull/13
  (--base main, --head test/ysk-note-voice-eval-20261014).
- Base: 7b4ba87ba36e61fcf778541338402981b8791524 (origin/main после PR #12).
- Верификация на 147ed78: npm run check EXIT=0; npm test — tests 511 /
  pass 511 / fail 0; targeted 34/34; default evaluator — live:false,
  notRun 4/4. Правка отчёта product evidence не инвалидирует.
- Запись отчёта о handoff коммитится после task commit как report-only
  коммит; его SHA — фактический PR head на момент ревью.
- **Статус:** READY_FOR_CHATGPT_REVIEW. DSH не мержит и не релизит.

---

## 16. CHANGES_REQUIRED rev2 — 2026-10-14T11:25:16Z

Разделы 1–15 выше — историческая запись на reviewed head
7f365d83d4d9bb945b4cd04862589aebf1dcb311; они не переписаны. Ниже — один
закрытый review-раунд по BLOCKER из PR #13.

### F1. Timeout и overlength не закрывали iterator; следующие кейсы могли пересечься

- Было: collectOnce делал Promise.race([collect, timeout]) и возвращал TIMEOUT,
  но не abort'ил и не закрывал iterator; runEvaluation стартовал следующий
  кейс, пока предыдущий model call мог ещё быть активен. При достижении
  maxReplyChars цикл делал break без iterator.return. Это нарушало
  concurrency=1, общий bound и гарантию отсутствия лишнего расхода.
- Стало: collectOnce принимает options.signal (AbortSignal — тот же контракт,
  который lib/runtime.js и lib/core.js уже используют для llm.stream), при
  дедлайне делает controller.abort() и bounded-запрос iterator.return().
  Ожидание ограничено (EVAL_LIMITS.closeGraceMs=500, unref-таймер), брошенный
  consumer сам ловит свой rejection. Возвращается closed: boolean.
  Overlength-ответ тоже закрывает iterator bounded.
- Fail-closed stop: если closed !== true, runEvaluation фиксирует текущий кейс
  и НЕ запускает ни один следующий — остальные получают NOT_RUN с точным
  reason. TIMEOUT-попытка и no-call remaining различимы. Скрытых retry нет,
  максимум 4 вызова.
- Trust boundary: gate {live:true} — доверенная авторизация вызывающего хоста,
  а не независимая проверка cost-метаданных; это явно записано в комментариях
  модуля и отражено в результате (authorizationBasis). Платный маршрут не
  добавлялся.

### Регрессионные тесты (RED → GREEN)

- RED до фикса: новый тест «non-cancellable stream stops the run» зависал
  (test timed out), «overlong reply closes its iterator» падал на
  returnCalls.length, «trusted-caller» падал на authorizationBasis.
- GREEN: node --test test/note-voice-eval.test.js → 18/18; stubborn-поток
  останавливает run примерно за 64 ms (limits callTimeoutMs=20,
  closeGraceMs=20), вызовов stream ровно 1.

### Верификация (raw, rev2)

    npm run check -> EXIT=0 (evidence/check.txt)
    npm test -> tests 514 / pass 514 / fail 0 (evidence/test-run-final.txt)
    targeted -> 37/37 (evidence/test-run-targeted.txt)
    default evaluator -> live:false, notRun 4/4, stopped:false,
      authorizationBasis none (evidence/note-voice-eval-not-run.json)

lib/** не тронут; ledger U-2.1.288-note-voice остаётся adapted / not-run.

### Handoff rev2

- Тот же PR #13, та же ветка test/ysk-note-voice-eval-20261014, тот же
  worktree; новый PR не создавался, merge/release не выполнялись.
- Первый родительский коммит reviewed head — 7f365d8; corrective commit и
  итоговый head фиксируются в заголовке PR после push.
- **Статус:** READY_FOR_CHATGPT_REVIEW.

### Handoff rev2 (точные SHA) — 2026-10-14T11:25:56Z

- Corrective commit: 861e4a7462cdf4dc9c55db50516c8b2e4b79643a
  (fix: закрывать iterator и останавливать оценку при неясной отмене),
  запушен в origin/test/ysk-note-voice-eval-20261014.
- Верификация на 861e4a7: npm run check EXIT=0; npm test — tests 514 /
  pass 514 / fail 0; targeted 37/37; evaluator test 18/18; RED rev2
  (evidence/test-run-red-rev2.txt) — 3 fail до фикса; default evaluator —
  live:false, notRun 4/4.
- Тот же PR #13; merge/release не выполнялись.
- **Статус:** READY_FOR_CHATGPT_REVIEW.
