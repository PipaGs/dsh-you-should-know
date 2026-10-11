# Final report — ysk-empty-state-dock-20261011

**Статус:** READY_FOR_CHATGPT_REVIEW · DSH не мержит.
**Product head (коммит с кодом, тестами, README и evidence):** `f1c3dedb4710e37c5b9262d4dc84a13a15169dee`
**База:** `origin/main` `af401479a6335982074ae9b9285efb26114237d5` (tag `v0.4.2`).
**Ветка:** `feat/ysk-empty-state-dock` (worktree `.worktrees/ysk-empty-state-dock`).
**PR:** один, из этой ветки в `main`; точный PR head — коммит, добавляющий этот отчёт, зафиксирован в описании PR и в handoff.
**Инструмент:** DeepSeek Harness, supervised goal `goal-session-a2bf702d-c228-4dfe-b0d1-a0faab483821`, mode strict.

---

## 1. Что просили

После обсуждения, что `conversation.input.dock` возвращает `null`, когда `noteCount/historyCount` равны нулю, пользователь сказал «сделай чтоб показывалось»: карточка **You should know** над композером DSH должна показываться и при отсутствии находок/истории, в том числе после рестарта хоста. Нужно минимальное persistent, компактное, **правдивое** пустое состояние («No notes yet»), при сохранении существующего поведения активной заметки и истории. Запрещено: фабриковать находку, сохранять заметки между рестартами, форсировать LLM-review, ослаблять Paranoid или менять reviewer engine/гейты.

## 2. Границы (scope / write set)

Написано:

- `lib/client.js` — пустое состояние (единственный production-файл).
- `test/client-ui.test.js` — 4 новых регрессионных теста.
- `test/client.test.js`, `test/client-hooks.test.js` — старые проверки «renders nothing» переведены на новое поведение.
- `README.md` — 2 строки описания.
- `docs/harness-reports/ysk-empty-state-dock-20261011/` — этот отчёт и визуальные доказательства.

Не тронуто (AC3): `lib/core.js`, `lib/runtime.js`, `lib/index.js`, `lib/review-strictness.js`, `lib/review-profile.js`, `lib/adaptive.js`, `lib/evidence.js`, `lib/explain.js`, `lib/feedback.js`, `lib/language.js`, `lib/update.js`, `lib/self-check.js`, `lib/self-check.js`, `package.json`, `cordis.patch.yml`. Локальный `main` не изменялся. Существующий несвязанный worktree `.worktrees/ysk-actionable-chat` не трогался.

## 3. Аудит базы и окружения

| Факт | Значение |
|---|---|
| Локальный `main` | `1266a99` (tag `v0.4.0`), отстаёт от `origin/main` на 6 коммитов |
| `origin/main` | `af401479a6335982074ae9b9285efb26114237d5` (tag `v0.4.2`) |
| Установленный в managed-профиле плагин | `github:PipaGs/dsh-you-should-know` → tarball `af40147` — ровно база задачи |
| Изоляция | worktree `.worktrees/ysk-empty-state-dock` на `origin/main`, ветка `feat/ysk-empty-state-dock` |
| Рантайм | Node `v26.9.0` (тесты), npm `11.19.1`; DSH Desktop host `0.2.0-rc.2`, bundled node `24.18.1` |

Диффа `lib/client.js` между `v0.4.0` и `v0.4.2` в районе док-карточки нет (изменения v0.4.1–v0.4.2 касаются settings/self-check), поэтому root cause одинаков на обеих ревизиях.

## 4. Root cause и RED

**Root cause.** В `YouShouldKnowDock` (`lib/client.js`, база — строка 956):

```js
const visible = orderNoteCards(notes)
if (sessionId === '') return null
if (visible.length === 0 && !historyOpen && historyCount === 0) return null
```

Пустая сессия возвращала `null` — слот `conversation.input.dock` рендерил ничего. README (строка 156) прямо документировал: «No active note and no history: it renders **nothing**». После рестарта хоста заметки/история in-memory исчезают, значит карточка снова пропадала — именно это и просили исправить.

**RED (до фикса).** Добавлены 4 теста; `node --test test/client-ui.test.js`:

```
✖ a session with no notes and no history keeps a compact No notes yet card
  AssertionError [ERR_ASSERTION]: the dock renders even with no note and no history
      at TestContext.<anonymous> (test/client-ui.test.js:1554:10)
    actual: null
    expected: true
ℹ tests 4 / pass 0 / fail 4
```

После GREEN старые проверки, кодировавшие прежнее `null`, честно упали:

