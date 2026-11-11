import { neon } from '@neondatabase/serverless';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuerHost = Buffer.from(process.env.CLERK_PUBLISHABLE_KEY?.split('_')[2] ?? '', 'base64').toString();
const issuer = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\$$/i.test(issuerHost) ? 'https://' + issuerHost.slice(0, -1) : null;
const keys = issuer && createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer));
const origin = process.env.WORD_BLOCKS_ORIGIN || 'https://littlefox-words.vercel.app';
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
const pdfId = /^[a-f0-9]{64}$/;
const partId = /^[a-f0-9]{64}\.(?:[0-9]|[1-4][0-9])$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const recordKey = (word) => word.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
const wordTextFields = ['meaning', 'us', 'ipa', 'example', 'translation', 'usAudio', 'ukAudio', 'masteredOn'];
const validExample = (example) => example && typeof example.text === 'string'
  && (example.translation == null || typeof example.translation === 'string');
let initialization;

function initialize() {
  initialization ??= sql`CREATE TABLE IF NOT EXISTS word_blocks_records (
    owner text NOT NULL, kind text NOT NULL, key text NOT NULL, data jsonb NOT NULL,
    revision integer NOT NULL DEFAULT 1, PRIMARY KEY (owner, kind, key)
  )`.catch((error) => { initialization = undefined; throw error; });
  return initialization;
}

const json = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
});

async function ownerOf(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token || !keys) return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer, algorithms: ['RS256'], requiredClaims: ['exp', 'nbf', 'sub', 'sid', 'azp']
    });
    if (payload.azp !== origin || !/^user_[a-z0-9]+$/i.test(payload.sub)
      || !/^sess_[a-z0-9]+$/i.test(payload.sid) || (payload.sts && payload.sts !== 'active')) return null;
    return issuer + ':' + payload.sub;
  } catch {
    return null;
  }
}

async function read(owner, params) {
  const kind = params.get('kind');
  if (kind === 'part') {
    const key = params.get('key') ?? '';
    if (!partId.test(key)) return json({ error: '文件片段无效。' }, 400);
    const [id] = key.split('.');
    const [row] = await sql`SELECT data FROM word_blocks_records part
      WHERE owner = ${owner} AND kind = 'part' AND key = ${key}
      AND EXISTS (SELECT 1 FROM word_blocks_records
        WHERE owner = ${owner} AND kind = 'pdf' AND key = ${id})`;
    return row ? json(row.data) : json({ error: '文件片段不存在。' }, 404);
  }
  if (kind !== 'word' && kind !== 'pdf') return json({ error: '数据类型无效。' }, 400);
  const cursor = params.get('cursor') ?? '';
  if (cursor.length > 128) return json({ error: '分页位置无效。' }, 400);
  const limit = kind === 'pdf' ? 1 : 100;
  const rows = await sql`SELECT key, data, revision FROM word_blocks_records
    WHERE owner = ${owner} AND kind = ${kind} AND key > ${cursor} ORDER BY key LIMIT ${limit + 1}`;
  const records = rows.slice(0, limit);
  return json({ items: records.map(({ data, revision }) => ({ ...data, syncRevision: revision })),
    cursor: rows.length > limit ? records.at(-1).key : null });
}

async function write(owner, request) {
  const { kind, data, key, revision = 0, importOnly = false } = await request.json();
  if (kind === 'word') {
    if (!data || typeof data.word !== 'string' || !/^[a-z][a-z' -]{0,59}$/i.test(data.word)
      || !uuid.test(data.id) || !/^\d{4}-\d{2}-\d{2}$/.test(data.added)
      || wordTextFields.some((field) => data[field] != null && typeof data[field] !== 'string')
      || (data.examples != null && (!Array.isArray(data.examples) || !data.examples.every(validExample)))
      || (data.lookupMissing != null && !Array.isArray(data.lookupMissing))
      || ![0, 1, 2, 3].includes(data.level) || !Number.isSafeInteger(revision) || revision < 0
      || revision > 2147483646 || Buffer.byteLength(JSON.stringify(data)) > 20000) {
      return json({ error: '生词数据无效或过长。' }, 400);
    }
    const wordKey = recordKey(data.word);
    const value = JSON.stringify(data);
    const rows = revision > 0 && !importOnly
      ? await sql`UPDATE word_blocks_records SET data = ${value}::jsonb, revision = revision + 1
          WHERE owner = ${owner} AND kind = 'word' AND key = ${wordKey} AND revision = ${revision}
          RETURNING data, revision`
      : await sql`INSERT INTO word_blocks_records (owner, kind, key, data)
          VALUES (${owner}, 'word', ${wordKey}, ${value}::jsonb) ON CONFLICT DO NOTHING RETURNING data, revision`;
    if (rows.length) return json({ ...rows[0].data, syncRevision: rows[0].revision });
    if (importOnly) return json({ skipped: true });
    return json({ error: '此单词已在另一设备更新。请刷新后再修改。' }, 409);
  }
  if (kind === 'part' && partId.test(key) && typeof data === 'string'
      && data.length <= 1398104 && /^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    await sql`INSERT INTO word_blocks_records (owner, kind, key, data)
      VALUES (${owner}, 'part', ${key}, ${JSON.stringify(data)}::jsonb) ON CONFLICT DO NOTHING`;
    return json({ saved: true });
  }
  if (kind === 'pdf' && data && pdfId.test(data.id) && typeof data.name === 'string'
      && typeof data.added === 'string' && Array.isArray(data.examples) && data.examples.every((example) =>
        validExample(example) && Number.isInteger(example.page) && example.page >= 1
        && (example.terms == null || Array.isArray(example.terms)))
      && Number.isInteger(data.pageCount) && data.pageCount > 0
      && Number.isInteger(data.parts) && data.parts >= 1 && data.parts <= 50
      && Buffer.byteLength(JSON.stringify(data)) <= 3000000) {
    const rows = await sql`INSERT INTO word_blocks_records (owner, kind, key, data)
      SELECT ${owner}, 'pdf', ${data.id}, ${JSON.stringify(data)}::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM generate_series(0, ${data.parts}::integer - 1) AS position(i)
        WHERE NOT EXISTS (SELECT 1 FROM word_blocks_records WHERE owner = ${owner} AND kind = 'part'
          AND key = ${data.id} || '.' || position.i::text))
      ON CONFLICT DO NOTHING RETURNING key`;
    if (rows.length) return json({ saved: true });
    const [existing] = await sql`SELECT key FROM word_blocks_records WHERE owner = ${owner}
      AND kind = 'pdf' AND key = ${data.id}`;
    return existing ? json({ saved: true }) : json({ error: '文件上传未完成，请重试。' }, 409);
  }
  return json({ error: '同步数据无效或过大。' }, 400);
}

async function handler(request) {
  const owner = await ownerOf(request);
  if (!owner) return json({ error: '登录已失效，请重新登录。' }, 401);
  if (!sql) return json({ error: '云端词库尚未配置。' }, 503);
  if (request.method !== 'GET' && request.method !== 'PUT') return json({ error: '不支持此操作。' }, 405);
  try {
    await initialize();
    return request.method === 'GET' ? await read(owner, new URL(request.url).searchParams) : await write(owner, request);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: '请求格式无效。' }, 400);
    console.error('Library request failed', error.code ?? error.name);
    return json({ error: '云端词库暂时不可用，请稍后重试。' }, 503);
  }
}

export default { fetch: handler };
