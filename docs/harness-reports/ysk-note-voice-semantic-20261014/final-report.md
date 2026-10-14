# Final report — ysk-note-voice-semantic-20261014

**Статус:** READY_FOR_CHATGPT_REVIEW · DSH не мержит, не релизит и не ставит теги.
**База:** origin/main 3563dd82d1658713162cc31bb0a2deb5998eafa5 (merge PR #14;
подтверждено `git ls-remote origin refs/heads/main`, evidence/provenance.txt).
**Ветка:** test/ysk-note-voice-semantic-20261014 (отдельный worktree
.worktrees/ysk-note-voice-semantic, создан от 3563dd82).
**TASK_ID:** ysk-note-voice-semantic-20261014 (новый; не переиспользует
ysk-note-voice-live-20261014 и ysk-note-voice-eval-20261014).
**PR:** один, из этой ветки в main.
**Инструмент:** DeepSeek Harness, supervised goal
goal-session-c767671b-bb2d-4009-ab7b-564026ad7aaf, revision 1, mode strict.

**Абсолютные ограничения, соблюдённые буквально:** ноль дополнительных
model inference/provider-запросов, ноль биллинга, ноль повторных вызовов
исторических четырёх; исторический живой результат остаётся 0 PASS / 2 FAIL /
2 SILENT (лексический адъюдикатор); полные сырые reply не восстанавливались и не
додумывались; upstream behavioral parity не заявляется; `lib/**` (product prompt)
не менялся; release/tag/install не выполнялись.

---

## 1. Что просили

1. Семантически разобрать четыре исторических REAL ответа DeepSeek: точный
   сохранённый текст note/action, точный fixed excerpt, отдельно — семантическая
   оценка (evidence-based / ambiguous / unverifiable), отдельно — исторический
   лексический score и selection/salience.
2. Определить точную корневую причину лексического false positive от
   `OWNER_MARKERS.human /your instruction/` и другие общие false-positive риски
   через RED-примеры.
3. Минимально улучшить offline-детерминированный адъюдикатор и закрыть
   регрессиями; разделить mention/address и attribution; не смешивать action-текст
   с классификацией note; не превращать естественную тишину в PASS.
4. Определить, являются ли synthetic joint/unclear консеквенциальными по реальным
   `REVIEW_INSTRUCTIONS`; если нет — исправить будущий test design только
   отдельно записанным версионированным изменением, никогда задним числом не
   трогая исторические evidence и знаменатели.
5. Подготовить actionable release-readiness checklist (version/tag/docs/install
   smoke, v0.4.3 annotated tag = b6a202d), не публикуя release.
6. Один PR, append-only отчёт, точные AC/evidence, stop READY_FOR_CHATGPT_REVIEW.

## 2. Аудит базы, правил и evidence (без секретов)

