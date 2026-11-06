import { createHash, randomUUID } from 'node:crypto';
import { consumeWriteQuota } from './quotas.js';
import {
  SocialError,
  PAGE_SIZE,
  PUBLIC_ACTIONS,
  READ_ACTIONS,
  object,
  text,
  id,
  boolean,
  choice,
  username,
  profilePatch,
  postInput,
  feedFilters,
  messageSearch,
  idempotencyKey,
  encodeCursor,
  decodeCursor,
} from './validation.js';

const iso = (value) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const missing = () => new SocialError('Запись не найдена или больше недоступна.', 404, 'NOT_FOUND');
const forbidden = () => new SocialError('Это действие недоступно.', 403, 'FORBIDDEN');
const pair = (a, b) => [a, b].sort();
const cursorTime = (column) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const friend = (a, b) =>
  `EXISTS (SELECT 1 FROM public.mycloset_relationships r WHERE r.user_a=LEAST(${a},${b}) AND r.user_b=GREATEST(${a},${b}) AND r.status='accepted')`;
const blocked = (a, b) =>
  `EXISTS (SELECT 1 FROM public.mycloset_blocks b WHERE (b.blocker_id=${a} AND b.target_id=${b}) OR (b.blocker_id=${b} AND b.target_id=${a}))`;
const visiblePost = (viewer = '$1', post = 's', author = 'p') => `(
  NOT ${blocked(viewer, `${post}.user_id`)} AND (
    ${post}.user_id=${viewer} OR (
      (${post}.visibility='public' OR (${post}.visibility='friends' AND ${friend(viewer, `${post}.user_id`)}))
      AND (NOT ${author}.private OR ${friend(viewer, `${post}.user_id`)})
    )
  )
)`;
const profileProjection = `p.user_id,p.username,p.name,p.bio,p.city,p.styles,p.private,
  p.allow_messages,p.notifications,p.created_at,(p.avatar<>'') AS has_avatar,
  (SELECT count(*) FROM public.mycloset_relationships r WHERE r.status='accepted' AND (r.user_a=p.user_id OR r.user_b=p.user_id)) AS friend_count,
  (SELECT count(*) FROM public.mycloset_posts s WHERE s.user_id=p.user_id AND ${visiblePost()}) AS post_count,
  ${friend('$1', 'p.user_id')} AS is_friend,
  EXISTS(SELECT 1 FROM public.mycloset_blocks b WHERE b.blocker_id=$1 AND b.target_id=p.user_id) AS blocked_me,
  EXISTS(SELECT 1 FROM public.mycloset_blocks b WHERE b.blocker_id=p.user_id AND b.target_id=$1) AS blocked_other,
  (SELECT r.requester_id FROM public.mycloset_relationships r WHERE r.user_a=LEAST($1,p.user_id) AND r.user_b=GREATEST($1,p.user_id) AND r.status='pending') AS requester_id`;

// Photos remain in the database and are read separately through permission-checked media routes.
const postProjection = `s.id,s.user_id,s.title,s.description,s.tags,s.visibility,s.created_at,s.updated_at,${cursorTime('s.created_at')} AS cursor_at,
  jsonb_set(s.snapshot,'{items}',COALESCE((
    SELECT jsonb_agg((item-'photo') || jsonb_build_object('hasPhoto',COALESCE(item->>'photo','')<>''))
    FROM jsonb_array_elements(s.snapshot->'items') item
  ),'[]'::jsonb)) AS snapshot,
  (SELECT count(*) FROM public.mycloset_likes l WHERE l.post_id=s.id) AS likes_count,
  (SELECT count(*) FROM public.mycloset_comments c WHERE c.post_id=s.id) AS comments_count,
  EXISTS(SELECT 1 FROM public.mycloset_likes l WHERE l.post_id=s.id AND l.user_id=$1) AS liked,
  EXISTS(SELECT 1 FROM public.mycloset_saved_posts v WHERE v.post_id=s.id AND v.user_id=$1) AS saved`;

const notificationText = {
  friend_request: 'Хочет добавить вас в друзья',
  friend_accepted: 'Принял(а) вашу заявку в друзья',
  message: 'Отправил(а) сообщение',
  like: 'Оценил(а) ваш образ',
  comment: 'Оставил(а) комментарий к образу',
};

class SocialSession {
  constructor(db, user) {
    this.db = db;
    this.user = user;
    this.viewer = user?.id || '';
    this.profiles = new Map();
  }

  async rows(sql, values = []) {
    return (await this.db.query(sql, values)).rows;
  }

  async activeProfile() {
    if (!this.viewer) throw new SocialError('Войдите в аккаунт.', 401, 'AUTH_REQUIRED');
    const profile = await this.getProfile(this.viewer);
    if (!profile) throw new SocialError('Сначала создайте свой профиль.', 409, 'PROFILE_REQUIRED');
    return profile;
  }

  profileDto(row) {
    const own = row.user_id === this.viewer;
    const hidden = !!(row.blocked_me || row.blocked_other);
    const canViewPosts = !hidden && (own || !row.private || !!row.is_friend);
    let relationship = 'none';
    if (own) relationship = 'self';
    else if (hidden) relationship = 'blocked';
    else if (row.is_friend) relationship = 'friends';
    else if (row.requester_id)
      relationship = row.requester_id === this.viewer ? 'outgoing' : 'incoming';
    return {
      id: row.user_id,
      username: row.username,
      name: row.name,
      bio: canViewPosts ? row.bio : '',
      city: canViewPosts ? row.city : '',
      styles: canViewPosts ? row.styles : '',
      avatar:
        row.has_avatar && !hidden
          ? `/api/social/media?type=avatar&id=${encodeURIComponent(row.user_id)}`
          : '',
      private: row.private,
      allowMessages: row.allow_messages,
      notifications: own ? row.notifications : {},
      friendCount: Number(row.friend_count),
      postCount: Number(row.post_count),
      relationship,
      blockedByMe: !!row.blocked_me,
      canViewPosts,
      createdAt: iso(row.created_at),
    };
  }

