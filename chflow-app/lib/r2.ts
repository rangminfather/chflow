import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const BUCKET = process.env.R2_BUCKET_NAME ?? "chflow-storage";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

function from(bucketName: string) {
  const prefix = bucketName + "/";

  return {
    async upload(
      path: string,
      body: Buffer | Uint8Array | ArrayBuffer | Blob,
      options?: { contentType?: string; upsert?: boolean }
    ) {
      try {
        let buf: Buffer;
        if (body instanceof Blob) {
          buf = Buffer.from(await body.arrayBuffer());
        } else if (body instanceof ArrayBuffer) {
          buf = Buffer.from(body);
        } else {
          buf = Buffer.from(body as Uint8Array);
        }
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: prefix + path,
            Body: buf,
            ContentType: options?.contentType,
          })
        );
        return { data: { path }, error: null };
      } catch (e) {
        return { data: null, error: e as Error };
      }
    },

    async download(path: string) {
      try {
        const res = await s3.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: prefix + path })
        );
        const chunks: Buffer[] = [];
        for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk));
        }
        const combined = Buffer.concat(chunks);
        const blob = new Blob([combined], { type: res.ContentType });
        return { data: blob, error: null };
      } catch (e) {
        return { data: null, error: e as Error };
      }
    },

    async list(
      prefix2?: string,
      options?: { limit?: number; sortBy?: { column: string; order: string } }
    ) {
      try {
        const fullPrefix = prefix + (prefix2 ? prefix2 + "/" : "");
        const res = await s3.send(
          new ListObjectsV2Command({
            Bucket: BUCKET,
            Prefix: fullPrefix,
            MaxKeys: options?.limit ?? 1000,
          })
        );
        const data = (res.Contents || [])
          .map((obj) => {
            const name = obj.Key!.slice(fullPrefix.length);
            return {
              name,
              id: obj.ETag ?? "",
              created_at: obj.LastModified?.toISOString() ?? "",
              updated_at: obj.LastModified?.toISOString() ?? "",
              last_accessed_at: obj.LastModified?.toISOString() ?? "",
              metadata: { size: obj.Size ?? 0, mimetype: "" },
            };
          })
          .filter((f) => f.name && !f.name.includes("/"));
        return { data, error: null };
      } catch (e) {
        return { data: null, error: e as Error };
      }
    },

    async remove(paths: string[]) {
      try {
        await Promise.all(
          paths.map((p) =>
            s3.send(
              new DeleteObjectCommand({ Bucket: BUCKET, Key: prefix + p })
            )
          )
        );
        return { data: paths, error: null };
      } catch (e) {
        return { data: null, error: e as Error };
      }
    },

    async createSignedUrl(path: string, expiresIn: number) {
      try {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: BUCKET, Key: prefix + path }),
          { expiresIn }
        );
        return { data: { signedUrl: url }, error: null };
      } catch (e) {
        return { data: null, error: e as Error };
      }
    },

    async createSignedUrls(paths: string[], expiresIn: number) {
      const results = await Promise.all(
        paths.map(async (path) => {
          const { data, error } = await from(bucketName).createSignedUrl(
            path,
            expiresIn
          );
          return { path, signedUrl: data?.signedUrl ?? "", error };
        })
      );
      return { data: results, error: null };
    },

    getPublicUrl(path: string) {
      return {
        data: {
          publicUrl: `/api/storage/${bucketName}/${path}`,
        },
      };
    },
  };
}

export const r2 = { from };
