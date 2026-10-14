# Final report — ysk-note-voice-live-20261014

**Статус:** READY_FOR_CHATGPT_REVIEW · DSH не мержит, не релизит и не ставит теги.
**База:** origin/main 746d1caa2101b96c97f85b0a0e387b57e77fc436 (PR #13 merged;
POST_MERGE PASS: tests 520/520).
**Ветка:** test/ysk-note-voice-live-20261014 (создана от 746d1caa в отдельном worktree).
**TASK_ID:** ysk-note-voice-live-20261014 (новый; не переиспользует закрытые
ysk-note-voice-eval-20261014 и ysk-note-voice-attribution-20261014).
**PR:** один, из этой ветки в main; точный PR head фиксируется в описании PR.
**Инструмент:** DeepSeek Harness, supervised goal
goal-session-3104c0d3-0343-4d2d-abeb-20de0acc5a4d, revision 1, mode strict.

---

## 1. Что просили и что уточнено

Провести ограниченную живую оценку voice-правила Claude Code 2.1.288, уже
смерженного в PR #12 и покрытого fail-closed evaluator'ом из PR #13. Владелец
**явно разрешил расход** с уже пополненного официального баланса DeepSeek:
не более четырёх тестовых inference-вызовов, без скрытых retry. Поэтому прежний
narrative исправлен: **отсутствие доказательства нулевого инкрементального
расхода больше не блокер** после явной авторизации; доказательство баланса
(§5) показывает, что маршрут оплачен и доступен.

Ограничения задачи, соблюдённые буквально:

- не более **4** inference-вызовов, concurrency 1, без retry, bounded timeouts;
- только официальный уже настроенный маршрут deepseek-official/deepseek-flash;
- read-only вызовы баланса до/после — можно; другие provider-вызовы — нельзя;
- никаких новых сервисов, зависимостей, провайдеров и изменения user automation;
- никаких release/tag/install-задач; один PR в main, дальше — ChatGPT review;
- никакой фабрикации PASS: реальные ответы модели логируются как есть.

## 2. Аудит базы, маршрута и API (без раскрытия секретов)

| Факт | Значение |
| --- | --- |
| Репозиторий | PipaGs/dsh-you-should-know |
| origin/main | 746d1caa2101b96c97f85b0a0e387b57e77fc436 |
| PR #13 POST_MERGE | tests 520/520 (проверено заново на базе: 520/520) |
| Изолированный worktree | .worktrees/ysk-note-voice-live (HEAD 746d1caa) |
| Node | v26.9.0 |
| Провайдер маршрута | deepseek-official (DSH plugin llm-deepseek-api-key) |
| Модель маршрута | deepseek-flash (DeepSeek-V41-Flash), context по умолчанию |
| Протокол | Anthropic-compatible Messages API |
| Endpoint | https://api.deepseek.com/anthropic/v1/messages |
| Auth | заголовок x-api-key; значение не читалось и не логировалось |
| anthropic-version | 2023-06-01 |
| Reviewer reasoning | runtime резолвит reasoningEffort off (efforts содержат off), поэтому serialize шлёт thinking disabled |
| Credential ref | DEEPSEEK_API_KEY в ~/.dsh/.credentials.yaml (refs); значение не выводилось и не коммитилось |
| defaults | ~/.dsh/settings.yaml.imported: agent-default-model provider=deepseek-official, model=deepseek-flash, reasoningEffort=high |

Как установлено: извлечён и прочитан **исходник DSH-провайдера**
@deepseek-ai/dsh-llm-deepseek (из app.asar), в частности `serialize`,
`messagesApiRoot`, обработчик auth плагина llm-deepseek-api-key и
`modelInfo` (список efforts содержит off). Адаптер построен по этому
контракту, а не по догадке: тот же URL (+/v1), те же заголовки, та же форма
тела (model, stream, messages, max_tokens, thinking.disabled, system,
temperature).

