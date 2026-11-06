# Планировщик уведомлений

Отдельная Neon Function `notificationscron`, среда `nodejs24`. Основные зависимости
сайта не меняются. Установлены точные версии `@neon/functions` 0.11.0 и esbuild 0.28.2.

Из корня репозитория:

```powershell
npm --prefix functions/notifications-cron ci --ignore-scripts
npm --prefix functions/notifications-cron test
node scripts/package-notification-cron.mjs --outdir C:/path/to/work/notification-cron-package
```

Упаковщик создаёт воспроизводимые `index.mjs`, `notificationscron.zip`,
`notificationscron.zip.base64` и `manifest.json`. ZIP содержит только `index.mjs`,
включая код официального parser и его лицензию. Секреты читаются при вызове функции,
не при сборке. Для native deploy параметр `zip` получает содержимое файла `.base64`.

Серверные переменные окружения функции:

- `MYCLOSET_NOTIFICATION_DISPATCH_URL`: точный HTTPS URL сайта с путём
  `/api/notifications/dispatch`, без query, fragment и credentials.
- `MYCLOSET_NOTIFICATION_CRON_SECRET`: тот же серверный секрет, что у dispatch
  сайта, не короче 32 символов.

После упаковки создайте функцию с slug `notificationscron` в нужной ветке Neon
и разверните ZIP в runtime `nodejs24`, передав две переменные выше. Подождите
успешного завершения deployment; QA и production используют свои ветки и адреса.
В native `deploy_function` поле `environment` — строка JSON с отображением
имён переменных в строки, поле `zip` — base64 содержимого ZIP. Не помещайте
серверный секрет в исходники или manifest и не выводите его в журнал.

Контракт native schedule-trigger:

```json
{
  "type": "schedule",
  "name": "mycloset-notifications-every-5-minutes",
  "function_slug": "notificationscron",
  "function_path": "/cron",
  "schedule": { "cron": "*/5 * * * *" },
  "enabled": true
}
```

Cron интерпретируется в UTC, а час и часовой пояс напоминания пользователя
применяются внутри сайта. Для native `create_trigger` этот объект передаётся
в `body` вместе с `project_id` и ID нужной ветки `branch_id` (`br-...`).
Сначала проверьте существующие триггеры и обновляйте имеющийся вместо создания
дубликата. Создание и включение триггера выполняются отдельно от упаковки
и deployment функции; готовый ZIP сам по себе расписание не запускает.

Маршрут принимает только `POST /cron` и schedule-envelope, проверенный официальным
`parseTriggerDelivery`. JSON ограничен 64 КиБ, включая историю повторных попыток.
Проверка происхождения зависит от native Neon Functions proxy: он удаляет публичные
`x-neon-*` заголовки. Локальный сервер для разработки позволяет их имитировать и
не является самостоятельной защищённой точкой публикации.

Функция отправляет пустой POST на настроенный dispatch URL с серверным Bearer,
без пользовательских cookies/JWT. Перенаправления запрещены, timeout — 15 секунд.
Успех возвращается только после downstream `2xx`. Остальные статусы и ошибки дают
общий `503` с `Retry-After: 60`; downstream body и секреты не выводятся. Повторные
доставки допустимы: идемпотентность уведомлений обеспечивает outbox сайта.

Документация: [Function Triggers](https://neon.com/docs/compute/functions/triggers/overview),
[Deploy](https://neon.com/docs/compute/functions/deploy).
