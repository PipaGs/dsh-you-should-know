# Final report — ysk-hide-empty-banner-20261013

**Статус:** READY_FOR_CHATGPT_REVIEW · DSH не мержит и не self-approve.
**Product head (код, тесты, README):** `dfceb158168c7388f1a8e35faeb64a8d8d679ee3`
**Evidence head (логи, скриншоты, provenance):** `8bff399004c596c4f91e81d098dccaca6e684295`
**База:** `origin/main` `5d60d662a666e2f54ebed76b8ac0f081d6f7e3be` (merge PR #8).
**Ветка:** `fix/ysk-hide-empty-banner` (worktree `.worktrees/ysk-hide-empty-banner`).
**PR:** #9 — https://github.com/PipaGs/dsh-you-should-know/pull/9; точный head на момент handoff зафиксирован в описании PR.
**Инструмент:** DeepSeek Harness, supervised goal `goal-session-c8e54391-0f28-42b0-aed2-2008c4babbb8`, mode strict.

---

## 1. Что просили

Убрать из UI пустой баннер «You should know — No notes yet», который появился после PR #8. Показывать **весь** баннер/контейнер только при наличии настоящих заметок; при их отсутствии не оставлять ни метки, ни рамки, ни отступов/разрыва. Сохранить хранение заметок, populated-представление и переходы empty -> populated -> empty. Заметки как фичу не удалять. ChatGPT владеет ревью и merge; DSH не self-approve.

Предыдущая задача по той же ветке кода: PR #8 (`feat/ysk-empty-state-dock`), отчёт `docs/harness-reports/ysk-empty-state-dock-20261011/final-report.md`, product head `f1c3ded`. Настоящая задача — новый дефект (нежелательное пустое состояние), поэтому новый task ID/branch/PR, а не продолжение merged-ветки.

## 2. Границы (scope / write set)

Написано:

- `lib/client.js` — единственный production-файл: пустая ветка возвращает `null`.
- `test/client-ui.test.js`, `test/client.test.js`, `test/client-hooks.test.js` — перевод проверок пустого состояния на новое поведение + проверка появления реальной заметки.
- `README.md` — 2 строки описания пустого состояния.
- `docs/harness-reports/ysk-hide-empty-banner-20261013/` — этот отчёт и доказательства.

Не тронуто: `lib/core.js`, `lib/runtime.js`, `lib/index.js`, `lib/self-check.js`, `lib/update.js`, `lib/review-strictness.js`, `lib/review-profile.js`, `lib/adaptive.js`, `lib/evidence.js`, `lib/explain.js`, `lib/feedback.js`, `lib/language.js`, `package.json`, `cordis.patch.yml`. Локальный `main` не изменялся; чужие worktree `.worktrees/ysk-actionable-chat` и `.worktrees/ysk-empty-state-dock` не трогались.

## 3. Аудит базы и окружения

| Факт | Значение |
|---|---|
| `origin/main` (база) | `5d60d662a666e2f54ebed76b8ac0f081d6f7e3be` — merge PR #8 |
| Проверка целостности базы | `shasum -a 256 lib/client.js` на базе = `4a2bcd2030f33b68794525c0f384ac9ed2b0222a540a784a4b8a54c97c9c3335` — совпадает с `plugin.lib_client_sha256` отчёта PR #8, то есть взята ровно смерженная версия |
| Изоляция | worktree `.worktrees/ysk-hide-empty-banner`, ветка `fix/ysk-hide-empty-banner` |
| Рантайм тестов | Node `v26.9.0`, npm `11.19.1` |
| Визуальный рантайм | DSH Desktop host `0.2.0-rc.2`, изолированный `DSH_HOME=/tmp/ysk-hide-banner-home`, управляемый профиль не тронут |
| Браузер | Playwright `1.63.0`, chrome-headless-shell (chromium 1243), 1280x900 @2x |

## 4. Root cause и RED

**Root cause.** В `YouShouldKnowDock` (`lib/client.js`, база — строки 969–997) ветка «нет активных заметок и нет истории» рендерила непустой `div`/`section`:

```js
if (visible.length === 0 && !historyOpen && historyCount === 0) {
  return h('div', { style: DOCK_COLUMN_STYLE },
    h('section', { role: 'status', 'aria-label': 'You should know', 'data-state': 'empty', style: {...} },
      h('span', { style: { fontWeight: 600 } }, 'You should know'),
      h('span', { style: { opacity: 0.8 } }, 'No notes yet')))
}
```

Именно этот `div`/`section` давал видимую метку, рамку и отступ. До PR #8 та же ветка возвращала `null`; после — стала рисовать баннер.

**RED (тесты первыми, до фикса).** Проверки переписаны на «док не рендерится», затем прогнаны на дереве базы с новыми тестами (`evidence/test-run-red.txt`, SHA256 `7d4ca5…`):

```
$ node --test test/client.test.js test/client-ui.test.js test/client-hooks.test.js
ℹ tests 94
ℹ pass 88
ℹ fail 6
✖ a session switch never renders the previous session note, not even for one frame
✖ a session with no notes and no history renders no dock at all
✖ an empty session stays empty across an unmount and a fresh mount after a host restart
✖ a real note appears as soon as the poll reports one, with its heading and actions
✖ switching from a note session to an empty session hides the dock, and back
✖ the card renders nothing for a session with no note and no history
    actual: { type: 'div', props: { style: [Object], children: [Object] }, ... }
    expected: null
```

Все 6 падений — ровно текущий пустой баннер там, где ожидается `null`.

**Baseline (дерево базы без новых тестов, `evidence/test-run-baseline.txt`, SHA256 `a8da91…`):** `npm test` — 485/485.

## 5. Реализация (GREEN)

Единственная правка production-кода — `lib/client.js` (5 добавлено / 29 удалено):

```js
// No note and no history is a real state, and it must leave no trace: an
// empty banner above the composer would add a label, a border and a gap
// with nothing to report. The dock renders nothing until a note or a
// history entry exists, then the full stack below returns.
if (visible.length === 0 && !historyOpen && historyCount === 0) return null
```

- `DOCK_COLUMN_STYLE` остаётся нужным: его использует populated-ветка (стек заметок).
- Ветка `sessionId === ''` по-прежнему `null`.
- Рендер заметки (`role="note"`, заголовок `You should know`/`· critical`, текст, `Add to chat`, `Dismiss`, `Knew it`, `Thanks`, `Explain`, `Open file`), History-панель, per-session привязка и опрос не изменялись.
- `lib/client.js` после фикса: SHA256 `4151fae8011f5842d18c47c0f8eb5141562e8ecd343c1f436740286f17b8e6b5`.

## 6. Acceptance matrix

| AC | Требование | Статус | Доказательство |
|---|---|---|---|
| AC-1 | Нет заметок/истории => нет баннера, нет «No notes yet», нулевой layout-footprint | **PASS** | `test/client-ui.test.js:1549` (hidden empty state), `test/client.test.js:98`, `test/client-hooks.test.js:263`; `evidence/10-empty.json`: dock slot `0x0`, 0 детей, `youShouldKnowNodes=0`, `emptyStateNodes=0`, `hasNoNotesYet=false`, все действия `false`; `10-empty.png` |
| AC-2 | Есть настоящая заметка => обычный заголовок и содержимое без потери данных | **PASS** | `test/client-ui.test.js` (real note appears + существующие note/History/feedback тесты в `npm test` 485/485); `evidence/11-populated.json`: `role=note`, заголовок `You should know · critical`, полный текст заметки, `Add to chat`/`Dismiss`/`Knew it`/`Thanks`/`Explain` = true; `11-populated.png` |
| AC-3 | Переходы empty -> populated -> empty и соседний композер не затронуты | **PASS** | `test/client-ui.test.js` (poll empty->note; switch note->empty->note); на одной странице: empty (без перехвата) -> populated -> history -> empty-again; `13-empty-again.png` побайтово идентичен `10-empty.png` (оба SHA256 `499b49…`) |
| Gate | VISUAL_GATE (реальные скриншоты целевого приложения с provenance и SHA) | **PASS** | §8, `provenance.json` |
| Gate | DIFF_SANITY | **PASS** | §9 |
| Gate | SECURITY_SANITY | **PASS** | §9 |

## 7. Верификация

Полные логи закоммичены, а не выдержки:

| Лог | SHA256 | Что это |
|---|---|---|
| `evidence/test-run-baseline.txt` | `a8da91892c5628cd032be52de044d333e8d587b016fcde1cd17cbb1d8cb8e7f3` | полный `npm test` на дереве базы `5d60d66`: 485/485 |
| `evidence/test-run-red.txt` | `7d4ca5dbb0354ca246fc43248eb4177241651d1960ea44007013036f37f52869` | новые тесты на коде базы: 94 теста, 6 падений |
| `evidence/test-run-final.txt` | `a84eec787bda395d50596c451ab5511a96258a337ce100ee81edca33c9fedb1c` | полный `npm test` на product tree `dfceb15`: 485/485 |
| `evidence/check.txt` | `e7d92b340e4e2d160da356e0e79ff8074fa026a406f4d6001fd6aecd16ee7488` | `npm run check`: exit 0 |

Агрегат финала:

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

`npm test` включает `node --check` по всем `lib/*.js` и `node --test test/*.test.js`, в том числе `test/invariant.test.js` (seams/secret/install/English-only). Отдельного шага сборки у плагина нет.

**Chronology.** Полный прогон и визуальная съёмка выполнены на product tree `dfceb15`; коммиты после него (`8bff399` и report-commit) добавляют только `docs/harness-reports/`. На финальном head прогон повторён; результат приведён в описании PR и в handoff-сообщении.

## 8. Визуальное доказательство (реальный целевой рантайм)

Запущен **изолированный нативный рантайм DSH** (не managed-профиль пользователя):

```
DSH_HOME=/tmp/ysk-hide-banner-home \
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  ysk --from-default-profile web --no-open --port 19590
# плагин подключён симлинком profiles/ysk/node_modules/dsh-you-should-know -> task worktree
```

Управление — Playwright (`chromium_headless_shell-1243`, viewport 1280×900 @2x). Empty-состояние снято **без перехвата**: реальный аутентифицированный host-роут `GET api/dsh-you-should-know/notes` дал `evidence/empty-host-response.json` (status 200, `ok: true`, `notes: []`, `historyCount: 0`). `page.route` ставится только после `10-empty`, поэтому populated/history/empty-again — явные HTTP-фикстуры. Портативный скрипт без машинных путей — `evidence/capture.cjs`.

| Состояние | Скриншот | Что видно / измерено |
|---|---|---|
| Empty (реальный host-роут) | `evidence/10-empty.png` (+ `10-empty-page.png`) | Ни баннера, ни «No notes yet», ни узла `You should know`; dock slot `0x0`, 0 детей — нулевой footprint |
| Populated (фикстура) | `evidence/11-populated.png` | `You should know · critical`, полный текст заметки (не потерян), `Add to chat`, `Dismiss`, `Knew it`, `Thanks`, `Explain`, `Open file lib/runtime.js:42`; dock content `744x120` над композером |
| History (фикстура) | `evidence/12-history.png` | `Hide history` + записи `State: Active` и `State: Dismissed` |
| Empty again (фикстура, та же страница) | `evidence/13-empty-again.png` | Баннер снова исчез; PNG побайтово равен `10-empty.png` |

**Оговорки (не прячу):**
- Это нативный DSH-рантайм (`dsh-web-app` shell) в изолированном `DSH_HOME`, а **не** окно managed Desktop-профиля. После-фиксное состояние managed Desktop-профиля — **NOT PROVEN** и не заявляется.
- Заметки в populated/history — фикстуры на сетевой границе; empty — реальный host-роут.
- Токен изолированного инстанса одноразовый и в файлы доказательств не записан.

## 9. Дифф и security sanity

```
$ git diff --numstat 5d60d66..dfceb15
2	2	README.md
5	29	lib/client.js
1	1	test/client-hooks.test.js
23	21	test/client-ui.test.js
5	10	test/client.test.js
```

- Среди production `lib/*` изменён только UI-файл `lib/client.js`; host-половина, роуты, reviewer engine, лимиты, strictness-профили не тронуты.
- Новых зависимостей/роутов/полей конфига нет; `package.json` и `cordis.patch.yml` не менялись.
- `test/invariant.test.js` (в составе 485/485) проверяет отсутствие `steer/followup/inject/transcript`, cookie/token/storage, install/self-modify, а также English-only публичный текст — зелёный.
- Удалён только UI-текст «No notes yet» и его DOM; заметки, их хранение и host-роуты не удалялись.

## 10. External research

- **NOT REQUIRED.** Правка не вводит библиотек/API/версий: используется уже существующий `React.createElement` + `useState`/`useEffect` в `lib/client.js` и существующий контракт слота `conversation.input.dock`. Context7/веб-поиск не требовались.

## 11. Что не сделано / unresolved

- **Deployment pending.** Managed Desktop-профиль пользователя не обновлялся; версия пакета не поднималась (остаётся `0.4.2`).
- Нативное after-доказательство из managed Desktop-профиля: **NOT ATTEMPTED / NOT PROVEN**.
- Merge в `main` не выполнялся — PR #9 оставлен на ревью.

## 12. Rulings

- Пустое состояние скрыто ровно в той ветке, которая до PR #8 возвращала `null`; создание нового пустого состояния не добавлялось. Цена ошибки: на пустой сессии нет шортката к пустой History — он и раньше не показывался.
- Пустая сессия по-прежнему рендерит History-кнопку, если `historyCount > 0`, даже без активных заметок — это существующее поведение, не менявшееся. Цена ошибки: если ChatGPT считает, что кнопка тоже должна исчезать при пустых заметках, потребуется отдельное решение.
- Baseline/RED-логи получены в отдельном временном worktree на базе `5d60d66` (удалён после прогона), чтобы не трогать product tree. Цена ошибки: только воспроизводимость — команды приведены.