  async getProfile(userId, allowBlocked = false) {
    const key = `${userId}:${allowBlocked}`;
    if (this.profiles.has(key)) return this.profiles.get(key);
    const [row] = await this.rows(
      `SELECT ${profileProjection} FROM public.mycloset_profiles p WHERE p.user_id=$2`,
      [this.viewer, userId],
    );
    const result =
      !row || (!allowBlocked && (row.blocked_me || row.blocked_other))
        ? null
        : this.profileDto(row);
    this.profiles.set(key, result);
    return result;
  }

  async requireTarget(userId) {
    const target = await this.getProfile(userId);
    if (!target) throw missing();
    return target;
  }

  async notify(recipientId, kind, { postId = null, conversationId = null, messageId = null } = {}) {
    if (recipientId === this.viewer) return;
    const setting =
      kind === 'like'
        ? 'likes'
        : kind === 'comment'
          ? 'comments'
          : kind === 'message'
            ? 'messages'
            : 'friends';
    await this.db.query(
      `
      INSERT INTO public.mycloset_notifications(id,recipient_id,actor_id,kind,post_id,conversation_id,created_at)
      SELECT $1,p.user_id,$2,$3,$4,$5,COALESCE((SELECT created_at FROM public.mycloset_messages WHERE id=$8),clock_timestamp()) FROM public.mycloset_profiles p
      WHERE p.user_id=$6 AND COALESCE((p.notifications->>$7)::boolean,true)
        AND NOT ${blocked('$2', 'p.user_id')}
    `,
      [randomUUID(), this.viewer, kind, postId, conversationId, recipientId, setting, messageId],
    );
  }

