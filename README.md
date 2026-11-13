# СЕРВИС | ДВФМ

Существующий Telegram Mini App с CRM на Supabase. Фирменный интерфейс в `index.html`, клиент в `app.js`, приватные таблицы и серверные проверки в `supabase/`.

- [Развёртывание, перенос авторизации и откат](docs/DEPLOY.md)
- [Права и архитектура](docs/ARCHITECTURE.md)
- [Первый запуск тестового Supabase](docs/STAGING.md)
- [Ручная приёмка staging](docs/ACCEPTANCE.md)

```sh
npm ci
npm test
npm run check
npm run check:edge
npm run test:browser
```

Для browser test установить Chromium и указать `CHROMIUM_PATH`, если он не в `/usr/bin/chromium`. Тесты используют только синтетические записи. Перед production обязательна staging-приёмка Supabase/Telegram. Добавление сотрудников через UI — последний, отложенный этап.
