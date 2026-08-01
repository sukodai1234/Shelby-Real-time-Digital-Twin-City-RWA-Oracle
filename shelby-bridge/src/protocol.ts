import { createHash, timingSafeEqual } from "node:crypto";

export interface UploadRequest {
  blobName: string;
  dataBase64: string;
  expectedSha256: string;
  ttlSeconds: number;
}

export function isAuthorized(header: string | undefined, expectedToken: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseUploadRequest(value: unknown): UploadRequest {
  if (!value || typeof value !== "object") throw new Error("JSON body must be an object");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.blobName !== "string" || !/^[A-Za-z0-9/_\-.]{1,512}$/.test(candidate.blobName)) {
    throw new Error("blobName contains unsupported characters");
  }
  if (typeof candidate.dataBase64 !== "string" || candidate.dataBase64.length === 0) {
    throw new Error("dataBase64 is required");
  }
  if (typeof candidate.expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.expectedSha256)) {
    throw new Error("expectedSha256 must be a lowercase SHA-256 digest");
  }
  if (!Number.isInteger(candidate.ttlSeconds) || Number(candidate.ttlSeconds) < 60 || Number(candidate.ttlSeconds) > 31_536_000) {
    throw new Error("ttlSeconds must be an integer between 60 and 31536000");
  }
  const decoded = Buffer.from(candidate.dataBase64, "base64");
  if (decoded.length === 0 || decoded.length > 2 * 1024 * 1024) {
    throw new Error("Decoded payload must be between 1 byte and 2 MiB");
  }
  const digest = createHash("sha256").update(decoded).digest("hex");
  if (digest !== candidate.expectedSha256) throw new Error("Payload hash does not match expectedSha256");
  return candidate as unknown as UploadRequest;
}
