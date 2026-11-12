# Тестовый проект

Целевой проект: `wepogbvijpvyvyfzxzeo`.
Dashboard: https://supabase.com/dashboard/project/wepogbvijpvyvyfzxzeo .
Рабочий проект `mskbgkiksgpdosiarjvo` не является целью этого этапа.

## Первый запуск через SQL Editor

1. Открыть https://supabase.com/dashboard/project/wepogbvijpvyvyfzxzeo/sql/new .
2. Вставить целиком `docs/staging-setup.sql`, убедиться в адресе целевого staging и выполнить Run.
3. Ожидаемый результат: `status=staging_schema_ready`, `employees=0`, `tasks=0`, `queued_notifications=0`.

Это один транзакционный запуск: синтетическая структура прежнего реестра, обе canonical миграции, проверки принятия задачи, запрета чужих назначений, приватности документа, отзыва доступа, серверных/клиентских разрешений и private bucket policy. Пробные записи откатываются до commit структуры; реальных сотрудников в скрипте нет. Секреты и действительные Telegram данные не требуются. Скрипт **не** тестирует настоящий Edge Runtime, Storage upload или Telegram delivery.

Скрипт отказывается запускаться поверх существующей `public.employees` или схемы `dvfm`. Это защита от повторного применения и от запуска в известном рабочем проекте, но не автоматическое определение project ref: обязательно сверить адрес SQL Editor. Миграционные версии записываются в `supabase_migrations.schema_migrations`, чтобы дальнейший CLI `db push` не пытался повторить их. Canonical SQL хранится в `supabase/migrations/`.

После успешного результата не запускать setup повторно. При ошибке прислать текст ошибки без секретов и не обходить проверки удалением таблиц. При успехе следующим этапом развёртываются Edge Functions и настраиваются Secrets для **отдельного staging-бота**, затем проверяются настоящий Storage и Telegram. Рабочий bot token и webhook на этот проект не переключать.

## Воспроизведение сборки

```sh
node scripts/build-staging.mjs
node tests/staging-setup.test.js
node scripts/build-staging.mjs --check
```

`docs/staging-setup.sql` — сгенерированный файл. Обновлять исходники и `scripts/staging-smoke.sql`, затем пересобирать. Проверка согласованности входит в `npm run check`. Локальные тесты выполняют полный SQL в PostgreSQL/WASM с тестовыми Storage objects/buckets; реальные Supabase системные таблицы проверяются первым запуском на staging.

## Подтверждённый первый запуск

13 ноября 2026 (московское время) владелец предоставил результат выполнения единого SQL в staging: `staging_schema_ready`, employees=0, tasks=0, queued_notifications=0. Создание схемы и встроенные SQL-проверки завершились успешно; синтетические записи не остались. Это не подтверждает Edge Runtime, загрузку файлов через Storage API или Telegram delivery.

## Функции без терминала

Для Dashboard подготовлены standalone файлы в `deploy/dashboard/`. В Edge Functions → Deploy a new function → Via Editor создать функцию с точным именем и заменить весь index.ts содержимым соответствующего файла. Для каждой выключить gateway Verify JWT: обработчик сам проверяет Telegram initData или webhook secret. Использовать только staging wepogbvijpvyvyfzxzeo. Исходный CLI-вариант с `_shared` остаётся canonical, standalone файлы генерируются из него и отдельно проходят handler-тесты.

Перед функциональной проверкой создать отдельного тестового бота через официальный @BotFather командой /newbot. Его токен сохранить **только** в staging Supabase → Edge Functions → Secrets как TELEGRAM_BOT_TOKEN. Не присылать токен в чат и не добавлять в GitHub. SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY предоставляет runtime Supabase. Позже потребуются TELEGRAM_WEBHOOK_SECRET, TELEGRAM_MINI_APP_URL и OUTBOX_WORKER_AUTH; их назначение описано в DEPLOY.md. Для первого этапа используется прежний разрешённый origin https://juriyvk.github.io, либо явно настроенный ALLOWED_ORIGINS.

## Проверка развёрнутой telegram-auth

13 ноября 2026 (московское время) выполнены внешние запросы к staging `telegram-auth` без действительных Telegram credentials и без изменения данных:

