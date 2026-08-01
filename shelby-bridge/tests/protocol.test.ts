import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { isAuthorized, parseUploadRequest } from "../src/protocol.js";

test("validates an authenticated, content-addressed upload", () => {
  const bytes = Buffer.from("verified sensor snapshot");
  const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
  const upload = parseUploadRequest({
    blobName: `digital-twins/asset-1/${expectedSha256}.json`,
    dataBase64: bytes.toString("base64"), expectedSha256, ttlSeconds: 3600,
  });
  assert.equal(upload.expectedSha256, expectedSha256);
  assert.equal(isAuthorized("Bearer bridge-secret-token", "bridge-secret-token"), true);
});

test("rejects a hash mismatch", () => {
  assert.throws(() => parseUploadRequest({
    blobName: "digital-twins/asset-1/data.json",
    dataBase64: Buffer.from("payload").toString("base64"),
    expectedSha256: "0".repeat(64), ttlSeconds: 3600,
  }));
});
