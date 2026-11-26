# Недоступность Supabase при повторной проверке

Страница https://juriyvk.github.io/service/ и отдельная /staging/ отвечают HTTP 200. Опубликованный staging app.js совпадает с проверенной сборкой.

Имена wepogbvijpvyvyfzxzeo.supabase.co и mskbgkiksgpdosiarjvo.supabase.co получили DNS status=3 (NXDOMAIN) независимо у Google Public DNS и Cloudflare DNS. Контрольный supabase.com разрешается. Попытки обратиться к API из текущей среды дополнительно получили отказ CONNECT-прокси, а не HTTP-ответ приложения. Это не прежний ответ 400 worker: прикладной запрос не был выполнен.

DNS не позволяет отличить приостановку от удаления или смены ref. Владелец должен проверить статус в Dashboard:

- staging: https://supabase.com/dashboard/project/wepogbvijpvyvyfzxzeo
- прежний рабочий проект: https://supabase.com/dashboard/project/mskbgkiksgpdosiarjvo

Если статус Paused — Resume project. Не создавать проект заново, не сбрасывать таблицы и не повторять staging-setup. При другом Project URL сначала сверить адрес. При удалении проверить доступные владельцу резервные копии, не обещать автоматическое восстановление.

Официальные пояснения: https://supabase.com/kb/troubleshooting/nxdomain-error-connecting-to-a-supabase-project и https://supabase.com/docs/guides/platform/free-project-pausing . Приостановка — возможная причина, не подтверждённый статус аккаунта.

Supabase management credential в среде отсутствует; подключённого инструмента управления Supabase нет. Статус и Resume агент не может выполнить через имеющиеся подключения. База, Secrets, webhook и YouGile в ходе проверки не изменялись. Все 56 тестов исходной версии прошли, но это не подтверждает доступность живого сервиса. После восстановления повторить configure_worker и использовать точный SQL-код оставшейся ошибки, если она сохранится.