  async postDto(row) {
    const author = await this.getProfile(row.user_id);
    if (!author) throw missing();
    return {
      id: row.id,
      author,
      title: row.title,
      description: row.description,
      tags: row.tags,
      visibility: row.visibility,
      snapshot: {
        ...row.snapshot,
        items: row.snapshot.items.map(({ hasPhoto, ...item }) => ({
          ...item,
          photo: hasPhoto
            ? `/api/social/media?type=post&id=${encodeURIComponent(row.id)}&item=${encodeURIComponent(item.id)}`
            : '',
        })),
      },
      likesCount: Number(row.likes_count),
      commentsCount: Number(row.comments_count),
      liked: !!row.liked,
      saved: !!row.saved,
      owned: row.user_id === this.viewer,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  }

  async getPost(postId, viewer = this.viewer) {
    const [row] = await this.rows(
      `SELECT ${postProjection} FROM public.mycloset_posts s JOIN public.mycloset_profiles p ON p.user_id=s.user_id WHERE s.id=$2 AND ${visiblePost()}`,
      [viewer, postId],
    );
    if (!row) throw missing();
    if (viewer !== this.viewer) return row;
    return this.postDto(row);
  }

  async bootstrap(input) {
    object(input, []);
    const profile = await this.getProfile(this.viewer);
    if (!profile) return { profile: null, counts: { messages: 0, notifications: 0, requests: 0 } };
    const [counts] = await this.rows(
      `SELECT
      (SELECT count(*) FROM public.mycloset_messages m JOIN public.mycloset_conversations c ON c.id=m.conversation_id
        WHERE (c.user_a=$1 OR c.user_b=$1) AND m.sender_id<>$1
          AND m.created_at>CASE WHEN c.user_a=$1 THEN c.read_a_at ELSE c.read_b_at END
          AND NOT ${blocked('$1', 'm.sender_id')}) AS messages,
      (SELECT count(*) FROM public.mycloset_notifications n WHERE n.recipient_id=$1 AND n.read_at IS NULL
        AND NOT ${blocked('$1', 'n.actor_id')}) AS notifications,
      (SELECT count(*) FROM public.mycloset_relationships r WHERE (r.user_a=$1 OR r.user_b=$1)
        AND r.status='pending' AND r.requester_id<>$1) AS requests`,
      [this.viewer],
    );
    return {
      profile,
      counts: {
        messages: Number(counts.messages),
        notifications: Number(counts.notifications),
        requests: Number(counts.requests),
      },
    };
  }

  async saveProfile(input) {
    const patch = profilePatch(input);
    const [existing] = await this.rows('SELECT * FROM public.mycloset_profiles WHERE user_id=$1', [
      this.viewer,
    ]);
    if (!existing && (!patch.username || !patch.name))
      throw new SocialError('Укажите имя и уникальный ник профиля.');
    const values = {
      username: existing?.username,
      name: existing?.name,
      bio: existing?.bio || '',
      city: existing?.city || '',
      styles: existing?.styles || '',
      avatar: existing?.avatar || '',
      private: existing?.private || false,
      allowMessages: existing?.allow_messages || 'friends',
      ...patch,
      notifications: {
        likes: true,
        comments: true,
        friends: true,
        messages: true,
        ...existing?.notifications,
        ...patch.notifications,
      },
    };
    await this.db.query(
      `INSERT INTO public.mycloset_profiles(user_id,username,name,bio,city,styles,avatar,private,allow_messages,notifications,auth_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::uuid)
      ON CONFLICT(user_id) DO UPDATE SET username=EXCLUDED.username,name=EXCLUDED.name,bio=EXCLUDED.bio,
        city=EXCLUDED.city,styles=EXCLUDED.styles,avatar=EXCLUDED.avatar,private=EXCLUDED.private,
        allow_messages=EXCLUDED.allow_messages,notifications=EXCLUDED.notifications,updated_at=now()`,
      [
        this.viewer,
        values.username,
        values.name,
        values.bio,
        values.city,
        values.styles,
        values.avatar,
        values.private,
        values.allowMessages,
        JSON.stringify(values.notifications),
        this.viewer,
      ],
    );
    this.profiles.clear();
    return { profile: await this.getProfile(this.viewer) };
  }

  async profileByUsername(input) {
    object(input, ['username']);
    const [row] = await this.rows(
      `SELECT ${profileProjection} FROM public.mycloset_profiles p WHERE p.username=$2`,
      [this.viewer, username(input.username)],
    );
    if (!row || row.blocked_me || row.blocked_other) throw missing();
    return { profile: this.profileDto(row) };
  }

  async searchPeople(input) {
    object(input, ['query', 'cursor']);
    const query = text(input.query || '', 'Поиск', 80).replace(/^@/, '');
    const cursor = decodeCursor(input.cursor, 'people');
    const rows = await this.rows(
      `SELECT ${profileProjection} FROM public.mycloset_profiles p
      WHERE NOT ${blocked('$1', 'p.user_id')} AND ($2='' OR position(lower($2) in lower(p.username))>0 OR position(lower($2) in lower(p.name))>0)
      AND ($3::text IS NULL OR (p.username,p.user_id)>($3,$4))
      ORDER BY p.username,p.user_id LIMIT $5`,
      [this.viewer, query, cursor?.username || null, cursor?.id || '', PAGE_SIZE + 1],
    );
    const more = rows.length > PAGE_SIZE;
    const people = rows.slice(0, PAGE_SIZE).map((row) => this.profileDto(row));
    const last = people.at(-1);
    return {
      people,
      nextCursor: more ? encodeCursor('people', { username: last.username, id: last.id }) : null,
    };
  }

  async listPosts(input) {
    object(input, ['scope', 'username', 'cursor', 'query', 'tag', 'style', 'occasion']);
    const filters = feedFilters(input);
    const scope = choice(
      input.scope || 'public',
      ['public', 'friends', 'saved', 'profile'],
      'Лента',
    );
    if (['friends', 'saved'].includes(scope)) await this.activeProfile();
    let target = null;
    if (scope === 'profile') {
      const result = await this.profileByUsername({ username: input.username });
      if (!result.profile.canViewPosts) return { posts: [], nextCursor: null };
      target = result.profile.id;
    }
    const baseKind = `posts:${scope}:${target || ''}`;
    const cursorKind = Object.values(filters).some(Boolean)
      ? `${baseKind}:filters:${createHash('sha256').update(JSON.stringify(filters)).digest('hex')}`
      : baseKind;
    const cursor = decodeCursor(input.cursor, cursorKind);
    const scopeSql = {
      public: "s.visibility='public'",
      friends: `${friend('$1', 's.user_id')}`,
      saved:
        'EXISTS(SELECT 1 FROM public.mycloset_saved_posts v WHERE v.user_id=$1 AND v.post_id=s.id)',
      profile: 'true',
    }[scope];
    const rows = await this.rows(
      `SELECT ${postProjection} FROM public.mycloset_posts s JOIN public.mycloset_profiles p ON p.user_id=s.user_id
      WHERE ${visiblePost()} AND (${scopeSql})
        AND ($2::timestamptz IS NULL OR (s.created_at,s.id)<($2,$3))
        AND ($5::text IS NULL OR s.user_id=$5)
        AND ($6::text='' OR position($6 in lower(concat_ws(' ',s.title,s.description,
          COALESCE((SELECT string_agg(t.value,' ') FROM jsonb_array_elements_text(s.tags) AS t(value)),''))))>0)
        AND ($7::text='' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(s.tags) AS t(value) WHERE lower(btrim(t.value))=$7))
        AND ($8::text='' OR lower(COALESCE(s.snapshot->>'occasion',''))=$8)
        AND ($9::text='' OR lower(COALESCE(s.snapshot->>'style',''))=$9)
      ORDER BY s.created_at DESC,s.id DESC LIMIT $4`,
      [
        this.viewer,
        cursor?.at || null,
        cursor?.id || '',
        PAGE_SIZE + 1,
        target,
        filters.query,
        filters.tag,
        filters.occasion,
        filters.style,
      ],
    );
    const more = rows.length > PAGE_SIZE;
    const posts = [];
    for (const row of rows.slice(0, PAGE_SIZE)) posts.push(await this.postDto(row));
    const last = rows.slice(0, PAGE_SIZE).at(-1);
    return {
      posts,
      nextCursor: more ? encodeCursor(cursorKind, { at: last.cursor_at, id: last.id }) : null,
    };
  }

  async savePost(input) {
    await this.activeProfile();
    const draft = postInput(input);
    if (draft.postId && draft.clientId)
      throw new SocialError('Ключ повторной отправки используется только для новой публикации.');
    const postId = draft.postId || randomUUID();
    if (draft.postId) {
      const previous = await this.getPost(postId);
      if (!previous.owned) throw forbidden();
      await this.db.query(
        `UPDATE public.mycloset_posts SET title=$3,description=$4,tags=$5::jsonb,visibility=$6,
        snapshot=COALESCE($7::jsonb,snapshot),updated_at=now() WHERE id=$1 AND user_id=$2`,
        [
          postId,
          this.viewer,
          draft.title,
          draft.description,
          JSON.stringify(draft.tags),
          draft.visibility,
          draft.snapshot ? JSON.stringify(draft.snapshot) : null,
        ],
      );
    } else {
      if (!draft.snapshot) throw new SocialError('Выберите образ для публикации.');
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            title: draft.title,
            description: draft.description,
            tags: draft.tags,
            visibility: draft.visibility,
            snapshot: draft.snapshot,
          }),
        )
        .digest('hex');
      if (draft.clientId) {
        const [existing] = await this.rows(
          'SELECT id,client_fingerprint FROM public.mycloset_posts WHERE user_id=$1 AND client_id=$2',
          [this.viewer, draft.clientId],
        );
        if (existing) {
          if (existing.client_fingerprint !== fingerprint)
            throw new SocialError(
              'Публикация с этим ключом уже отличается. Обновите ленту перед новой отправкой.',
              409,
              'POST_CHANGED',
            );
          return { post: await this.getPost(existing.id) };
        }
      }
      await consumeWriteQuota(this.db, this.viewer, 'posts');
      await this.db.query(
        `INSERT INTO public.mycloset_posts(id,user_id,title,description,tags,visibility,snapshot,client_id,client_fingerprint)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9)`,
        [
          postId,
          this.viewer,
          draft.title,
          draft.description,
          JSON.stringify(draft.tags),
          draft.visibility,
          JSON.stringify(draft.snapshot),
          draft.clientId || null,
          draft.clientId ? fingerprint : null,
        ],
      );
    }
    this.profiles.clear();
    return { post: await this.getPost(postId) };
  }

  async deletePost(input) {
    object(input, ['postId']);
    await this.activeProfile();
    const post = await this.getPost(id(input.postId));
    if (!post.owned) throw forbidden();
    await this.db.query('DELETE FROM public.mycloset_posts WHERE id=$1 AND user_id=$2', [
      post.id,
      this.viewer,
    ]);
    return { ok: true };
  }

  async setPostReaction(input, saved) {
    object(input, ['postId', saved ? 'saved' : 'liked']);
    await this.activeProfile();
    const postId = id(input.postId);
    const enabled = boolean(input[saved ? 'saved' : 'liked'], saved ? 'Сохранено' : 'Нравится');
    const post = await this.getPost(postId);
    const table = saved ? 'mycloset_saved_posts' : 'mycloset_likes';
    if (enabled) {
      const inserted = await this.rows(
        `INSERT INTO public.${table}(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id`,
        [postId, this.viewer],
      );
      if (!saved && inserted.length) await this.notify(post.author.id, 'like', { postId });
    } else {
      await this.db.query(`DELETE FROM public.${table} WHERE post_id=$1 AND user_id=$2`, [
        postId,
        this.viewer,
      ]);
      if (!saved)
        await this.db.query(
          "DELETE FROM public.mycloset_notifications WHERE actor_id=$1 AND post_id=$2 AND kind='like'",
          [this.viewer, postId],
        );
    }
    return { post: await this.getPost(postId) };
  }

  async commentDto(row, post) {
    const author = await this.getProfile(row.user_id);
    if (!author) return null;
    return {
      id: row.id,
      author,
      text: row.text,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      owned: row.user_id === this.viewer,
      canDelete: row.user_id === this.viewer || post.owned,
    };
  }

  async listComments(input) {
    object(input, ['postId', 'cursor']);
    const postId = id(input.postId);
    const post = await this.getPost(postId);
    const cursor = decodeCursor(input.cursor, `comments:${postId}`);
    const rows = await this.rows(
      `SELECT c.*,${cursorTime('c.created_at')} AS cursor_at FROM public.mycloset_comments c WHERE c.post_id=$2
      AND NOT ${blocked('$1', 'c.user_id')} AND ($3::timestamptz IS NULL OR (c.created_at,c.id)<($3,$4))
      ORDER BY c.created_at DESC,c.id DESC LIMIT 31`,
      [this.viewer, postId, cursor?.at || null, cursor?.id || ''],
    );
    const comments = [];
    for (const row of rows.slice(0, 30)) comments.push(await this.commentDto(row, post));
    const last = rows.slice(0, 30).at(-1);
    return {
      comments,
      nextCursor:
        rows.length > 30
          ? encodeCursor(`comments:${postId}`, { at: last.cursor_at, id: last.id })
          : null,
    };
  }

  async saveComment(input) {
    object(input, ['postId', 'commentId', 'text']);
    await this.activeProfile();
    const post = await this.getPost(id(input.postId));
    const value = text(input.text, 'Комментарий', 1000, { required: true });
    const commentId = input.commentId ? id(input.commentId) : randomUUID();
    let row;
    if (input.commentId) {
      [row] = await this.rows(
        'UPDATE public.mycloset_comments SET text=$4,updated_at=now() WHERE id=$1 AND post_id=$2 AND user_id=$3 RETURNING *',
        [commentId, post.id, this.viewer, value],
      );
      if (!row) throw missing();
    } else {
      await consumeWriteQuota(this.db, this.viewer, 'comments');
      [row] = await this.rows(
        'INSERT INTO public.mycloset_comments(id,post_id,user_id,text) VALUES($1,$2,$3,$4) RETURNING *',
        [commentId, post.id, this.viewer, value],
      );
      await this.notify(post.author.id, 'comment', { postId: post.id });
    }
    return { comment: await this.commentDto(row, post) };
  }

  async deleteComment(input) {
    object(input, ['commentId']);
    await this.activeProfile();
    const [row] = await this.rows('SELECT * FROM public.mycloset_comments WHERE id=$1', [
      id(input.commentId),
    ]);
    if (!row) throw missing();
    const post = await this.getPost(row.post_id);
    if (row.user_id !== this.viewer && !post.owned) throw forbidden();
    await this.db.query('DELETE FROM public.mycloset_comments WHERE id=$1', [row.id]);
    return { ok: true };
  }

  async listFriends(input) {
    object(input, []);
    await this.activeProfile();
    const rows = await this.rows(
      `SELECT ${profileProjection} FROM public.mycloset_profiles p
      WHERE p.user_id<>$1 AND (
        EXISTS(SELECT 1 FROM public.mycloset_relationships r WHERE r.user_a=LEAST($1,p.user_id) AND r.user_b=GREATEST($1,p.user_id))
        OR EXISTS(SELECT 1 FROM public.mycloset_blocks b WHERE b.blocker_id=$1 AND b.target_id=p.user_id)
      ) ORDER BY p.name,p.user_id LIMIT 1001`,
      [this.viewer],
    );
    if (rows.length > 1000)
      throw new SocialError(
        'Слишком много связей для одного списка. Свяжитесь с поддержкой.',
        422,
        'LIST_LIMIT',
      );
    const result = { friends: [], incoming: [], outgoing: [], blocked: [] };
    for (const row of rows) {
      const profile = this.profileDto(row);
      if (row.blocked_me) result.blocked.push(profile);
      else if (!row.blocked_other) {
        if (profile.relationship === 'friends') result.friends.push(profile);
        else if (profile.relationship === 'incoming') result.incoming.push(profile);
        else if (profile.relationship === 'outgoing') result.outgoing.push(profile);
      }
    }
    return result;
  }

  async relationship(input, operation) {
    object(input, ['userId']);
    await this.activeProfile();
    const userId = id(input.userId);
    if (userId === this.viewer) throw new SocialError('Выберите другого пользователя.');
    await this.requireTarget(userId);
    const [a, b] = pair(this.viewer, userId);
    const [existing] = await this.rows(
      'SELECT * FROM public.mycloset_relationships WHERE user_a=$1 AND user_b=$2',
      [a, b],
    );
    if (operation === 'request') {
      if (existing?.status === 'accepted' || existing?.requester_id === this.viewer)
        return { ok: true };
      if (existing)
        throw new SocialError(
          'У вас уже есть входящая заявка. Примите её в разделе друзей.',
          409,
          'INCOMING_REQUEST',
        );
      await consumeWriteQuota(this.db, this.viewer, 'friend_requests');
      await this.db.query(
        "INSERT INTO public.mycloset_relationships(user_a,user_b,requester_id,status) VALUES($1,$2,$3,'pending')",
        [a, b, this.viewer],
      );
      await this.notify(userId, 'friend_request');
    } else if (operation === 'accept') {
      if (existing?.status === 'accepted') return { ok: true };
      if (!existing || existing.requester_id === this.viewer)
        throw new SocialError('Входящая заявка больше недоступна.', 409, 'REQUEST_CHANGED');
      await this.db.query(
        "UPDATE public.mycloset_relationships SET status='accepted',updated_at=now() WHERE user_a=$1 AND user_b=$2",
        [a, b],
      );
      await this.db.query(
        "DELETE FROM public.mycloset_notifications WHERE recipient_id=$1 AND actor_id=$2 AND kind='friend_request'",
        [this.viewer, userId],
      );
      await this.notify(userId, 'friend_accepted');
    } else {
      const allowed =
        operation === 'remove'
          ? existing?.status === 'accepted'
          : existing?.status === 'pending' &&
            (operation === 'cancel'
              ? existing.requester_id === this.viewer
              : existing.requester_id === userId);
      if (existing && !allowed)
        throw new SocialError(
          'Состояние дружбы изменилось. Обновите список.',
          409,
          'REQUEST_CHANGED',
        );
      if (existing)
        await this.db.query(
          'DELETE FROM public.mycloset_relationships WHERE user_a=$1 AND user_b=$2',
          [a, b],
        );
      await this.db.query(
        "DELETE FROM public.mycloset_notifications WHERE kind IN ('friend_request','friend_accepted') AND ((recipient_id=$1 AND actor_id=$2) OR (recipient_id=$2 AND actor_id=$1))",
        [this.viewer, userId],
      );
    }
    return { ok: true };
  }

  async blockUser(input) {
    object(input, ['userId', 'blocked']);
    await this.activeProfile();
    const userId = id(input.userId);
    const value = boolean(input.blocked, 'Блокировка');
    if (userId === this.viewer) throw new SocialError('Нельзя заблокировать свой профиль.');
    const target = await this.getProfile(userId, true);
    if (!target) throw missing();
    if (value) {
      await this.db.query(
        'INSERT INTO public.mycloset_blocks(blocker_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [this.viewer, userId],
      );
      const [a, b] = pair(this.viewer, userId);
      await this.db.query(
        'DELETE FROM public.mycloset_relationships WHERE user_a=$1 AND user_b=$2',
        [a, b],
      );
      await this.db.query(
        'DELETE FROM public.mycloset_notifications WHERE (recipient_id=$1 AND actor_id=$2) OR (recipient_id=$2 AND actor_id=$1)',
        [this.viewer, userId],
      );
    } else
      await this.db.query(
        'DELETE FROM public.mycloset_blocks WHERE blocker_id=$1 AND target_id=$2',
        [this.viewer, userId],
      );
    return { ok: true };
  }

  async report(input) {
    object(input, ['targetType', 'targetId', 'reason']);
    await this.activeProfile();
    const type = choice(input.targetType, ['post', 'profile'], 'Тип жалобы');
    const targetId = id(input.targetId);
    if (type === 'post') await this.getPost(targetId);
    else await this.requireTarget(targetId);
    const reason = text(input.reason, 'Причина жалобы', 2000, { required: true });
    await consumeWriteQuota(this.db, this.viewer, 'reports');
    const reportId = randomUUID();
    await this.db.query(
      'INSERT INTO public.mycloset_reports(id,reporter_id,target_type,target_id,reason) VALUES($1,$2,$3,$4,$5)',
      [reportId, this.viewer, type, targetId, reason],
    );
    return { id: reportId };
  }

  async conversationRow(conversationId) {
    const [row] = await this.rows(
      `SELECT c.* FROM public.mycloset_conversations c WHERE c.id=$2 AND (c.user_a=$1 OR c.user_b=$1)
      AND NOT ${blocked('c.user_a', 'c.user_b')}`,
      [this.viewer, conversationId],
    );
    if (!row) throw missing();
    return row;
  }

  async conversationDto(row) {
    const peerId = row.user_a === this.viewer ? row.user_b : row.user_a;
    const peer = await this.requireTarget(peerId);
    const readAt = row.user_a === this.viewer ? row.read_a_at : row.read_b_at;
    const [lastMessage] = await this.rows(
      'SELECT text,created_at FROM public.mycloset_messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
      [row.id],
    );
    const [count] = await this.rows(
      'SELECT count(*) AS total FROM public.mycloset_messages WHERE conversation_id=$1 AND sender_id<>$2 AND created_at>$3',
      [row.id, this.viewer, readAt],
    );
    return {
      id: row.id,
      peer,
      lastMessage: lastMessage
        ? { text: lastMessage.text, createdAt: iso(lastMessage.created_at) }
        : null,
      unreadCount: Number(count.total),
      canMessage: peer.allowMessages === 'everyone' || peer.relationship === 'friends',
    };
  }

  async listConversations(input) {
    object(input, []);
    await this.activeProfile();
    const rows = await this.rows(
      `SELECT c.* FROM public.mycloset_conversations c
      WHERE (c.user_a=$1 OR c.user_b=$1) AND NOT ${blocked('c.user_a', 'c.user_b')}
      ORDER BY COALESCE((SELECT max(m.created_at) FROM public.mycloset_messages m WHERE m.conversation_id=c.id),c.created_at) DESC,c.id DESC LIMIT 101`,
      [this.viewer],
    );
    if (rows.length > 100)
      throw new SocialError('Слишком много диалогов для одного списка.', 422, 'LIST_LIMIT');
    const conversations = [];
    for (const row of rows) conversations.push(await this.conversationDto(row));
    return { conversations };
  }

  async openConversation(input) {
    object(input, ['userId']);
    await this.activeProfile();
    const userId = id(input.userId);
    if (userId === this.viewer) throw new SocialError('Выберите другого пользователя.');
    const peer = await this.requireTarget(userId);
    if (peer.allowMessages !== 'everyone' && peer.relationship !== 'friends')
      throw new SocialError(
        'Этот пользователь принимает сообщения только от друзей.',
        403,
        'FRIENDS_ONLY',
      );
    const [a, b] = pair(this.viewer, userId);
    await this.db.query(
      'INSERT INTO public.mycloset_conversations(id,user_a,user_b) VALUES($1,$2,$3) ON CONFLICT(user_a,user_b) DO NOTHING',
      [randomUUID(), a, b],
    );
    const [row] = await this.rows(
      'SELECT * FROM public.mycloset_conversations WHERE user_a=$1 AND user_b=$2',
      [a, b],
    );
    return { conversation: await this.conversationDto(row) };
  }

  async messageDto(row) {
    let post = null;
    if (row.had_post) {
      if (!row.post_id) post = { id: '', unavailable: true };
      else {
        try {
          const visible = await this.getPost(row.post_id);
          post = { id: visible.id, title: visible.title };
        } catch (error) {
          if (error.status !== 404) throw error;
          post = { id: row.post_id, unavailable: true };
        }
      }
    }
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      text: row.text,
      createdAt: iso(row.created_at),
      post,
    };
  }

  async listMessages(input) {
    object(input, ['conversationId', 'before']);
    await this.activeProfile();
    const conversationId = id(input.conversationId);
    await this.conversationRow(conversationId);
    const cursor = decodeCursor(input.before, `messages:${conversationId}`);
    const rows = await this.rows(
      `SELECT *,${cursorTime('created_at')} AS cursor_at FROM public.mycloset_messages WHERE conversation_id=$1
      AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3)) ORDER BY created_at DESC,id DESC LIMIT 31`,
      [conversationId, cursor?.at || null, cursor?.id || ''],
    );
    const visible = rows.slice(0, 30);
    const oldest = visible.at(-1);
    const messages = [];
    for (const row of visible.reverse()) messages.push(await this.messageDto(row));
    return {
      messages,
      nextCursor:
        rows.length > 30
          ? encodeCursor(`messages:${conversationId}`, { at: oldest.cursor_at, id: oldest.id })
          : null,
    };
  }

  async searchMessages(input) {
    const search = messageSearch(input);
    await this.activeProfile();
    await this.conversationRow(search.conversationId);
    const cursorKind = `messages-search:${search.conversationId}:${createHash('sha256').update(search.query).digest('hex')}`;
    const cursor = decodeCursor(search.cursor, cursorKind);
    const rows = await this.rows(
      `SELECT m.*,${cursorTime('m.created_at')} AS cursor_at
      FROM public.mycloset_messages m JOIN public.mycloset_conversations c ON c.id=m.conversation_id
      WHERE m.conversation_id=$1 AND (c.user_a=$2 OR c.user_b=$2)
        AND NOT ${blocked('c.user_a', 'c.user_b')}
        AND position($3::text in lower(m.text))>0
        AND ($4::timestamptz IS NULL OR (m.created_at,m.id)<($4,$5))
      ORDER BY m.created_at DESC,m.id DESC LIMIT 31`,
      [search.conversationId, this.viewer, search.query, cursor?.at || null, cursor?.id || ''],
    );
    const messages = [];
    for (const row of rows.slice(0, 30)) messages.push(await this.messageDto(row));
    const last = rows.slice(0, 30).at(-1);
    return {
      messages,
      nextCursor:
        rows.length > 30 ? encodeCursor(cursorKind, { at: last.cursor_at, id: last.id }) : null,
    };
  }

  async sendMessage(input) {
    object(input, ['conversationId', 'text', 'postId', 'clientId']);
    await this.activeProfile();
    const conversationId = id(input.conversationId);
    const conversation = await this.conversationRow(conversationId);
    const peerId = conversation.user_a === this.viewer ? conversation.user_b : conversation.user_a;
    const peer = await this.requireTarget(peerId);
    if (peer.allowMessages !== 'everyone' && peer.relationship !== 'friends')
      throw new SocialError(
        'Сообщения доступны только друзьям этого пользователя.',
        403,
        'FRIENDS_ONLY',
      );
    const value = text(input.text || '', 'Сообщение', 2000);
    const postId = input.postId ? id(input.postId) : null;
    const clientId = input.clientId === undefined ? null : idempotencyKey(input.clientId);
    if (!value && !postId) throw new SocialError('Напишите сообщение или выберите образ.');
    if (postId) {
      await this.getPost(postId);
      await this.getPost(postId, peerId);
    }
    const [row] = await this.rows(
      `INSERT INTO public.mycloset_messages(id,conversation_id,sender_id,text,post_id,had_post,client_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(sender_id,client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING *`,
      [randomUUID(), conversationId, this.viewer, value, postId, !!postId, clientId],
    );
    if (!row) {
      const [existing] = await this.rows(
        'SELECT * FROM public.mycloset_messages WHERE sender_id=$1 AND client_id=$2',
        [this.viewer, clientId],
      );
      if (
        !existing ||
        existing.conversation_id !== conversationId ||
        existing.text !== value ||
        existing.post_id !== postId
      )
        throw new SocialError(
          'Сообщение с этим ключом уже отличается. Обновите переписку.',
          409,
          'MESSAGE_CHANGED',
        );
      return { message: await this.messageDto(existing) };
    }
    await consumeWriteQuota(this.db, this.viewer, 'messages');
    await this.notify(peerId, 'message', { conversationId, messageId: row.id });
    return { message: await this.messageDto(row) };
  }

  async readMessages(input) {
    object(input, ['conversationId', 'lastMessageId']);
    await this.activeProfile();
    const conversation = await this.conversationRow(id(input.conversationId));
    let readThrough;
    if (input.lastMessageId) {
      const [row] = await this.rows(
        `SELECT ${cursorTime('created_at')} AS created_at FROM public.mycloset_messages WHERE id=$1 AND conversation_id=$2`,
        [id(input.lastMessageId), conversation.id],
      );
      if (!row) throw missing();
      readThrough = row.created_at;
    } else {
      const [row] = await this.rows(
        `SELECT ${cursorTime('max(created_at)')} AS latest FROM public.mycloset_messages WHERE conversation_id=$1`,
        [conversation.id],
      );
      readThrough = row.latest;
    }
    if (readThrough) {
      const column = conversation.user_a === this.viewer ? 'read_a_at' : 'read_b_at';
      await this.db.query(
        `UPDATE public.mycloset_conversations SET ${column}=GREATEST(${column},$2::timestamptz) WHERE id=$1`,
        [conversation.id, readThrough],
      );
      await this.db.query(
        "UPDATE public.mycloset_notifications SET read_at=now() WHERE recipient_id=$1 AND conversation_id=$2 AND kind='message' AND created_at<=$3",
        [this.viewer, conversation.id, readThrough],
      );
    }
    return { ok: true };
  }

  async listNotifications(input) {
    object(input, ['cursor']);
    await this.activeProfile();
    const cursor = decodeCursor(input.cursor, 'notifications');
    const rows = await this.rows(
      `SELECT n.*,${cursorTime('n.created_at')} AS cursor_at FROM public.mycloset_notifications n WHERE n.recipient_id=$1
      AND NOT ${blocked('$1', 'n.actor_id')} AND ($2::timestamptz IS NULL OR (n.created_at,n.id)<($2,$3))
      ORDER BY n.created_at DESC,n.id DESC LIMIT 31`,
      [this.viewer, cursor?.at || null, cursor?.id || ''],
    );
    const notifications = [];
    for (const row of rows.slice(0, 30)) {
      const actor = await this.getProfile(row.actor_id);
      if (!actor) continue;
      let postId = row.post_id;
      if (postId) {
        try {
          await this.getPost(postId);
        } catch (error) {
          if (error.status !== 404) throw error;
          postId = null;
        }
      }
      notifications.push({
        id: row.id,
        type: row.kind,
        actor,
        postId,
        conversationId: row.conversation_id,
        text: notificationText[row.kind],
        createdAt: iso(row.created_at),
        read: !!row.read_at,
      });
    }
    const last = rows.slice(0, 30).at(-1);
    return {
      notifications,
      nextCursor:
        rows.length > 30
          ? encodeCursor('notifications', { at: last.cursor_at, id: last.id })
          : null,
    };
  }

  async readNotifications(input) {
    object(input, ['ids']);
    await this.activeProfile();
    if ('ids' in input) {
      if (!Array.isArray(input.ids) || input.ids.length > 100)
        throw new SocialError('Выберите не более 100 уведомлений.');
      const ids = [...new Set(input.ids.map((value) => id(value)))];
      await this.db.query(
        'UPDATE public.mycloset_notifications SET read_at=now() WHERE recipient_id=$1 AND id=ANY($2::text[])',
        [this.viewer, ids],
      );
    } else
      await this.db.query(
        'UPDATE public.mycloset_notifications SET read_at=now() WHERE recipient_id=$1 AND read_at IS NULL',
        [this.viewer],
      );
    return { ok: true };
  }

  async media(input) {
    object(input, ['type', 'id', 'item']);
    const type = choice(input.type, ['avatar', 'post'], 'Фото');
    const targetId = id(input.id);
    if (type === 'avatar') {
      const [row] = await this.rows(
        `SELECT p.avatar FROM public.mycloset_profiles p WHERE p.user_id=$2 AND NOT ${blocked('$1', 'p.user_id')}`,
        [this.viewer, targetId],
      );
      if (!row?.avatar) throw missing();
      return { photo: row.avatar };
    }
    const itemId = id(input.item);
    const [row] = await this.rows(
      `SELECT item->>'photo' AS photo FROM public.mycloset_posts s
      JOIN public.mycloset_profiles p ON p.user_id=s.user_id,
      LATERAL jsonb_array_elements(s.snapshot->'items') item WHERE s.id=$2 AND item->>'id'=$3 AND ${visiblePost()}`,
      [this.viewer, targetId, itemId],
    );
    if (!row?.photo) throw missing();
    return { photo: row.photo };
  }

  async deleteAccount(input) {
    object(input, []);
    await this.db.query('DELETE FROM public.mycloset_profiles WHERE user_id=$1', [this.viewer]);
    await this.db.query('DELETE FROM public.mycloset_wardrobes WHERE user_id=$1', [this.viewer]);
    return { ok: true };
  }

  async dispatch(action, input) {
    switch (action) {
      case 'bootstrap':
        return this.bootstrap(input);
      case 'profile.get':
        return this.profileByUsername(input);
      case 'profile.save':
        return this.saveProfile(input);
      case 'people.search':
        return this.searchPeople(input);
      case 'posts.list':
        return this.listPosts(input);
      case 'posts.get':
        object(input, ['postId']);
        return { post: await this.getPost(id(input.postId)) };
      case 'posts.save':
        return this.savePost(input);
      case 'posts.delete':
        return this.deletePost(input);
      case 'posts.like':
        return this.setPostReaction(input, false);
      case 'posts.saveToCollection':
        return this.setPostReaction(input, true);
      case 'comments.list':
        return this.listComments(input);
      case 'comments.save':
        return this.saveComment(input);
      case 'comments.delete':
        return this.deleteComment(input);
      case 'friends.list':
        return this.listFriends(input);
      case 'friends.request':
        return this.relationship(input, 'request');
      case 'friends.accept':
        return this.relationship(input, 'accept');
      case 'friends.reject':
        return this.relationship(input, 'reject');
      case 'friends.cancel':
        return this.relationship(input, 'cancel');
      case 'friends.remove':
        return this.relationship(input, 'remove');
      case 'users.block':
        return this.blockUser(input);
      case 'reports.create':
        return this.report(input);
      case 'conversations.list':
        return this.listConversations(input);
      case 'conversations.open':
        return this.openConversation(input);
      case 'messages.list':
        return this.listMessages(input);
      case 'messages.search':
        return this.searchMessages(input);
      case 'messages.send':
        return this.sendMessage(input);
      case 'messages.read':
        return this.readMessages(input);
      case 'notifications.list':
        return this.listNotifications(input);
      case 'notifications.read':
        return this.readNotifications(input);
      case 'media.get':
        return this.media(input);
      case 'account.delete':
        return this.deleteAccount(input);
      default:
        throw new SocialError('Неизвестное действие.', 400, 'UNKNOWN_ACTION');
    }
  }
}

