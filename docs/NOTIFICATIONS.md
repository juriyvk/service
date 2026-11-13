# Уведомления и deep links в staging

Проект wepogbvijpvyvyfzxzeo, бот @DVFMTESTCRM_bot. Только тестовая среда; рабочий бот и production не являются целью.

## 1. Main Mini App

В официальном @BotFather: /mybots → DVFMTESTCRM_bot → Bot Settings → Configure Mini App → Enable Mini App. Указать https://juriyvk.github.io/service/staging/ . Кнопка меню, настроенная через /setmenubutton, не заменяет Main Mini App.

Это соответствует официальной документации Telegram: https://core.telegram.org/bots/webapps#launching-the-main-mini-app . После включения Main Mini App проверить открытие https://t.me/DVFMTESTCRM_bot?startapp . Параметр startapp передаётся в подписанный start_param; ссылка на задачу будет https://t.me/DVFMTESTCRM_bot?startapp=task_UUID. UUID выбирает карточку, не даёт права читать её.

В Secrets тестового Supabase добавить TELEGRAM_MINI_APP_URL со значением https://t.me/DVFMTESTCRM_bot . Это публичный адрес, не секретный ключ. Для named Mini App допустим выданный BotFather https://t.me/DVFMTESTCRM_bot/<name>.

## 2. Установка scheduler

В SQL Editor **этого staging** выполнить docs/staging-install-worker.sql. В файле нет значений секретов. Он устанавливает pg_cron/pg_net/Vault при необходимости и создаёт RPC только для service_role. Ожидается staging_worker_configurator_ready. Сам cron job пока не создан.

Обновить существующий staging-telegram-setup кодом deploy/dashboard/staging-telegram-setup.ts, оставить Verify JWT выключенным. В Test → POST использовать Authorization, равный полному OUTBOX_WORKER_AUTH из частного хранилища. Body: {"action":"configure_worker"}.

Helper проверяет project URL, username тестового бота и URL Mini App. Для main-ссылки дополнительно требует has_main_web_app=true в Telegram getMe. Затем передаёт worker Authorization внутреннему RPC фиксированного staging. RPC проверяет отсутствие клиентских SELECT-прав на vault.decrypted_secrets, сохраняет значение через Vault и создаёт job dvfm-staging-notifications раз в минуту. Текст cron содержит только SELECT из Vault, а не значение секрета. В ответе секретов нет. Реальные ключи не сохраняются в GitHub, миграциях или тестах.

Повторный configure_worker обновляет Vault и тот же cron job, не создаёт дублей. При смене OUTBOX_WORKER_AUTH в Supabase Secrets вызвать configure_worker ещё раз для обновления Vault. Имя Vault secret: dvfm_staging_worker_auth. Настройка сериализуется транзакционной advisory-блокировкой.

Ожидается ok=true, worker.configured=true, job_name=dvfm-staging-notifications, schedule=* * * * *, auth_storage=vault. Через 1–2 минуты выполнить read-only docs/staging-worker-status.sql: cron active=true, появились запуски. Статус успешного cron SQL означает постановку HTTP-запроса в pg_net; фактическая доставка определяется outbox.sent_at и сообщением в Telegram.

## 3. Приёмка

- В тестовом боте отправить /task self | Проверка уведомлений. Должны появиться задача в Mini App и сообщение с кнопкой «Открыть задачу».
- Нажать кнопку: открывается именно эта карточка. Проверить также чужой UUID (отказ), закрытие и повторное открытие Mini App.
- Отправить боту docs/fixtures/crm-check.txt как документ: бот подтверждает сохранение, файл появляется в личной библиотеке.
- Проверить queue и exhausted. Лимит повторов 10 и интервалы описаны в DEPLOY.md. При временной недоступности Telegram очередь должна дождаться следующего worker, а не нового сообщения боту.

Эти реальные проверки ещё не подтверждены владельцем. SQL-конфигуратор локально проверяется в PostgreSQL/WASM со stub Vault/Cron; установку расширений и реальные HTTP-вызовы подтверждает staging.

## Отключение

SQL Editor: select cron.unschedule('dvfm-staging-notifications'); . Это останавливает будущие вызовы worker и не удаляет очередь. Секрет можно сохранить для отката или удалить через Vault после проверки отсутствия других использований. Не удалять задачи и документы для отключения расписания. Временный staging-telegram-setup можно удалить после настройки; cron работает самостоятельно.