WRITE SET (disjoint): scripts/note-voice-eval-deepseek.mjs,
scripts/note-voice-eval-live.mjs, test/note-voice-eval-live.test.js,
package.json (только scripts), docs/upstream/ledger.json, docs/upstream/README.md,
docs/harness-reports/ysk-note-voice-live-20261014/**. `lib/**` не тронут.
Другие ветки и worktrees не изменялись; release/tag/install не выполнялись.

## 3. Что реализовано

### scripts/note-voice-eval-deepseek.mjs

Минимальный адаптер официального DeepSeek Messages API, отдающий ровно тот
stream-контракт, который ждёт `runEvaluation`:

- возвращает `streamFn(options)` -> async iterable с `{type:'text-delta', text}`;
- **ровно один HTTP-запрос** на один вызов, без retry;
- `options.signal` прокидывается в fetch; `iterator.return()` отменяет
  запрос, вызывает `reader.cancel()` и подтверждает закрытие `{done:true}`
  (контракт, на который опирается `closeWithin` в evaluator'е);
- ошибки классифицируются в коды AUTH / QUOTA / RATE_LIMIT / INVALID_REQUEST /
  SERVER / HTTP_<status> / TRANSPORT / ABORTED / MALFORMED_RESPONSE;
- usage читается из message_start (input_tokens, output_tokens) и message_delta
  (output_tokens) и отдаётся один раз через onUsage;
- apiKey берётся только из памяти вызывающего, никогда не логируется и не
  попадает в ошибки.

### scripts/note-voice-eval-live.mjs

Ручной opt-in trusted runner, который инжектит этот stream в **тот же**
`runEvaluation` из PR #13 (4 кейса, 1 попытка на кейс, concurrency 1, без
retry). Двойной gate: нужен и `--live`, и `--confirm-spend`, и наличие
credential в окружении процесса; иначе `live:false`, 4 NOT_RUN, ноль сетевых
обращений. Один запуск этого runner'а — один ограниченный прогон.
Runner также умеет собирать opt-in сырые ответы модели в bounded
synthetic-only поле (`syntheticOnly: true`, cap `DEEPSEEK_RAW_REPLY_MAX_CHARS =
4096`); это добавлено review-fix'ом offline-only и в живом прогоне rev1 не
участвовало.

Bounded overrides для живого сетевого round-trip: callTimeoutMs 60000,
closeGraceMs 2000, totalDeadlineMs 300000. Это **не** ослабляет счётчики:
maxCases 4, maxAttemptsPerCase 1, concurrency 1 и maxReplyChars 4000 остаются
жёсткими из EVAL_LIMITS. Если закрытие stream не подтверждено, evaluator
останавливает прогон до следующего вызова.

### test/note-voice-eval-live.test.js

14 offline contract-тестов без сети (fetch инжектится): форма запроса и
заголовки, отсутствие retry на 5xx, классификация AUTH, пересборка SSE по
однобайтовым границам, usage один раз, подтверждение return(), внешний abort,
fail-closed CLI-гейт, четыре последовательных bounded запроса, отсутствие
утечки секрета, совпадение promptVersion с merged REVIEW_INSTRUCTIONS.

## 4. TDD и cost budget

- **RED:** до появления модулей `node --test test/note-voice-eval-live.test.js`
  -> `ERR_MODULE_NOT_FOUND .../scripts/note-voice-eval-deepseek.mjs`, fail 1
  (evidence/test-run-red.txt).
- **GREEN targeted:** `node --test test/note-voice-eval-live.test.js` -> tests
  14 / pass 14 / fail 0.
- **Полный suite (rev1):** `npm test` -> tests 534 / pass 534 / fail 0
  (evidence/test-run-final.txt). База 520 + 14 новых; финальные прогоны —
  §13 (review-update rev2/rev3).
- `npm run check` -> EXIT=0 (evidence/check.txt).

Cost budget (до запуска, оценка, не гарантия биллинга): 4 вызова x max_tokens
768; системный промпт ~1k токенов, excerpt ~100. Суммарно ожидалось < ~2k
input и < ~1k output токенов; по прайсу flash это доли цента, с большим запасом
ниже разрешённого лимита. Фактически (§5) израсходовано меньше оценки.

## 5. Живой прогон: ровно один, четыре вызова

Один запуск:

    DEEPSEEK_API_KEY=<из credential store, не выводился> \
      node scripts/note-voice-eval-live.mjs --live --confirm-spend \
      --out docs/harness-reports/ysk-note-voice-live-20261014/evidence/note-voice-eval-live-run.json

- startedAt 2026-10-14T13:13:06.791Z, finishedAt 2026-10-14T13:13:11.996Z,
  exitStatus 0, signal null (evidence/note-voice-eval-live-run.stdout.txt).
- attempted 4 / limit 4, retries 0, closedConfirmed 4, stopped false.
- request 1..4: model deepseek-flash, max_tokens 768, stream true,
  thinking disabled, temperature 0.
- promptVersion 5c1fae1bef435a32416e5e85f7b3c58b2fbc3ee3138020ca3a029f3e781feac3
  совпадает с sha256(REVIEW_INSTRUCTIONS) merged main.

Проверки баланса (read-only, отдельно от usage):

- before и after — официальный read-only GET /user/balance, HTTP 200,
  is_available true (evidence/balance-before.json, evidence/balance-after.json).
- Числовые суммы кошелька **сознательно не коммитятся**: репозиторий публичный,
  а владелец разрешил только расход на тесты. Точные наблюдаемые значения
  остаются в локальном transient private evidence и не входят в публичное
  дерево/PR. Точная billed-сумма не заявляется; токенные метрики ниже —
  отдельная величина провайдера.

Наблюдаемая usage (то, что вернул провайдер; без cache-полей):

| # | case | input tokens | output tokens |
| --- | --- | --- | --- |
| 1 | agent-owned | 904 | 82 |
| 2 | human-owned | 250 | 50 |
| 3 | joint | 244 | 10 |
| 4 | unclear | 254 | 10 |
| | **итого** | **1652** | **152** |

Первый вызов заметно больше по input (904): похоже на prompt-cache
эффект (адаптер читает только input_tokens/output_tokens и не записывает
cache_read/cache_creation поля); это наблюдение, не вывод.

## 6. Результаты по кейсам (сырые ответы как есть)

Провалидировано детерминированным `adjudicateCase`: 0 PASS, 2 FAIL, 2 SILENT,
0 INVALID, 0 DROPPED, 0 TIMEOUT, 0 NOT_RUN.

**agent-owned** — FAIL «attribution mismatch: expected agent but also found human».
Сырой note модели: «The main agent lowered the default request timeout from 30s
to 5s, which directly contradicts your instruction to keep the current default
timeout. This changes behavior for all callers, not just the cache path.»
Сырой action: «Revert the default request timeout back to 30s and scope any
fail-fast behavior to the cache lookup only.»
Вердикт: note называет и «the main agent» (действие), и «your instruction»
(требование человека). Лексический маркер human срабатывает на «your
instruction», поэтому адъюдикатор видит смешанную атрибуцию.

**human-owned** — FAIL «attribution missing: expected human, found agent».
Сырой note: «The agent claims the change is done but the excerpt shows no actual
code edit, file path, or verification — you should confirm the staging client's
TLS verification was really disabled before relying on it today.»
Вердикт: note говорит про «the agent» и не использует ownership-форму «you
chose/disabled...»; маркер human не срабатывает.

**joint** — SILENT. Сырой note: null (тишина). Модель не сочла cap три retry
достаточно важной находкой.

**unclear** — SILENT. Сырой note: null (тишина). Модель не сочла упавший
export job заслуживающим note.

Разделение note/action сохраняется: action присутствовал только в кейсе 1;
в остальных note без action. Ни один ответ не steering'ит агента.

### Как это читать (важно, без переписывания в PASS)

- Это **не** PASS и **не** доказательство upstream-паритета.
- Это и **не** чистый вердикт о модели: `adjudicateCase` — грубый лексический
  proxy (сам evaluator это документирует), и в agent-owned FAIL вызван фразой
  «your instruction», которая легитимна как обращение к человеку, а не как
  присвоение решения; в human-owned модель честно указала на agent-действие в
  другом аспекте, но не повторила ownership-форму сценария.
- joint/unclear SILENT показывают вторую границу harness: сценарии
  сконструированы как «важная находка», а модель промолчала (в joint это
  семантически защитимо, в unclear — спорно). SILENT не засчитывается как pass.
- Итог для ledger: статус остаётся **adapted**, не equivalent; живой сэмпл
  получен, но он не подтверждает поведение.

### Ограничения этого прогона (честно)

- Адъюдикатор сохраняет разобранный note/action, но **не полный сырой reply**:
  для FAIL-кейсов это фактический текст note/action модели; для SILENT
  `parseVerdict` вернул ровно объект тишины (две ключевые пары), но допускает
  лишние ключи, поэтому побайтовый raw для SILENT не доказан. Полная
  raw-запись reply в этом прогоне не велась; перезапуск ради неё запрещён
  лимитом четырёх вызовов.
- 4 кейса — smoke, а не статистика; nondeterminism модели не оценивался.
- usage не содержит cache-полей; числовые балансы не коммитятся (см. §5).

## 7. AC matrix

| AC | Требование | Статус | Доказательство |
| --- | --- | --- | --- |
| AC1 | Аудит правил/DSH API/main/маршрута/cancellation/credential без раскрытия секретов | PASS | §2; исходник llm-deepseek прочитан; значения секретов не выводились |
| AC2 | Свежий TASK_ID, изолированный worktree/ветка/write set, без коллизии с release | PASS | §2; worktree .worktrees/ysk-note-voice-live, ветка от 746d1caa |
| AC3 | Minimal manual opt-in host runner: без auto-network в check/test, без новых deps/провайдеров | PASS | scripts/note-voice-eval-live.mjs; package.json только scripts; npm test offline зелёный (финальный прогон 543/543, §13) |
| AC4 | AbortSignal + iterator.return подтверждение; stop при unconfirmed closure | PASS | тесты return()/abort; closeWithin-контракт; stopped=false, closed 4/4 |
| AC5 | Ровно ≤4 запроса, concurrency 1, no retry, maxTokens 768, без fallback-провайдеров | PASS | один запуск, 4 запроса, retries 0; body max_tokens 768; evidence run JSON |
| AC6 | promptVersion == merged REVIEW_INSTRUCTIONS | PASS | 5c1fae1b...; отдельная проверка sha256 и тест |
| AC7 | Offline TDD с fake streams ДО live; npm check/test/invariants зелёные | PASS | RED->GREEN 14/14 (rev1) → 18/18 (rev2) → 23/23 (rev3); npm test 543/543 (§13); test/invariant.test.js 11/11 внутри suite |
| AC8 | Один контролируемый live-прогон 4 сценариев; raw replies/usage/route/model; без fake PASS | PARTIAL | §5-§6; run JSON; 0 PASS — не переписано. Выполнен один контролируемый живой прогон, sanitized note/action для FAIL сохранены, usage/route/model записаны. Побайтовый raw replies этого прогона НЕ сохранён (для SILENT raw bytes недоступны, восстановление невозможно, повтор запрещён); raw-capture реализован offline-only для будущих прогонов |
| AC9 | Выводы по ответственности и разделение note(human)/action(agent) | PASS | §6; actionOwners адъюдицируются отдельно |
| AC10 | Ledger остаётся adapted; liveVerification отражает фактический результат | PASS | §8; ledger.json обновлён, equivalent не заявлен |
| AC11 | Один PR, без merge/release/tag/install | PASS | см. описание PR; DSH не мержит |

AC denominator: 11 AC, attempted 11: **PASS 10, PARTIAL 1 (AC8), FAIL 0,
NOT_RUN 0**. Живые PASS модели: 0 из 4 — не фабрикуются.

## 8. Обновление ledger и README

- `docs/upstream/ledger.json`: `taskId`/generatedAt текущего цикла, local.head
  746d1caa; у U-2.1.288-note-voice обновлены localEvidence, parityNotes и
  `liveVerification` (status run-no-pass: calls 4/4, retries 0, closed 4,
  results 0/2/2, observedUsage 1652/152; числовые балансы не в публичном дереве).
- `localStatus` остаётся **adapted**; equivalence не заявлена; acceptance
  (prompt-composition) не менялся.
- `docs/upstream/README.md`: строка 2.1.288 и пояснение переписаны на факт
  живого прогона без заявки на parity.

## 9. Верификация (raw)

Дерево rev1, залогировано в docs/harness-reports/ysk-note-voice-live-20261014/evidence/:

    npm run check (rev1) -> EXIT=0 (check.txt)
    npm test (rev1) -> tests 534 / pass 534 / fail 0 (test-run-final.txt)
    node --test test/note-voice-eval-live.test.js (rev1) -> 14/14
    node scripts/note-voice-eval.mjs -> live:false, notRun:4 (без сети)
    node scripts/note-voice-eval-live.mjs (без флагов) -> live:false, notRun:4
    RED -> ERR_MODULE_NOT_FOUND (test-run-red.txt)
    live -> 4/4 closed, stop false, 0 PASS (note-voice-eval-live-run.json)

## 10. DIFF_SANITY и SECURITY_SANITY

- `lib/**` — 0 изменений; human-only инвариант не затронут.
- Новые файлы — только evaluator-runner слой и его тесты; package.json правит
  лишь scripts. См. evidence/diff-summary.txt.
- Runner без флагов не делает сетевых обращений (тест + ручная проверка).
- Секрет берётся только из окружения процесса; не попадает в argv, stdout,
  ошибки, JSON-отчёт или git. Секретного содержимого в diff нет
  (evidence/security-diff-sanity.txt).
- Внешний текст — синтетические excerpt'ы; ничего приватного в evidence.

## 11. Что НЕ доказано

- Поведенческая эквивалентность upstream: не заявлена и не доказана.
- Семантическая корректность voice-правила: 4-кейсовый smoke + лексический
  proxy не дают семантического доказательства.
- Полный сырой reply SILENT-кейсов (см. ограничения §6).
- Точная billed-сумма: не заявляется; числовые балансы не в публичном дереве, usage — метрика провайдера.

## 12. Фокус для ChatGPT review

1. Достаточна ли двойная защита runner'а (`--live` + `--confirm-spend` +
   env) и корректно ли bounded overrides не меняют счётчики 4 x 1.
2. Согласны ли вы с выводом 0 PASS как честного результата и с трактовкой
   FAIL/SILENT как ограничения proxy, а не как вердикта о модели.
3. Корректен ли endpoint/форма запроса относительно DSH llm-deepseek.
4. Достаточно ли обновления ledger/README и сохранения статуса adapted.

---

## 13. Review update — 2026-10-14 (rev 2, CHANGES_REQUIRED на head b7e5859)

Независимый review PR #14 вернул три блокера. Все три обработаны в этом же
PR/ветке; **новых provider-вызовов и нового live-прогона не было** (бюджет
исчерпан, 0 дополнительных paid calls).

### B1 (PRIVACY) — устранено, с честным ограничением

- Из публичного дерева удалены числовые суммы кошелька и сырые ответы balance
  API. `evidence/balance-before.json` и `balance-after.json` заменены на
  нечувствительную аттестацию: наблюдаемое время, метод, HTTP 200,
  `available: true`, без `balance_infos`/сумм.
- В `final-report.md` таблица с суммами заменена на «balance confirmed
  available»; в `ledger.json` удалён `observedBalanceUsd` и добавлен
  `balanceCheck` без чисел.
- Точные наблюдаемые значения сохранены только в локальном transient private
  evidence вне репозитория и в коммит не входят.
- Ограничение: уже запушенный публичный git-объект b7e5859 мог сохраниться в
  кэше/форках GitHub. Гарантировать его удаление нельзя, и оно не обещается;
  перезаписан только head этой PR-ветки (force-with-lease), чтобы новый head не
  содержал сумм. Credentials и полные финансовые реквизиты не коммитились.

### B2 (EVIDENCE ACCURACY) — AC8 исправлен на PARTIAL

- Прежний AC8 = PASS **неверен**: он утверждал полный raw capture, которого не
  было. Реально для FAIL сохранён фактический текст note/action, для SILENT
  полные raw bytes не сохранены; восстановление невозможно, повтор live
  запрещён. AC8 теперь PARTIAL с этими ограничениями.
- Живые результаты не менялись и не переписывались: 0 PASS / 2 FAIL / 2 SILENT,
  usage 1652/152.
- Offline-only raw-capture добавлен в opt-in adapter/runner: поля
  `syntheticOnly: true`, `complete`, `truncated`, `chars`, `text`;
  жёсткий cap `DEEPSEEK_RAW_REPLY_MAX_CHARS = 4096`; никаких заголовков,
  секретов или provider auth data. Покрыт fake-stream тестами, без inference.
- agent-owned FAIL явно трактуется как ограничение лексического proxy:
  «your instruction» — легитимное обращение к человеку/источник требования, а
  не присвоение решения; 0 PASS — это статус лексического адъюдикатора, а не
  доказанный семантический провал модели.

### B3 (STREAM CLOSURE) — устранено RED -> GREEN

- Дефект: `iterator.return()` всегда возвращал `{done:true}`, даже если
  `reader.cancel()` бросал исключение или reader ещё не был получен; это
  обходило safety-правило evaluator'а «stop on unconfirmed close» и могло
  разрешить следующий платный вызов.
- RED-тесты (fake streams, без сети): (1) cancel reject -> `done:false`;
  (2) pending fetch без reader -> `done:false`; (3) end-to-end: первый вызов
  с неотменяемым body останавливает прогон, второй HTTP-запрос не стартует
  (`calls === 1`, остальные кейсы NOT_RUN).
- Фикс: `return()` подтверждает `done:true` только при естественном
  завершении stream, полностью прочитанном body или успешном
  `reader.cancel()`; иначе `done:false`. AbortSignal и bounded closeGrace
  сохранены; adapter не утверждает, что удалённая сторона остановлена.

### Verification после review-fix (без новых live-вызовов)

    npm run check -> EXIT=0                          (evidence/check-rev2.txt)
    npm test -> tests 538 / pass 538 / fail 0        (evidence/test-run-final-rev2.txt)
    node --test test/note-voice-eval-live.test.js -> 18/18
    node --test test/invariant.test.js -> 11/11
    node --test test/upstream-ledger.test.js -> 8/8
    RED против rev1-адаптера -> tests 3 / fail 3     (evidence/test-run-red-rev2.txt)

Адъюдикация/chronology rev1 (0 PASS / 2 FAIL / 2 SILENT, usage 1652/152)
сохранены без изменений; изменены только: fail-closed поведение `return()`,
offline raw-capture, санитизация публичных артефактов и AC8.

---

## 14. Review update — 2026-10-14 (rev 3, CHANGES_REQUIRED на head 60bbb63)

Независимый rereview PR #14 вернул два блокера. Оба закрыты в этом же
PR/ветке; **новых DeepSeek inference/provider-вызовов не было** (0 paid calls).

### Blocker A — согласованность отчёта

- Aggregate-строка в §7 исправлена с ошибочного «pass 11» на фактическое
  **PASS 10, PARTIAL 1 (AC8), FAIL 0, NOT_RUN 0**.
- Приведены в соответствие summary-ссылки: §4/§9 помечены как записи rev1,
  AC3/AC7 указывают на финальный прогон 543/543 (§13-§14).
- `evidence/balance-after.json`: note исправлен с «performed **before** the live
  run» на «performed **after** the live run»; `balance-before.json` остаётся
  «before». Исторические наблюдения (0 PASS / 2 FAIL / 2 SILENT, usage 1652/152,
  времена) не переписывались, raw replies не изобретались.
- Публичная privacy-санитизация сохранена: в `balance-*.json`/report/ledger нет
  числовых сумм и сырых wallet-полей.

### Blocker B — небезопасный путь подтверждения закрытия

Дефект: `safeText(response)` глушил исключение `response.text()` и возвращал
пустую строку, но `start()` всё равно ставил `bodyConsumed = true` для HTTP
non-OK и для fallback без reader. Тогда `return()` подтверждал `done:true`
несмотря на то, что тело ответа не было ни прочитано, ни отменено, и evaluator
мог разрешить следующий платный вызов.

RED (offline fake Responses, без сети; evidence/test-run-red-rev3.txt):
- HTTP 500, `text()` бросает -> прогон продолжается и делает лишние запросы
  вместо остановки;
- HTTP 200 без reader и с бросающим `text()` -> пустой reply, `closed:true`.
Против адаптера rev2: tests 23 / fail 2.

Минимальный консервативный фикс:
- `readBodyText()` возвращает `{ ok: true, text }` только при успешном
  завершении `text()`; при исключении — `{ ok: false }`;
- `bodyConsumed = true` ставится **только** при `ok === true`;
- non-OK с неуспешным чтением тела даёт `httpError` и оставляет closure
  неподтверждённым (`done:false`), а не догадку;
- success без reader и с неуспешным чтением даёт `TRANSPORT` и
  `done:false`; сообщения санитизированы, исходные ошибки не подменяются;
- успешное полное чтение тела non-OK по-прежнему подтверждает закрытие.

Регрессионные тесты (23/23): normal 500 с полностью прочитанным body
подтверждает закрытие и прогон продолжается; failed body read не подтверждает
и останавливает прогон; read-failure + успешный `cancel()` подтверждает
закрытие; read-failure + падающий `cancel()` остаётся неподтверждённым.

### Verification rev3 (0 paid calls)

    npm run check -> EXIT=0                              (evidence/check-rev3.txt)
    npm test -> tests 543 / pass 543 / fail 0            (evidence/test-run-final-rev3.txt)
    node --test test/note-voice-eval-live.test.js -> 23/23
    node --test test/invariant.test.js -> 11/11
    node --test test/upstream-ledger.test.js -> 8/8
    RED против rev2-адаптера -> tests 23 / fail 2        (evidence/test-run-red-rev3.txt)

`lib/**` не менялся; ledger остаётся adapted / run-no-pass / 0-2-2; merge,
release и tag не выполнялись.
