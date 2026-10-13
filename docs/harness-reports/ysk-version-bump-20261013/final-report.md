# Final report — ysk-version-bump-20261013

**Статус:** READY_FOR_CHATGPT_REVIEW · DSH не мержит и не self-approve.
**Product head (код, тесты, README):** `0b1e2d69846dbee0b96e33d44d60cad393fd42b0`
**Evidence head (логи, provenance):** `7173f22da8fa181b01b724083b942f4fe849b520`
**База:** `origin/main` `5a8dda344079d2854972922fa142d185a24a1436` (merge PR #9).
**Ветка:** `chore/ysk-version-bump-0.4.3` (worktree `.worktrees/ysk-version-bump`).
**PR:** #10 — https://github.com/PipaGs/dsh-you-should-know/pull/10.
**Инструмент:** DeepSeek Harness, supervised goal `goal-session-d01bdb69-2213-4cee-843a-c37ddb07aa12`, mode strict.

---

## 1. Что просили

После merge PR #9 (`fix/ysk-hide-empty-banner`) определить фактическую политику версионирования и сделать минимальный patch-инкремент версии до `0.4.3`, синхронизировав авторитетные зеркала версии. Scope — изменение версии в исходниках через reviewable PR, без release/distribution workflow. Сохранить UI-фикс PR #9. DSH исследует, меняет и тестирует; ChatGPT ревьюит и мержит.

## 2. Границы (scope / write set)

Изменено (6 файлов, 13 добавлений / 13 удалений):

| Файл | Что |
|---|---|
| `package.json` | `version` 0.4.2 → 0.4.3 |
| `lib/index.js` | `PLUGIN_VERSION` 0.4.2 → 0.4.3 |
| `README.md` | Status-строка, self-check sample (приведён к запущенной версии), tag-pinned install-адрес `#v0.4.2` → `#v0.4.3` |
| `test/invariant.test.js` | литерал текущей версии в проверке манифеста → 0.4.3 |
| `test/plugin.test.js` | литералы `pluginVersion/runtimeVersion/installedVersion` → 0.4.3 |
| `test/update-route.test.js` | литерал в проверке «PLUGIN_VERSION mirrors package.json» → 0.4.3 |

Плюс task-owned каталог `docs/harness-reports/ysk-version-bump-20261013/` (этот отчёт и evidence).

Не тронуто: `lib/client.js` и клиентские тесты (UI-фикс PR #9), остальные `lib/*`, `cordis.patch.yml`, `docs/harness-reports/ysk-*` (историческое evidence), managed Desktop-профиль, теги/релизы, npm publish. Локальный `main` не изменялся; чужие worktree не трогались. Commit/push/PR выполнены в task-owned ветке.

## 3. Аудит базы и политики версий

**Фактическая политика — patch-инкремент на каждое смерженное изменение, все зеркала синхронизируются в одном коммите.** История `package.json`:

```
d67e01b (v0.4.2) -> 0.4.2      462a824 (v0.4.1) -> 0.4.1
a9519f4 (v0.4.0) -> 0.4.0      4aa3705 -> 0.3.8   153cbcc -> 0.3.7
e96c5bb -> 0.3.6   ...  b344d8d -> 0.3.1
```

Каждый bump-коммит менял: `package.json`, `lib/index.js`, README (Status + install-адрес + self-check sample) и версионные литералы в `test/invariant.test.js`, `test/plugin.test.js`, `test/update-route.test.js` (проверено `git show d67e01b --stat`). Теги `v0.4.0..v0.4.2` указывают на merge-коммиты PR #5–#7.

**Install-адрес — авторитетное зеркало, а не «release ref вне scope».** Это доказано тестом `test/install-discovery.test.js:82` («the README documents only tag-pinned GitHub install addresses»): он требует, чтобы каждый `dsh plugin add` адрес в README равнялся `pinnedSpec(manifest.version)`. Полный прогон на промежуточном дереве дал:

```text
AssertionError: github:PipaGs/dsh-you-should-know#v0.4.2 is not the pinned address for 0.4.3
```

Поэтому адрес поднят до `#v0.4.3` вместе с `package.json`. См. ruling §10.

Проверка базы: worktree создан от `origin/main` `5a8dda3`, что совпадает с `refs/heads/main` на remote. Тег `v0.4.3` на remote отсутствует (публикация — вне scope).

| Факт | Значение |
|---|---|
| База | `5a8dda344079d2854972922fa142d185a24a1436` |
| Product head | `0b1e2d69846dbee0b96e33d44d60cad393fd42b0` |
| Evidence head | `7173f22da8fa181b01b724083b942f4fe849b520` |
| Рантайм | Node `v26.9.0`, npm `11.19.1` |
| Хэши продукта | `package.json` `e52ef61f…`, `lib/index.js` `39adb501…`, `README.md` `be7cbbc7…` |

## 4. RED

Тесты, фиксирующие текущую версию, обновлены первыми — до бампа исходников. На дереве, где источник ещё `0.4.2`, а ожидание уже `0.4.3` (`evidence/test-run-red.txt`, SHA256 `687e3a7b…`, exit 1):

```text
✖ the manifest declares the bundle, the client half, and no build step        actual '0.4.2' expected '0.4.3'
✖ the authenticated self-check route reports only the bounded running plugin state  actual '0.4.2' expected '0.4.3'
✖ the exported plugin version mirrors package.json                            actual '0.4.2' expected '0.4.3'
ℹ tests 3   ℹ pass 0   ℹ fail 3
```

Отдельный RED для install-зеркала: при `package.json` 0.4.3 и старом README-адресе `test/install-discovery.test.js` падал (`evidence/test-run-install-ref-red-repro.txt`, SHA256 `b1daf155…`). Это контролируемая репродукция already-наблюдённого падения (см. ruling §10); README перед и после репродукции побайтово идентичен (`be7cbbc7…`).

## 5. Реализация (GREEN)

Единственная production-правка версии — `package.json` + `lib/index.js` + README; поведение не менялось. После синхронизации всех зеркал:

```text
$ node --test --test-name-pattern='<version mirrors>' test/invariant.test.js test/plugin.test.js test/update-route.test.js
ℹ tests 3   ℹ pass 3   ℹ fail 0      (evidence/test-run-green-version.txt)

$ npm test
ℹ tests 485   ℹ pass 485   ℹ fail 0   (evidence/test-run-final.txt)
```

## 6. Acceptance matrix

| AC | Требование | Статус | Доказательство |
|---|---|---|---|
| AC1 | manifest и зеркала = `0.4.3`, нет устаревшей in-scope `0.4.2` | **PASS** | `package.json`/`PLUGIN_VERSION` = 0.4.3 (`version-validation.txt`); README Status, self-check sample и install-адрес = 0.4.3; `version-scan.txt`: оставшиеся `0.4.2` — только mismatch-фикстуры `test/self-check.test.js:258,261` и `test/client-ui.test.js:2223` плюс историческое docs/evidence |
| AC2 | UI-фикс PR #9 цел, нет побочных product-изменений | **PASS** | `git diff 5a8dda3..0b1e2d6 -- lib/ test/client*.js` → только `lib/index.js`; в `lib/client.js` и клиентских тестах диффа нет; 5 профильных PR #9 empty-state тестов зелёные (`pr9-ui-fix-intact.txt`) |
| AC3 | Свежие `npm run check`, `npm test`, version/package validation на финальном дереве | **PASS** | `check.txt` exit 0; `test-run-final.txt` 485/485; `version-validation.txt` exit 0 |
| Gate | DIFF_SANITY | **PASS** | §8 |
| Gate | SECURITY_SANITY | **PASS** | §8 |
| Gate | VISUAL_GATE | **NOT REQUIRED** | §9 |

## 7. Верификация

Сырые логи закоммичены целиком, не выдержки:

| Лог | SHA256 | Что это |
|---|---|---|
| `evidence/test-run-red.txt` | `687e3a7b3aa379af0e89bc438d7499861424a05589439c73fca4b888cec99f9e` | version-mirror тесты на неbumped источнике: 3/3 fail |
| `evidence/test-run-install-ref-red-repro.txt` | `b1daf155c2db519791eb317a3c45c80aaccfb94d8d4a270b3028e62fad3eb944` | install-discovery RED при старом README-адресе |
| `evidence/test-run-green-version.txt` | `fa01dd351b13f9896bf2956e6a1319fb740d177cb67fae58a1c0eb0810baa174` | те же 3 проверки после бампа: 3/3 pass |
| `evidence/test-run-final.txt` | `65188adf8d3424f60688d2ea6e4e38977a4310789bbd6c9bc68c594d4a8886f1` | полный `npm test` на product head: 485/485 |
| `evidence/check.txt` | `269cd2fc91b9183d2ff75670670744c7227cce4b9fc4b57abe4a7aac74bd9c21` | `npm run check`: exit 0 |
| `evidence/version-validation.txt` | `80f49e68dde1af13fddd73255a6c0437b7dd8e93c68e7672ca5cc303adfaf1e8` | package.json == PLUGIN_VERSION == 0.4.3; `npm pkg get version` = "0.4.3" |
| `evidence/version-scan.txt` | `a386bb0ebf5e4c25df1a37c262ef6d5c97e4b0c251c83a0daaf754395f59c6b0` | `git grep` 0.4.2/0.4.3 по tracked (docs history исключено) |
| `evidence/pr9-ui-fix-intact.txt` | `4e31f5c38511df789a399a53ef959acfd0123342ec5a0803bd03aa5c24753d46` | 5 профильных PR #9 тестов: 5/5 pass |
| `evidence/diff-and-security-sanity.txt` | `e21fd00723d14bb7d8e5042024f1af9d317d29df27f0dbeecec86a5d423a0ebd` | numstat, PR #9 preservation, secret/URL-скан |
| `evidence/provenance.json` | — | base/product head, branch, версии рантайма |

Хронология: product-коммит `0b1e2d6`, затем evidence-коммит `7173f22`; `npm test` 485/485 выполнен на product head. Финальный head этого PR добавляет только `docs/harness-reports/`, что не влияет на product-код и тесты.

## 8. Дифф и security sanity

```text
$ git diff --numstat 5a8dda3..0b1e2d6
6	6	README.md
1	1	lib/index.js
1	1	package.json
1	1	test/invariant.test.js
3	3	test/plugin.test.js
1	1	test/update-route.test.js
```

- Среди `lib/*` изменён только `lib/index.js` (константа версии). Host-логика, роуты, reviewer engine, лимиты, strictness-профили, клиентская половина — без изменений.
- Новых зависимостей, роутов, полей конфига, outbound-запросов нет; `cordis.patch.yml` не менялся.
- Secret/URL-скан по продуктовому диффу — совпадений нет (`diff-and-security-sanity.txt`).
- `test/invariant.test.js` в составе 485/485 проверяет отсутствие `steer/followup/inject/transcript`, cookie/token/storage, install/self-modify и English-only публичный текст — зелёный.

## 9. VISUAL_GATE

**NOT REQUIRED.** Изменены только версионные метаданные (манифест, константа, README и версионные литералы тестов). Ни DOM, ни CSS, ни поведение карточки не менялись: `lib/client.js` побайтово совпадает с базой (дифф пуст), а профильные empty-state тесты PR #9 проходят 5/5. Снимать нечего.

## 10. Rulings

- **Install-адрес всё-таки поднят до `#v0.4.3`.** Сначала я счёл его release-ref вне scope (тег `v0.4.3` ещё не существует). Полный `npm test` показал, что проект это enforcement-ит тестом `test/install-discovery.test.js:82`: адрес обязан равняться `pinnedSpec(manifest.version)`. Политика важнее моей первоначальной догадки. Цена ошибки: до публикации тега `v0.4.3` README указывает на ещё не существующий ref; создание тега — вне scope и остаётся за ChatGPT/релизом. Если reviewer решит, что source-bump без релиза не должен трогать install-адрес, потребуется отдельное исключение из теста.
- **README self-check sample и Status-строка обновлены** как документационные зеркала запущенной/установленной версии (историческая практика каждого bump-коммита), а не как побочные product-изменения. Цена ошибки: нулевая — это пример полезной нагрузки, генерируемой рантаймом из `PLUGIN_VERSION`/манифеста.
- **Mismatch-фикстуры оставлены.** `test/self-check.test.js:258,261` (`pluginVersion '0.4.1'` vs `installedVersion '0.4.2'`) и `test/client-ui.test.js:2223` (`installedVersion '0.4.2'`) кодируют сценарий «runtime ≠ installed», а не текущую версию проекта. Полный зелёный suite это подтверждает. Цена ошибки: если reviewer захочет переименовать фикстуры в явно синтетические значения — косметика, не влияет на поведение.
- **RED через test-first.** Сначала обновил версионные литералы тестов, увидел 3 падения на старом источнике, затем поднял источник. Цена ошибки: нет — RED реален и закоммичен.

## 11. Что не сделано / unresolved

- **Release pending.** Тег `v0.4.3` не создавался, npm publish не выполнялся — release/distribution workflow вне scope.
- **Managed Desktop не тронут.** Управляемый профиль не обновлялся.
- Merge в `main` не выполнялся — PR #10 оставлен на ревью ChatGPT.

## 12. External research

- **NOT REQUIRED.** Изменение не вводит библиотек/API/версий зависимостей; Context7/веб-поиск не требовались.