```
$ node --test test/client.test.js
AssertionError ... at test/client.test.js:112
  actual: { type: 'div', props: {...}, children: [...] }
  expected: null

# npm test (полный прогон) показал также:
test/client-hooks.test.js:362  assert.equal(newest.output, null, 'a recent dismissal must survive')
  actual: { type: 'div', ... }  expected: null
```

## 5. Реализация (GREEN)

- Общий стиль внешней колонки вынесен в `DOCK_COLUMN_STYLE` (`lib/client.js:798`), чтобы пустое состояние и стек заметок стояли в одной геометрии.
- Ветка «нет заметок и истории» больше не `null`, а компактная карточка (`lib/client.js:973–996`):

```js
if (visible.length === 0 && !historyOpen && historyCount === 0) {
  return h('div', { style: DOCK_COLUMN_STYLE },
    h('section', {
      role: 'status',
      'aria-label': 'You should know',
      'data-state': 'empty',
      style: { /* та же max-width композера, muted-бордер */ },
    },
      h('span', { style: { fontWeight: 600 } }, 'You should know'),
      h('span', { style: { opacity: 0.8 } }, 'No notes yet')))
}
```

- Ветка `sessionId === ''` по-прежнему возвращает `null` (вне сессии карточки нет) — зафиксировано тестом.
- Ничего в существующем рендере заметок, History-панели, `Add to chat`/`Dismiss`/`Knew it`/`Thanks`/`Explain` и per-session привязке не изменено: пустое состояние занимает ровно ту ветку, которая раньше возвращала `null`.
- Локализация: UI плагина строго англоязычный (это проверяет `test/invariant.test.js`: `public-facing text stays English-only`), поэтому «No notes yet» — консистентный вариант.

## 6. Acceptance matrix

| AC | Требование | Статус | Доказательство |
|---|---|---|---|
| AC1 | Корневая сессия без заметок/истории рендерит компактное доступное «No notes yet», не фальшивую находку; сохраняется после remount/рестарта | **PASS** | `test/client-ui.test.js:1549`, `:1567`; `test/client.test.js:98`; скриншот `evidence/10-empty.png` (`role="status"`, `data-state="empty"`); ни одной `role="note"`-карточки и ни одной note-кнопки |
| AC2 | Active note, history-only, dismissal, loading/error, переключение сессий остаются корректными; заметки/история truthfully scoped | **PASS** | новые `test/client-ui.test.js:1584` (empty → note), `:1603` (A → B → A); существующие тесты pending/history/dismiss/explain/session-switch в `npm test` 485/485; скриншоты `11-pending.png`, `12-history.png` |
| AC3 | Reviewer engine/filtering/limits не изменены | **PASS** | `git diff --numstat af40147..f1c3ded`: среди `lib/*` только `lib/client.js`; `package.json`/`cordis.patch.yml` не тронуты; Paranoid и гейты не тронуты |
| AC4 | RED старых пустых веток → GREEN; suite/build/check; diff/security sanity | **PASS** | RED выше; `npm test` 485/485; `npm run check` OK; `test/invariant.test.js` (seams/secret/install/English-only) внутри прогона |
| AC5 | Native DSH visual proof empty/pending/history с provenance | **PASS (native DSH runtime, isolated profile)** — см. §8 и оговорку | `evidence/10-empty.png`, `11-pending.png`, `12-history.png` + HTML-дампы + `provenance.json` |
| AC6 | Task-owned final-report с матрицей/provenance/research/debugging/results, exact head, unresolved | **PASS** | этот файл |

## 7. Верификация (raw evidence)

**Baseline (worktree на `origin/main` `af40147`, до правок):**

```
$ npm test
ℹ tests 481
ℹ pass 481
ℹ fail 0
```

**Финал (после всех правок):**

