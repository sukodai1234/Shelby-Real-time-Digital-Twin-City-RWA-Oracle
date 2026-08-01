import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import { isAuthorized, parseUploadRequest } from "./protocol.js";

const port = Number(process.env.PORT ?? "8787");
const authToken = process.env.BRIDGE_AUTH_TOKEN;
const apiKey = process.env.SHELBY_API_KEY;
const privateKey = process.env.SHELBY_ACCOUNT_PRIVATE_KEY;
if (!authToken || authToken.length < 16) throw new Error("BRIDGE_AUTH_TOKEN must be at least 16 characters");
if (!apiKey) throw new Error("SHELBY_API_KEY is required");
if (!privateKey) throw new Error("SHELBY_ACCOUNT_PRIVATE_KEY is required");

const client = new ShelbyNodeClient({ network: Network.SHELBYNET, apiKey });
const signer = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(privateKey) });

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 3 * 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", service: "shelby-bridge" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/blobs") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  if (!isAuthorized(request.headers.authorization, authToken)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }
  try {
    const upload = parseUploadRequest(await readJson(request));
    const bytes = Buffer.from(upload.dataBase64, "base64");
    const expirationMicros = Date.now() * 1_000 + upload.ttlSeconds * 1_000_000;
    await client.upload({ blobData: bytes, signer, blobName: upload.blobName, expirationMicros });
    sendJson(response, 201, {
      account: signer.accountAddress.toString(), blobName: upload.blobName,
      sha256: upload.expectedSha256, size: bytes.length, expirationMicros,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upload error";
    sendJson(response, 400, { error: "upload_failed", message });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Shelby bridge listening on :${port}`));