| Запрос | Ответ |
| --- | --- |
| Пустой JSON | 400, initData required |
| Заведомо некорректный initData | 401, Invalid signature |
| JSON null | 400, Invalid JSON object |
| Origin вне списка | 403, Origin forbidden |
| OPTIONS от https://juriyvk.github.io | 204, корректный Access-Control-Allow-Origin и content-type в разрешённых заголовках |
| GET | 405, POST required |

Ответы относятся к приложению, а не отказу gateway JWT: canonical обработчик исполняется. Наличие TELEGRAM_BOT_TOKEN достаточно для достижения проверки подписи, но совпадение токена с @DVFMTESTCRM_bot и успешная авторизация по действительной подписи этим не проверены. Для этого требуется отдельная приёмка через Telegram Mini App. Не сохранять действительный initData в GitHub или переписке.

## Проверка развёрнутых crm и telegram-webhook

13 ноября 2026 (московское время) проверены staging endpoints без действительных credentials и без изменения данных:

| Запрос | Ответ |
| --- | --- |
| crm, пустой JSON | 401, Invalid Telegram data |
| crm, некорректный initData | 401, Invalid signature |
| crm, origin вне списка | 403, Origin forbidden |
| crm, OPTIONS от https://juriyvk.github.io | 204 с ожидаемым Access-Control-Allow-Origin |
| telegram-webhook без secret | 401, Unauthorized |
| telegram-webhook с заведомо неверным secret | 503, Server configuration missing |
| worker=1 без Authorization | 401, Unauthorized |
| worker=1 с заведомо неверным Authorization | 503, Server configuration missing |

Последние ответы показывают, что TELEGRAM_WEBHOOK_SECRET и OUTBOX_WORKER_AUTH ещё не настроены в staging. Функции исполняются и не дают неавторизованный доступ; действительные webhook/worker операции ещё не проверены. Следующий шаг: сохранить два независимых случайных секрета в Supabase Secrets. TELEGRAM_WEBHOOK_SECRET — 48–64 символа из латиницы/цифр (также Telegram разрешает _ и -); OUTBOX_WORKER_AUTH — строка Bearer, пробел и другая случайная строка. Значения не передавать в чат или GitHub. TELEGRAM_MINI_APP_URL будет настроен после подготовки отдельного HTTPS-адреса тестового Mini App.

## Настройка webhook без передачи токена бота

После заполнения Secrets повторные запросы с заведомо неверными значениями к webhook/worker вернули 401 Unauthorized вместо 503. Действительные секреты при этих проверках не использовались и нигде в репозитории не сохраняются.

Для Dashboard подготовлен временный helper `staging-telegram-setup` (canonical: supabase/functions/staging-telegram-setup/index.ts; standalone: deploy/dashboard/staging-telegram-setup.ts). Развернуть в тестовом проекте с Verify JWT disabled. Он сам проверяет Authorization на полное значение OUTBOX_WORKER_AUTH; до проверки сеть не вызывается. Helper жёстко ограничен staging wepogbvijpvyvyfzxzeo и ботом DVFMTESTCRM_bot: production-проект и другой bot token дают отказ до изменения Telegram.

В Dashboard → функция → Test выполнить POST с заголовком Authorization, равным полному OUTBOX_WORKER_AUTH из своего менеджера паролей. Не включать секрет в URL или тело запроса. Тело для чтения: `{"action":"inspect"}`; тело для настройки: `{"action":"configure"}`. Configure получает bot token/webhook secret из Secrets, проверяет getMe, отказывается перезаписывать webhook с другим URL, вызывает setWebhook только для фиксированного staging endpoint и сохраняет pending updates (drop_pending_updates=false). Ответ содержит только username, URL, флаг configured и число pending updates, без секретов.

Ожидаемый результат configure: ok=true, bot=DVFMTESTCRM_bot, configured=true, webhook_url=https://wepogbvijpvyvyfzxzeo.supabase.co/functions/v1/telegram-webhook. После завершения настройки helper можно удалить из развёрнутых Edge Functions. Worker secret в production не даёт административных прав через этот helper: проверка project URL запрещает работу вне указанного staging. Helper не принимает URL назначения или username от клиента.

Подключённый webhook ещё не означает успешную обработку личных сообщений: реестр staging сейчас пуст. Проверка зарегистрированного actor, документов, Mini App и доставки уведомлений остаётся отдельным этапом. Существующий рабочий бот и production endpoint не меняются.
