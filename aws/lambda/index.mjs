// AWS Lambda (Function URL, Node.js 20.x ESM) — face-template sync with
// server-side biometric de-duplication.
//
// The device purges its local copies after sync, so it cannot dedup against
// previously-uploaded people. This handler is the authority: before inserting
// an incoming template it compares it (cosine similarity) against every row
// already in DynamoDB and skips any that match an existing person.
//
// Request : POST { templates: [{ id, embedding: number[], createdAt }] }
// Response: { synced, inserted, duplicates: [{ id, matchedId, score }] }
//
// Env vars:
//   FACE_TABLE      DynamoDB table name        (default: face_templates)
//   DEDUP_THRESHOLD cosine match cutoff         (default: 0.45 — matches device)
//   SYNC_API_KEY    if set, require x-api-key header to match

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.FACE_TABLE || 'face_templates';
const THRESHOLD = Number(process.env.DEDUP_THRESHOLD ?? 0.45);
const API_KEY = process.env.SYNC_API_KEY || '';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Device embeddings are L2-normalized unit vectors, so cosine == dot product.
// We still compute full cosine to stay correct if an un-normalized vector slips in.
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Load every stored embedding once per request (paginated scan).
async function loadExisting() {
  const rows = [];
  let ExclusiveStartKey;
  do {
    const out = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        ProjectionExpression: 'id, embedding, createdAt',
        ExclusiveStartKey,
      })
    );
    for (const it of out.Items || []) {
      if (Array.isArray(it.embedding)) {
        rows.push({ id: it.id, embedding: it.embedding.map(Number), createdAt: it.createdAt });
      }
    }
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  // Function URL: method/headers live under event.requestContext.http / event.headers.
  const method =
    event?.requestContext?.http?.method || event?.httpMethod || 'POST';
  if (method === 'OPTIONS') return reply(204, {});
  if (method !== 'POST') return reply(405, { error: 'Method not allowed' });

  if (API_KEY) {
    const headers = event.headers || {};
    const got = headers['x-api-key'] || headers['X-Api-Key'];
    if (got !== API_KEY) return reply(401, { error: 'Unauthorized' });
  }

  let payload;
  try {
    payload = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return reply(400, { error: 'Invalid JSON body' });
  }

  // Download action — return all templates from DynamoDB.
  if (payload?.action === 'download') {
    const all = await loadExisting();
    return reply(200, { templates: all.map((r) => ({ id: r.id, embedding: r.embedding, createdAt: r.createdAt })) });
  }

  const incoming = Array.isArray(payload?.templates) ? payload.templates : [];
  if (incoming.length === 0) return reply(200, { synced: 0, inserted: 0, duplicates: [] });

  // Snapshot of what's already stored. We also dedup the incoming batch against
  // itself (a purged device can resend the same person twice in one request).
  const known = await loadExisting();

  const duplicates = [];
  let inserted = 0;

  for (const t of incoming) {
    const emb = Array.isArray(t?.embedding) ? t.embedding.map(Number) : null;
    if (!emb || !t?.id) continue;

    let best = { id: null, score: -1 };
    for (const row of known) {
      const s = cosine(emb, row.embedding);
      if (s > best.score) best = { id: row.id, score: s };
    }

    if (best.score >= THRESHOLD) {
      // Same person already in the datalake — skip the insert.
      duplicates.push({ id: t.id, matchedId: best.id, score: Number(best.score.toFixed(4)) });
      continue;
    }

    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          id: String(t.id),
          embedding: emb,
          createdAt: t.createdAt ?? Date.now(),
          syncedAt: Date.now(),
        },
        // Defensive: never clobber an existing id.
        ConditionExpression: 'attribute_not_exists(id)',
      })
    ).catch((e) => {
      if (e?.name !== 'ConditionalCheckFailedException') throw e;
    });

    inserted += 1;
    // Make this template visible to later items in the same batch.
    known.push({ id: String(t.id), embedding: emb });
  }

  return reply(200, { synced: inserted, inserted, duplicates });
};
