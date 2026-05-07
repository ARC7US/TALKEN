import {
  sign as cryptoSign,
  verify as cryptoVerify,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  createHash,
} from "node:crypto";

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

export function generateKeyPair(): { publicKey: string; secretKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const pubRaw = publicKey.subarray(publicKey.length - 32);
  const privRaw = privateKey.subarray(privateKey.length - 32);
  return {
    publicKey: "pk_" + pubRaw.toString("base64url"),
    secretKey: "sk_" + privRaw.toString("base64url"),
  };
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Build the canonical string that gets signed.
 * Format: METHOD\nPATH\nTIMESTAMP\nBODY_HASH
 */
export function buildSignableString(
  method: string,
  path: string,
  timestamp: string,
  body?: string,
): string {
  const bodyHash = body
    ? createHash("sha256").update(body).digest("base64url")
    : "";
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

/**
 * Sign a request using ed25519.
 * Returns a base64url-encoded signature.
 */
export async function signPayload(
  secretKey: string,
  method: string,
  path: string,
  timestamp: string,
  body?: string,
): Promise<string> {
  const skBase64url = secretKey.replace(/^sk_/, "");
  const skRaw = Buffer.from(skBase64url, "base64url");
  const pkcs8Der = buildPkcs8Der(skRaw);

  const keyObj = createPrivateKey({ key: pkcs8Der, format: "der", type: "pkcs8" });
  const data = Buffer.from(buildSignableString(method, path, timestamp, body));
  const sig = cryptoSign(null, data, keyObj);
  return sig.toString("base64url");
}

/**
 * Verify an ed25519 signature.
 */
export async function verifySignature(
  publicKey: string,
  method: string,
  path: string,
  timestamp: string,
  signature: string,
  body?: string,
): Promise<boolean> {
  try {
    const pkBase64url = publicKey.replace(/^pk_/, "");
    const pkRaw = Buffer.from(pkBase64url, "base64url");
    const spkiDer = buildSpkiDer(pkRaw);

    const keyObj = createPublicKey({ key: spkiDer, format: "der", type: "spki" });
    const data = Buffer.from(buildSignableString(method, path, timestamp, body));
    return cryptoVerify(null, data, keyObj, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// DER encoding helpers
// ---------------------------------------------------------------------------

function buildPkcs8Der(rawPrivateKey: Buffer): Buffer {
  // PKCS8 for Ed25519: 30 2e 02 01 00 30 05 06 03 2b6570 04 22 04 20 <32 bytes>
  const prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  return Buffer.concat([prefix, rawPrivateKey]);
}

function buildSpkiDer(rawPublicKey: Buffer): Buffer {
  // SPKI for Ed25519: 30 2a 30 05 06 03 2b6570 03 21 00 <32 bytes>
  const prefix = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
    0x70, 0x03, 0x21, 0x00,
  ]);
  return Buffer.concat([prefix, rawPublicKey]);
}