const ACTIONS = new Set([
  ...READ_ACTIONS,
  'profile.save',
  'posts.save',
  'posts.delete',
  'posts.like',
  'posts.saveToCollection',
  'comments.save',
  'comments.delete',
  'friends.request',
  'friends.accept',
  'friends.reject',
  'friends.cancel',
  'friends.remove',
  'users.block',
  'reports.create',
  'conversations.open',
  'messages.send',
  'messages.read',
  'notifications.read',
  'account.delete',
]);

export function createSocialService({ pool }) {
  return {
    async execute(action, input = {}, user = null) {
      if (!ACTIONS.has(action))
        throw new SocialError('Неизвестное действие.', 400, 'UNKNOWN_ACTION');
      if (!PUBLIC_ACTIONS.has(action) && !user?.id)
        throw new SocialError('Войдите в аккаунт.', 401, 'AUTH_REQUIRED');
      if (user?.id) id(user.id, 'идентификатор аккаунта');
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new SocialError('Проверьте переданные данные.');
      if (READ_ACTIONS.has(action)) return new SocialSession(pool, user).dispatch(action, input);
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query("SET LOCAL lock_timeout='8s'");
        // Serializing social mutations makes a block/privacy change atomic with a send,
        // friend acceptance, publication or deletion even when two devices race.
        await connection.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('mycloset:social:writes',0))",
        );
        const result = await new SocialSession(connection, user).dispatch(action, input);
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK');
        if (error.code === '23505')
          throw new SocialError(
            'Этот ник уже занят или запись уже существует.',
            409,
            'ALREADY_EXISTS',
          );
        if (error.code === '23503')
          throw new SocialError(
            'Связанная запись изменилась. Обновите страницу.',
            409,
            'RECORD_CHANGED',
          );
        if (['55P03', '40P01', '40001'].includes(error.code))
          throw new SocialError(
            'Данные сейчас изменяются. Повторите действие.',
            409,
            'RETRY_REQUIRED',
          );
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
