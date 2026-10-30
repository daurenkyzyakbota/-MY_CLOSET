import { cloudConfigured, currentCloudUser, getAuthServer } from '@/lib/cloud/auth-server.js';
import { database } from '@/lib/cloud/cloud-database.js';
import { socialService } from '@/lib/social/database.js';
import { boundedJson, sameOrigin } from '@/lib/social/handlers.js';
import { deleteManagedAccount } from '@/lib/social/auth-admin.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
const reply = (body, status = 200) => Response.json(body, { status, headers });

export async function POST(request) {
  let user;
  try {
    if (!cloudConfigured()) return reply({ error: 'Аккаунты пока не подключены.' }, 503);
    if (process.env.MYCLOSET_ACCOUNT_DELETION_ENABLED !== 'true')
      return reply(
        {
          error:
            'Удаление учётной записи ожидает подключения разрешённого способа управления аккаунтами.',
          code: 'DELETION_NOT_CONFIGURED',
        },
        503,
      );
    if (!sameOrigin(request)) return reply({ error: 'Откройте форму удаления на сайте.' }, 403);
    user = await currentCloudUser({ fresh: true });
    if (!user) return reply({ error: 'Сначала войдите в аккаунт.' }, 401);
    if (request.headers.get('x-mycloset-account') !== user.id)
      return reply(
        { error: 'Аккаунт изменился. Обновите страницу.', code: 'ACCOUNT_CHANGED' },
        409,
      );
    const input = await boundedJson(request, 4096);
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['confirmation', 'password'].includes(key)) ||
      input.confirmation !== 'УДАЛИТЬ' ||
      typeof input.password !== 'string' ||
      input.password.length < 8 ||
      input.password.length > 128
    )
      return reply({ error: 'Введите пароль и слово УДАЛИТЬ.' }, 400);
    // The marker's FK and public trigger atomically remove cloud data when the
    // managed identity is actually deleted, including email-confirmed deletion.
    await database().query(
      'INSERT INTO public.mycloset_account_deletions(auth_user_id,user_id) VALUES($1::uuid,$2::text) ON CONFLICT(auth_user_id) DO NOTHING',
      [user.id, user.id],
    );
    const managedAdministrator =
      !!process.env.MYCLOSET_AUTH_ADMIN_EMAIL && !!process.env.MYCLOSET_AUTH_ADMIN_PASSWORD;
    const result = managedAdministrator
      ? await deleteManagedAccount({
          user,
          password: input.password,
          origin: request.headers.get('origin'),
        })
      : await getAuthServer().deleteUser({ password: input.password });
    if (result.error) {
      await database().query('DELETE FROM public.mycloset_account_deletions WHERE user_id=$1', [
        user.id,
      ]);
      return reply(
        {
          error:
            result.error.code === 'INVALID_PASSWORD'
              ? 'Пароль не подошёл.'
              : 'Сервис входа не подтвердил удаление. Проверьте пароль и повторите попытку.',
          code: result.error.code || 'DELETE_FAILED',
        },
        400,
      );
    }
    const remaining = await currentCloudUser({ fresh: true });
    if (remaining?.id === user.id) return reply({ pendingConfirmation: true });
    await socialService.execute('account.delete', {}, user);
    await getAuthServer().signOut();
    return reply({ deleted: true });
  } catch (error) {
    if ([400, 401, 403, 409, 429].includes(error.status))
      return reply({ error: error.message, code: error.code || 'DELETE_FAILED' }, error.status);
    console.error('MyCloset account deletion:', error.code || 'DELETE_UNAVAILABLE');
    return reply(
      {
        error:
          'Не удалось завершить запрос удаления. Обновите страницу, чтобы проверить состояние аккаунта.',
        code: 'DELETE_UNAVAILABLE',
      },
      error.status === 413 ? 413 : 503,
    );
  }
}
