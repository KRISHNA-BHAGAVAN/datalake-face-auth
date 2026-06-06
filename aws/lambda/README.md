# Face-template sync Lambda (server-side dedup)

`index.mjs` is the AWS Lambda behind `EXPO_PUBLIC_FACE_SYNC_API_URL` (a Lambda
Function URL). It accepts a batch of templates, **de-duplicates each one against
the datalake by cosine similarity**, inserts only genuinely-new people, and
reports which were skipped as duplicates.

This is what keeps DynamoDB clean: the device purges its local copies, so it
can't dedup against already-uploaded people — the Lambda is the authority.

## Contract

```
POST /
{ "templates": [ { "id": "user-123", "embedding": [..192 floats..], "createdAt": 1234 } ] }

200
{ "synced": 2, "inserted": 2, "duplicates": [ { "id": "user-9", "matchedId": "user-3", "score": 0.71 } ] }
```

`synced`/`inserted` = rows newly written. `duplicates` = templates that matched
an existing person (cosine ≥ threshold) and were skipped.

## Env vars

| Var | Default | Notes |
|-----|---------|-------|
| `FACE_TABLE` | `face_templates` | DynamoDB table, partition key `id` (String) |
| `DEDUP_THRESHOLD` | `0.45` | cosine match cutoff — keep in sync with `config.recognition.cosineSimilarityThreshold` |
| `SYNC_API_KEY` | _(unset)_ | if set, requires matching `x-api-key` header |

## Deploy

Runtime **Node.js 20.x**. The AWS SDK v3 (`@aws-sdk/client-dynamodb`,
`@aws-sdk/lib-dynamodb`) is preinstalled in the Lambda Node 20 runtime — no
bundling needed.

1. Replace your function's `index.mjs` with this file (handler = `index.handler`).
2. DynamoDB table `face_templates`, partition key `id` (String).
3. IAM role: `dynamodb:Scan` + `dynamodb:PutItem` on the table.
4. Set env vars (at minimum `SYNC_API_KEY` to match the app's
   `EXPO_PUBLIC_FACE_SYNC_API_KEY`).

## Scaling note

Dedup does a full table `Scan` per sync request — fine for hackathon scale
(hundreds–low thousands of templates, a few ms). Beyond ~100k templates, move to
a vector index (e.g. OpenSearch k-NN / pgvector) instead of an in-Lambda scan.
Dedup runs only at sync time; on-device verify is unaffected.
