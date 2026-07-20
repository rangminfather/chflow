# Bible Feature Backend

## Storage Strategy

- Source of truth: Supabase Postgres.
- Static cache/offline packs later: Cloudflare R2.
- Initial translation: `KRV` / 개역한글.

## Main RPCs

### List Books

```ts
const { data, error } = await supabase.rpc('list_bible_books')
```

### Read a Chapter

```ts
const { data, error } = await supabase.rpc('get_bible_chapter', {
  p_version: 'KRV',
  p_book_id: 43,
  p_chapter: 3,
})
```

### Read a Bulletin/Sermon Reference

```ts
const { data, error } = await supabase.rpc('get_bible_reference', {
  p_ref: '요 3:16-17',
  p_version: 'KRV',
})
```

Supported reference examples:

- `요 3:16`
- `요3:16-17`
- `요한복음 3`
- `마 5:1-12`
- `고전 13:1-13`
- `요 3:16-4:2`

### Search

```ts
const { data, error } = await supabase.rpc('search_bible', {
  p_query: '사랑',
  p_version: 'KRV',
  p_limit: 50,
})
```

### Save Reading Progress

```ts
const { error } = await supabase.rpc('save_bible_reading_progress', {
  p_version: 'KRV',
  p_book_id: 43,
  p_chapter: 3,
})
```

## User Tables

The migration also creates authenticated, user-scoped tables for:

- `user_bible_bookmarks`
- `user_bible_highlights`
- `user_bible_notes`
- `user_bible_reading_progress`

The frontend can use direct table operations because RLS restricts rows to `auth.uid()`.
