import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const s3 = new S3Client({});
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || "datalake-images-store";
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "face_templates";
const AWS_REGION = process.env.AWS_REGION || "ap-south-1";
const DEDUP_THRESHOLD = 0.42;

const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
};

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  if (method === "OPTIONS") {
    return { statusCode: 200, headers, body: JSON.stringify({ message: "OK" }) };
  }

  try {
    // --- UPLOAD (POST) ---
    if (method === "POST") {
      const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      const templates = body?.templates || [];

      const existing = await docClient.send(new ScanCommand({
        TableName: DYNAMODB_TABLE_NAME
      }));
      const existingTemplates = existing.Items || [];

      let syncedCount = 0;
      const duplicates = [];

      for (const t of templates) {
        if (!t.id || !t.embedding) continue;

        let isDuplicate = false;
        for (const existing of existingTemplates) {
          const similarity = cosineSimilarity(t.embedding, existing.embedding);
          if (similarity >= DEDUP_THRESHOLD) {
            isDuplicate = true;
            duplicates.push({ newId: t.id, existingId: existing.id, similarity });
            break;
          }
        }

        if (isDuplicate) continue;

        let s3ImageKey = null;
        let s3ImageUrl = null;

        if (t.imageBase64) {
          const buffer = Buffer.from(t.imageBase64, "base64");
          s3ImageKey = `face_images/${t.id}.jpg`;

          await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET_NAME,
            Key: s3ImageKey,
            Body: buffer,
            ContentType: "image/jpeg"
          }));

          s3ImageUrl = `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${s3ImageKey}`;
        }

        await docClient.send(new PutCommand({
          TableName: DYNAMODB_TABLE_NAME,
          Item: {
            id: t.id,
            embedding: t.embedding,
            createdAt: t.createdAt || Date.now(),
            lastKnownLocation: t.lastKnownLocation || null,
            s3ImageKey: s3ImageKey,
            s3ImageUrl: s3ImageUrl
          }
        }));

        syncedCount++;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ synced: syncedCount, duplicates }) };
    }

    // --- DOWNLOAD (GET) ---
    if (method === "GET") {
      const result = await docClient.send(new ScanCommand({
        TableName: DYNAMODB_TABLE_NAME
      }));

      const templates = await Promise.all(
        (result.Items || []).map(async (item) => {
          let imageBase64 = null;
          if (item.s3ImageKey) {
            try {
              const s3Obj = await s3.send(new GetObjectCommand({
                Bucket: S3_BUCKET_NAME,
                Key: item.s3ImageKey
              }));
              const bytes = await s3Obj.Body.transformToByteArray();
              imageBase64 = Buffer.from(bytes).toString("base64");
            } catch (e) {
              console.warn("Failed to fetch image from S3 for key:", item.s3ImageKey, e);
            }
          }

          return {
            id: item.id,
            embedding: item.embedding,
            createdAt: item.createdAt,
            lastKnownLocation: item.lastKnownLocation || undefined,
            imageBase64: imageBase64 || undefined,
            imageUrl: item.s3ImageUrl
          };
        })
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ templates })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unsupported HTTP method" }) };
  } catch (err) {
    console.error("Lambda processing error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
