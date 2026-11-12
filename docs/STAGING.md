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