```
$ npm run check
check: OK

$ npm test
ℹ tests 485
ℹ pass 485
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`npm test` включает `node --check` по всем `lib/*.js` и `node --test test/*.test.js`. Отдельного шага сборки у плагина нет (`scripts.prepare` отсутствует, `test/invariant.test.js` это фиксирует).

**Изменённые тесты:**

| Файл | Тест | Что проверяет |
|---|---|---|
| `test/client-ui.test.js:1549` | a session with no notes and no history keeps a compact No notes yet card | empty-состояние, `role=status`, `data-state=empty`, отсутствие note-действий |
| `test/client-ui.test.js:1567` | the empty card survives an unmount and a fresh mount after a host restart | ремаунт + свежий «рестарт» бандла |
| `test/client-ui.test.js:1584` | the empty card gives way to a note as soon as the poll reports one | empty → pending без залипания |
| `test/client-ui.test.js:1603` | switching from a note session to an empty session shows the empty card, and back | per-session scoping |
| `test/client.test.js:98` | the card renders a compact empty state for a session with no note | `sessionId===''` → `null`; иначе empty-карточка |
| `test/client-hooks.test.js:263,360` | session switch / bounded dismissal memory | пустая сессия показывает empty, а не чужую заметку; dismissal не воскрешает заметку |

## 8. Визуальное доказательство (AC5)

Запущен **изолированный нативный рантайм DSH** (не managed-профиль пользователя):

```
DSH_HOME=/tmp/ysk-visual-home \
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  --profile ysk --no-open --port 19588
# profile ysk инициализирован из shipped web-шаблона: --from-default-profile web
# плагин подключён симлинком profiles/ysk/node_modules/dsh-you-should-know -> task worktree
```

Управление — Playwright (`chromium_headless_shell-1243`, viewport 1280×900 @2x). Empty-состояние снято на **реальном** ответе host-роута `{ok:true, notes:[]}` (никаких данных); pending и history — детерминированные фикстуры, подставленные на границе HTTP (`GET api/dsh-you-should-know/notes` и `/history`). Полный provenance и хеши — `evidence/provenance.json`.

| Состояние | Скриншот | Что видно |
|---|---|---|
| Empty | `evidence/10-empty.png` (+ `10-empty-page.png`) | «You should know  No notes yet», `role="status"`, `data-state="empty"` |
| Pending | `evidence/11-pending.png` | «You should know · critical», сам finding, `Add to chat`, `Dismiss`, `Knew it`, `Thanks`, `Explain`, `Open file lib/runtime.js:42` |
| History | `evidence/12-history.png` | `Hide history` + `role="group" aria-label="Notification history"` с записями `State: Active` и `State: Dismissed` |

**Оговорки (не прячу):**
- Это нативный DSH рантайм (`dsh-web-app` shell) в изолированном `DSH_HOME`, а **не** окно managed Desktop-профиля. Заходить в managed-профиль и устанавливать туда ветку запрещено условиями задачи, поэтому после-фиксное состояние **managed Desktop profile — NOT PROVEN** и не заявляется.
- Pending/history заметки — фикстуры на сетевой границе; empty — реальный host-роут. Это указано и в `provenance.json`.

## 9. Дифф и security sanity

```
$ git diff --numstat af40147..f1c3ded
2	2	README.md
43	12	lib/client.js
4	2	test/client-hooks.test.js
81	0	test/client-ui.test.js
13	2	test/client.test.js
```

- Среди production `lib/*` изменён только UI-файл `lib/client.js`; host-половина, роуты, reviewer engine, лимиты, strictness-профили не тронуты.
- Новых зависимостей/роутов/полей конфига нет; `package.json` и `cordis.patch.yml` не менялись.
- `test/invariant.test.js` (в составе 485/485) проверяет: отсутствие `steer/followup/inject/transcript`, отсутствие cookie/token/storage, отсутствие install/self-modify, English-only публичный текст — всё зелёное.
- Визуальное доказательство не содержит секретов: токен изолированного инстанса одноразовый и относится только к `/tmp/ysk-visual-home`.

## 10. External research

- **NOT REQUIRED.** Правка не вводит новых библиотек/API/версий: используется уже существующий в `lib/client.js` `React.createElement` + `useState`/`useEffect` и существующий контракт слота `conversation.input.dock`; поведение задано текущими тестами и invariant-сканами. Context7/веб-поиск не требовались.
- **Ponytail skill — UNAVAILABLE** (нет в каталоге скиллов сессии; проверено на preflight).

## 11. Что не сделано / unresolved

- **Deployment pending.** Managed Desktop-профиль пользователя по-прежнему исполняет `af40147` (v0.4.2). Плагин туда не устанавливался/не обновлялся; релиз не публиковался.
- Версия пакета не поднималась (остаётся `0.4.2`), т.к. release/bump в scope не входил и требует отдельной авторизации.
- Нативное after-доказательство из managed Desktop-профиля: **NOT ATTEMPTED / NOT PROVEN** (инсталляция в managed-профиль запрещена).
- Merge в `main` не выполнялся — PR оставлен на ревью.

## 12. Rulings

- Пустое состояние рендерится только в ветке, которая раньше возвращала `null`; в полностью пустой сессии нет кнопки `History` — эта кнопка и раньше там не показывалась. Цена ошибки: на новой сессии нет шортката к пустой истории.
- Ledger/SDD workspace созданы вручную (`.superpowers/`, локально исключён): plan-файла нет, спецификацией служит Goal-блок. Цена ошибки: только бухгалтерия.
- AC5 засчитан как PASS на изолированном нативном DSH-рантайме, а не на managed Desktop-профиле. Цена ошибки: ревьюер вправе понизить AC5 до partial.
