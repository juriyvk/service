# Проверка перед тестовым развёртыванием

Дата: 2026-11-12 UTC. Ветка: `feat/secure-crm-core`, PR #1.

Проверен существующий публичный адрес Supabase, указанный в исходном Mini App. Запросы не содержали действительных Telegram credentials, ключей Supabase, персональных данных или webhook secret; база и конфигурация не менялись. Тела ответов с данными пользователей не сохранялись.

| Запрос | Результат |
| --- | --- |
| POST telegram-auth, пустой JSON | HTTP 400 |
| POST telegram-auth, заведомо некорректный initData | HTTP 401 |
| POST crm, snapshot без initData | HTTP 404 NOT_FOUND |
| POST telegram-webhook без secret | HTTP 404 NOT_FOUND |

Текущая функция входа отклоняет проверенные некорректные запросы. Это не подтверждает реализацию HMAC, срока действия, реестра сотрудников или модель ролей: для этого нужны действующий исходник и staging-проверки. Новые endpoints пока не развёрнуты; их 404 не является проверкой нового контроля доступа.

Проверки GitHub Actions в PR прошли: 27 тестов, TypeScript, Deno и браузерный сценарий. Они не заменяют живой Supabase/Telegram.

## Что требуется для следующего шага

1. Исходник telegram-auth получен от владельца и изучен: проверяет HMAC и public.employees.is_active; подготовлена совместимость с существующим реестром. Следующее: подтвердить DDL и политики public.employees read-only запросом docs/inspect-existing-auth.sql. Точное соответствие предоставленного кода живому deploy и реальные policies ещё не проверены. Не заменять функцию до staging-приёмки.
2. Определить отдельный staging-проект и staging-бота. Сейчас в среде нет Supabase management credential, project ref staging или Telegram secrets; инструмент управления Supabase также не подключён. Одного GitHub-доступа недостаточно для deploy.
3. Настроить доступ через защищённые настройки окружения, не через Git или переписку. Затем выполнить план из DEPLOY.md: миграция, проверенный реестр, Edge Functions, private Storage, scheduler и реальные проверки Telegram.

Рабочий бот, webhook, база и main остаются без изменений. PR остаётся черновиком.