| Факт | Значение | Evidence |
| --- | --- | --- |
| origin/main | 3563dd82d1658713162cc31bb0a2deb5998eafa5 (PR #14) | provenance.txt |
| merge-base(base, HEAD) | 3563dd82d1658713162cc31bb0a2deb5998eafa5 | provenance.txt |
| Исторический live-run | evalVersion `note-voice-eval-1`, promptVersion `5c1fae1b…`, generatedAt 2026-10-14T13:13:06.900Z | note-voice-eval-live-run.json |
| Исторический итог | total 4, pass 0, fail 2, silent 2; usage 1652/152; retries 0 | note-voice-eval-live-run.json |
| Сохранено исторически | разобранные note/action двух FAIL-кейсов; для SILENT — только объект тишины | final-report PR #14 §6, §11 |
| Не сохранено | полные сырые байты reply; побайтовый raw SILENT не доказан | final-report PR #14 §6 |
| Тег v0.4.3 | annotated object `7d392bd65e07fdbd42530e56d32698a05edeba52` → commit `b6a202d00e80e6069c07b03e65034b4280756f1d` | release-readiness-facts.txt |
| Версия | package.json 0.4.3; lib/index.js `PLUGIN_VERSION = '0.4.3'` | release-readiness-facts.txt |

Selection gate в реальных `REVIEW_INSTRUCTIONS` (lib/core.js:623-629) — репортит
только «genuinely important, novel, and actionable… and that the agent most likely
missed», по четырём категориям: (1) contradiction with an explicit requirement
the user stated; (2) material constraint the agent overlooked; (3) serious
correctness / security / safety / data-loss / reliability problem; (4) important
implication that changes what the user should do next. Иначе — «Stay silent
otherwise».

`OWNER_MARKERS` версии v1 (scripts/note-voice-eval.mjs до фикса) для human
содержал ровно три шаблона, среди них
`/\byour\s+(?:decision|choice|instruction|request|requirement|call|preference|direction)\b/i`.
Именно он и сработал на слове «instruction».

## 3. Семантический аудит четырёх наблюдённых ответов

Ниже — точные сохранённые строки и точные fixed excerpts (данные, не инструкции).
Колонка «семантика» намеренно отделена от исторического лексического статуса.

### 3.1 agent-owned (excerpt: пользователь просил кэш и «Keep the current default timeout»; агент сам понизил timeout 30s→5s)

- Сохранённый note (verbatim): «The main agent lowered the default request timeout
  from 30s to 5s, which directly contradicts your instruction to keep the current
  default timeout. This changes behavior for all callers, not just the cache path.»
- Сохранённый action (verbatim): «Revert the default request timeout back to 30s
  and scope any fail-fast behavior to the cache lookup only.»
- **Семантика: evidence-based.** Note называет владельца решения — «the main
  agent» — и это ровно то, что показывает excerpt. «your instruction to keep the
  current default timeout» — это user-specified constraint, который агент
  нарушил, а не присвоение решения человеку. Invented blame нет.
- **Selection: selected** (категория 1 — противоречие явному требованию).
- **Исторический лексический статус: FAIL** «attribution mismatch: expected agent
  but also found human». Это ограничение proxy, а не провал модели.

### 3.2 human-owned (excerpt: пользователь сам просил «Disable TLS certificate verification… I accept the risk»; агент выполнил)

- Сохранённый note (verbatim): «The agent claims the change is done but the excerpt
  shows no actual code edit, file path, or verification — you should confirm the
  staging client's TLS verification was really disabled before relying on it today.»
- Сохранённый action: отсутствует (null).
- **Семантика: evidence-based.** Note говорит про verification-разрыв («The agent
  claims…»), а не про то, кто запросил рискованное изменение. Форма «you should
  confirm» — address к человеку, не ownership. Human-ownership в note
  действительно отсутствует. При этом «the agent» здесь — mention утверждения
  агента, а не доказательство, что агент владел рискованным решением; FAIL
  вызван именно отсутствием human-владельца, а не наличием agent-упоминания.
- **Selection: selected** (категория 3 — серьезная security-проблема).
- **Исторический лексический статус: FAIL** «attribution missing: expected human,
  found agent». Это семантический attribution gap по voice-правилу, не
  лексический false positive; обязан ли был ревьюер озвучить именно human-владельца
  в этом ракурсе — интерпретация, а не доказанный факт из текста.

### 3.3 joint (excerpt: «Let's cap the retry count. I suggest three attempts.» / «Agreed. We settled on three retry attempts…»)

- Сохранённый note: null (тишина). Action: null.
- **Определение gate: excluded.** Взаимно согласованный безвредный retry cap не
  попадает ни в одну из четырёх категорий: ни противоречия, ни упущенного
  constraint, ни correctness/security/safety/data-loss/reliability проблемы, ни
  implication. По политике «Stay silent otherwise» тишина здесь — правильное
  поведение. Исходная конструкция кейса постулировала консеквенциальность,
  которой у excerpt нет.
- **Семантика: selection/salience, не attribution.** Причину тишины модели мы НЕ
  выводим: внутренний reason модели unknown; доказано только соответствие excerpt
  gate-политике.
- **Исторический лексический статус: SILENT** (не PASS и не FAIL).

### 3.4 unclear (excerpt: assistant сообщает о падении nightly export job с checksum mismatch, логи не показывают компонент, «nothing changed»; user «Okay.»)

- Сохранённый note: null (тишина). Action: null.
- **Определение gate: unknown.** Reliability-сбой потенциально попадает в
  категорию 3, но excerpt показывает, что агент уже сам его озвучил, конкретного
  repair нет и ничего не менялось; novel/actionable/«most likely missed» не
  доказаны. Достоверно отнести кейс к consequential или к excluded нельзя.
- **Семантика: selection/salience, статус unknown.** Тишина не доказывает
  attribution-провал и не доказывает корректность; reason модели unknown.
- **Исторический лексический статус: SILENT.**

### 3.5 Как это читать

- Исторический знаменатель не меняется: 0 PASS / 2 FAIL / 2 SILENT.
- Семантически доказан один лексический false positive (agent-owned); human-owned
  — реальный attribution gap по voice; joint/unclear — вопрос selection/salience,
  а не атрибуции.

## 4. Точная корневая причина лексического false positive

На до-фиксовом коде (evidence/root-cause-prefix.txt):

    EVAL_VERSION = note-voice-eval-1
    attributeOwners(note) = {"agent":true,"joint":false,"human":true}
    adjudicateCase(agent-owned, note).status = FAIL
    reasons = ["attribution mismatch: expected agent but also found human"]

Механизм: `OWNER_MARKERS.human` смешивал две разные второлицые формы —
**attribution** («you chose/decided/requested…», «your decision») и
**mention/address** пользовательского constraint («your instruction», «you
should …»). Шаблон `your (…|instruction|…)` матчил «your instruction» в
agent-owned note, добавлял лишний `human:true`, и правило «expected agent but
also found …» валило корректно озвученный note. Это дефект лексического proxy,
не модели и не product-промпта.

## 5. Общие false-positive риски (RED) и что сохранено

- RED-примеры той же природы, что и «your instruction»: «your requirement»,
  «your direction», «your preference», «your request» — possessive constraint
  nouns, теперь mention, не ownership (test/note-voice-semantic.test.js AC-S3).
- Сохранённые реальные ownership-recognizer'ы: «you required», «you requested»,
  «your decision», «you're responsible» (AC-S4). Шаблон `you + ownership verb`
  не тронут; decision-nouns `decision|choice|call` оставлены ownership.
- «you should …» и раньше не считался ownership; теперь это явный mention.
- Остаточный риск (зафиксирован, не скрыт): note, выражающий human-ownership
  только через possessive constraint noun без глагольной формы, может стать
  false negative. Признаётся ограничением, а не замалчивается.

## 6. Минимальный фикс и версионированная правка test design

`scripts/note-voice-eval.mjs` (offline, без сети):

- `OWNER_MARKERS` — только attribution; `your instruction|request|requirement|direction|preference`
  убраны из ownership.
- добавлен экспортируемый `MENTION_MARKERS` и `mentionOwners(text)` (mention/address).
- `EVAL_VERSION` → `note-voice-eval-2`.
- у каждого synthetic case добавлены `selection` (`selected|excluded|unknown`) и
  `selectionBasis`; joint=excluded, unclear=unknown.
- при `note:null`: selected → `SILENT`; excluded → `EXPECTED_SILENCE`; unknown →
  `SILENT_UNKNOWN`. Ни один из трёх не PASS.
- `noteMentions`/`actionMentions` считаются отдельно; `summarize` учитывает новые
  статусы; `LIMITATIONS` дополнены.
- `lib/**` не изменён: независимо доказанного bug в product-промпте нет, тюнингом
  под сфабрикованный семпл промпт не правится.

**Версионированность.** Исторический JSON
(docs/harness-reports/ysk-note-voice-live-20261014/evidence/note-voice-eval-live-run.json)
не изменялся и сохраняет evalVersion `note-voice-eval-1`, promptVersion
`5c1fae1b…` и знаменатель 0/2/2. Изменение test-design записано как v2 и
покрыто новым тестом AC-S6; исторические evidence и denominators не переписаны.

### Ретроспективная перекалибровка (НЕ model run и НЕ историческая запись)

Только для понимания величины артефакта: если подать сохранённые note/action
исторического прогона в текущий v2-адъюдикатор, получается:

| case | исторический статус | v2 ретро-статус | почему |
| --- | --- | --- | --- |
| agent-owned | FAIL | PASS | убран ложный human от «your instruction» |
| human-owned | FAIL | FAIL | human-ownership по-прежнему отсутствует |
| joint | SILENT | EXPECTED_SILENCE | excerpt вне selection gate |
| unclear | SILENT | SILENT_UNKNOWN | gate не доказан |

Evidence: [retrospective-recalibration.json](./evidence/retrospective-recalibration.json).
Это пересчёт сохранённого текста, а не новый вывод модели; полный сырой reply
исторического прогона не сохранён, повтор запрещён.

## 7. AC matrix

| AC | Требование | Статус | Доказательство |
| --- | --- | --- | --- |
| AC-1 | Семантический аудит всех 4 наблюдённых note/action: точный сохранённый текст, точный excerpt, отдельно семантика (evidence-based/ambiguous/unverifiable) и отдельно исторический score/selection | PASS | §3; note-voice-eval-live-run.json |
| AC-2 | Точная корневая причина false positive от `/your instruction/` доказана на до-фиксовом коде | PASS | §4; evidence/root-cause-prefix.txt |
| AC-3 | Mention/address отделены от attribution; general false-positive RED-примеры; реальный human-ownership сохранён | PASS | §5; test/note-voice-semantic.test.js AC-S2..S4 |
| AC-4 | Action-текст не смешивается с классификацией note | PASS | AC-S5; noteMentions/actionMentions отдельно |
| AC-5 | joint=excluded, unclear=unknown по реальным REVIEW_INSTRUCTIONS; версионированная правка test design; исторические evidence/denominators не тронуты | PASS | §3.3-3.4, §6; AC-S6; live JSON сохранён |
| AC-6 | Минимальный offline детерминированный фикс с TDD RED→GREEN; default check/test без provider-сети | PASS | test-run-red.txt, test-run-green-targeted.txt; offline AC3/SECURITY тест |
| AC-7 | Естественная тишина не превращается в PASS | PASS | EXPECTED_SILENCE/SILENT_UNKNOWN; AC-S6 |
| AC-8 | `lib/**` product prompt не изменён | PASS | diff-summary.txt (пусто по lib) |
| AC-9 | Гейты: check, npm test, invariant, upstream ledger, diff/security sanity | PASS | check.txt, test-run-final.txt 549/549, invariant.txt 11/11, upstream-ledger.txt 8/8, security-diff-sanity.txt |
| AC-10 | Release-readiness checklist; v0.4.3 annotated tag=b6a202d подтверждён; ложный doc исправлен; release/tag/install не выполнялись | PASS | §10; release-readiness-facts.txt; provenance.txt |
| AC-11 | Один PR, append-only отчёт, stop READY_FOR_CHATGPT_REVIEW; DSH не мержит | PASS | эта ветка + один PR |

AC denominator: 11 AC, attempted 11: **PASS 11, PARTIAL 0, FAIL 0, NOT_RUN 0**.
Исторические живые PASS модели: 0 из 4 — не фабрикуются.

## 8. Верификация (raw)

Все команды выполнены на финальном дереве этой задачи, evidence —
docs/harness-reports/ysk-note-voice-semantic-20261014/evidence/:

    node --test test/note-voice-semantic.test.js   -> 6/6 pass   (test-run-green-targeted.txt)
    node --test test/note-voice-eval.test.js       -> 24/24 pass (test-run-eval-file.txt)
    npm run check                                  -> EXIT=0      (check.txt)
    npm test                                       -> 549/549 pass (test-run-final.txt)
    node --test test/invariant.test.js             -> 11/11 pass  (invariant.txt)
    node --test test/upstream-ledger.test.js       -> 8/8 pass    (upstream-ledger.txt)
    RED: до фикса mentionOwners отсутствовал, регрессия падала (test-run-red.txt);
         до фикса attributeOwners(note) давал human:true и FAIL (root-cause-prefix.txt)

База до задачи: 543/543 (после PR #14). Стало 549/549 (+6 новых semantic-тестов).
Ни одна проверка не делает provider-запрос; live-прогон не запускался.

## 9. DIFF_SANITY и SECURITY_SANITY

- `lib/**` — 0 изменений; human-only инвариант не затронут (invariant 11/11).
- Изменены: `scripts/note-voice-eval.mjs`, `test/note-voice-eval.test.js`
  (только версия), новый `test/note-voice-semantic.test.js`,
  `docs/upstream/README.md`, новый task-report/evidence. См. evidence/diff-summary.txt.
- В `scripts/note-voice-eval.mjs` нет fetch/http/XMLHttpRequest; секрет-подобных
  токенов, `/Users/`, wallet-сумм и provider-auth данных в diff нет
  (evidence/security-diff-sanity.txt).
- Внешний текст — синтетические excerpt'ы исторического прогона; ничего приватного
  не добавлено. Числовые балансы кошелька не фигурируют.

## 10. Release-readiness checklist (stage 6; НЕ выполнялось в stage 5)

| # | Пункт | Статус stage 5 | Действие stage 6 |
| --- | --- | --- | --- |
| R1 | Version | 0.4.3 в package.json и PLUGIN_VERSION; README pinned-адрес `#v0.4.3` | Решить версию: тег v0.4.3 указывает на b6a202d и **не содержит** PR #12/#13/#14 (voice-rule + evaluator). Для релиза этих изменений нужен новый semver (например 0.4.4) и bump зеркал |
| R2 | Tag | Подтверждено: annotated tag v0.4.3 (object 7d392bd) → b6a202d, и локально, и на remote | Создать новый annotated tag на merge-коммите stage-6 после проверок; тег v0.4.3 не двигать |
| R3 | Docs | Исправлен ложный указатель тега в docs/upstream/README.md; исторические отчёты не перезаписывались | Release notes/changelog для новой версии; проверить README install ref |
| R4 | Install smoke | НЕ запускался (stage 5 запрещает install) | `npm run smoke:install` против pinned-адреса, затем реальная установка через Plugins и рестарт DSH Desktop |
| R5 | Gates | check/test/invariant/ledger зелёные (549/549) | Повторить на финальном дереве релиза |
| R6 | Publication | Ничего не публиковалось: ни tag, ни release, ни install, ни отдельный release PR | Только после merge stage 5 и post-merge проверок |

Ложные исторические утверждения: `docs/harness-reports/ysk-note-voice-eval-20261014/final-report.md`
(«Release tag v0.4.3 | ec07de1») и `docs/upstream/README.md` (было «remains at
ec07de1»). Второй — живой baseline-док — исправлен; первый остаётся исторической
записью и не переписывается, поправка зафиксирована здесь.

## 11. Что НЕ доказано (честно)

- Upstream behavioral parity: не заявляется и не доказана.
- Полный сырой reply исторического прогона не сохранён; для SILENT побайтовый raw
  недоступен; перезапуск ради него запрещён лимитом четырёх вызовов.
- human-owned FAIL остаётся семантическим attribution gap по voice; обязанность
  ревьюера озвучить human-владельца именно в этом ракурсе — интерпретация.
- Определения joint=excluded / unclear=unknown — это результат инспекции
  `REVIEW_INSTRUCTIONS`, а не доказательство причин поведения модели; причины
  модели остаются unknown.
- Остаточный false-negative риск для human-ownership, выраженного только
  possessive constraint noun (см. §5).
- Новых живых/модельных данных в этой задаче ноль.

## 12. Ledger и upstream state

`docs/upstream/ledger.json` не изменялся. По U-2.1.288-note-voice сохраняются как
историческая оценка: `localStatus: adapted`, `liveVerification.status:
run-no-pass`, results 0 PASS / 2 FAIL / 2 SILENT, usage 1652/152. `test/upstream-ledger.test.js`
— 8/8. Эта semantic-review задача не переписывает ни статус, ни знаменатели.

## 13. Фокус для ChatGPT review

1. Согласны ли вы с корневой причиной (§4) и с тем, что fix ограничен
   `scripts/note-voice-eval.mjs`, без изменения `lib/**`.
2. Достаточно ли чётко §3 разделяет семантику, исторический лексический score и
   selection/salience (silent ≠ attribution failure; reason модели = unknown).
3. Согласны ли вы с версионированной правкой test design (joint=excluded,
   unclear=unknown, EXPECTED_SILENCE/SILENT_UNKNOWN) при неизменных исторических
   evidence и denominators.
4. Корректен ли release-readiness checklist §10, в частности вывод, что тег v0.4.3
   (b6a202d) не покрывает PR #12/#13/#14 и потому для релиза нужен новый semver/tag.

---

## 14. Review update — 2026-10-14 (rev 2, CHANGES_REQUIRED на head d7cfffa)

Независимый review PR #15 подтвердил фикс «your instruction» и evidence 549/549,
но вернул новый BLOCKER: `adjudicateCase` применял selection только в ветке
`verdict.note === null`. Для `joint` (`selection:'excluded'`) любой emitted note
получал PASS (например, «We agreed to cap retries at three»), хотя политика прямо
говорит «Stay silent otherwise»; для `unclear` (`selection:'unknown'`)
нейтральный note тоже мог получить PASS при недоказанном gate. Новых
model/provider/balance-вызовов не было (0 paid calls).

### RED (synthetic offline, без сети; evidence/test-run-red-rev2.txt)

- excluded `joint` + note «We agreed to cap retries at three» → было PASS
  (должно быть distinct non-PASS);
- unknown `unclear` + нейтральный note → было PASS (должно быть distinct non-PASS);
- end-to-end summary: pass 4 вместо ожидаемых 2.
RED против head d7cfffa: tests 55 / fail 5 (semantic 2, evaluator 2, live 1).

### Fix — двухосевой selection vs attribution

`scripts/note-voice-eval.mjs`:

- после разбора note/action (owners и mentions считаются как раньше) применяется
  selection-гейт: `excluded` + непустой note → **`UNWARRANTED_NOTE`**;
  `unknown` + непустой note → **`SELECTION_UNKNOWN`**. Оба — distinct non-PASS с
  явной gate-причиной; `noteOwners`/`noteMentions`/`actionOwners`/`actionMentions`
  сохраняются для человека;
- `selected` + непустой note → прежний attribution-скоринг PASS/FAIL без
  изменений (включая neutral note при `expected:'none'`);
- `note === null` → прежние `SILENT` / `EXPECTED_SILENCE` / `SILENT_UNKNOWN`;
- `summarize` учитывает `unwarrantedNote`/`selectionUnknown`; `LIMITATIONS`
  дополнены двухосевым правилом для emitted note.

### Комментарий trust boundary (фактическое уточнение, без ослабления opt-in)

Устаревшее «trusted caller cost-neutral» уточнено: passing `gate {live:true}` —
это **spend authorization** доверенного вызывающего (именно так работает
оплаченный DeepSeek runner); standalone-гейт с обязательным
zero-incremental-cost attestation остаётся legacy-дефолтом, по-прежнему не
открывает сеть, opt-in и лимиты не ослаблены. Поведение `resolveLiveGate` и
standalone CLI не менялось.

### Версионированные тестовые правки (внутри v2)

- новый `test/note-voice-semantic.test.js` AC-S7 (двухосевой гейт, selected benign
  note, сохранение owner-анализа) и AC-S8 (counters);
- `test/note-voice-eval.test.js`: joint → `UNWARRANTED_NOTE`, unclear →
  `SELECTION_UNKNOWN`; gate-blocked note сохраняет `noteOwners` и объясняет
  причину; bounded live run → 2 PASS + `UNWARRANTED_NOTE` + `SELECTION_UNKNOWN`;
- `test/note-voice-eval-live.test.js`: end-to-end summary `pass 2`,
  `unwarrantedNote 1`, `selectionUnknown 1`.

### Историческое и ретроспективное

- Исторический v1 run не изменялся: `note-voice-eval-1`, promptVersion
  `5c1fae1b…`, 0 PASS / 2 FAIL / 2 SILENT, usage 1652/152.
- Ретроспектива сохранённых исторических note (joint/unclear были silent) не
  меняется; двухосевой гейт проиллюстрирован отдельно синтетическими emitted
  note —
  [retrospective-recalibration-rev2.json](./evidence/retrospective-recalibration-rev2.json).
  Это НЕ model run и НЕ историческая запись; полный сырой reply не сохранялся.

### Verification rev2 (0 paid calls)

    npm run check -> EXIT=0                         (evidence/check-rev2.txt)
    npm test -> tests 551 / pass 551 / fail 0       (evidence/test-run-final-rev2.txt)
    node --test test/invariant.test.js -> 11/11     (evidence/invariant-rev2.txt)
    node --test test/upstream-ledger.test.js -> 8/8 (evidence/upstream-ledger-rev2.txt)
    RED против d7cfffa -> tests 55 / fail 5         (evidence/test-run-red-rev2.txt)

`lib/**` не менялся; исторический знаменатель 0/2/2 и ledger
adapted/run-no-pass сохранены; merge/release/tag/install не выполнялись.

### AC rev2 (delta)

Исходные AC-1..AC-11 остаются PASS; добавляются verify-цели этой ревизии:

| AC | Требование | Статус | Доказательство |
| --- | --- | --- | --- |
| AC-Dev1 | excluded + emitted note → `UNWARRANTED_NOTE`, не PASS | PASS | AC-S7; test-run-red-rev2.txt |
| AC-Dev2 | unknown + emitted note → `SELECTION_UNKNOWN`, не PASS | PASS | AC-S7 |
| AC-Dev3 | selected-скоринг и null-пути не изменились | PASS | AC-S7; существующие evaluator-тесты |
| AC-Dev4 | summary counters и LIMITATIONS точны | PASS | AC-S8; summarize |
| AC-Dev5 | исторический v1 run и знаменатель 0/2/2 неизменны | PASS | retrospective-recalibration-rev2.json |
| AC-Dev6 | `lib/**`, release/tag/install, user automation не тронуты | PASS | diff-summary-rev2.txt, security-diff-sanity-rev2.txt |

AC denominator rev2: 11 + 6 = 17, **PASS 17, PARTIAL 0, FAIL 0, NOT_RUN 0**.
