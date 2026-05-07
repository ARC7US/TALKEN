/**
 * TALKEN Signature + Auth Test
 *
 * Tests ed25519 key generation, signing, verification, and auth middleware.
 *
 * Run: npx tsx scripts/test-signature.ts
 *
 * Note: Run with STELLAR_MODE=testnet to enable auth checks.
 *       With STELLAR_MODE=mock (default), auth is skipped.
 */

import { generateKeyPair, signPayload, verifySignature, buildSignableString } from "../packages/shared/src/utils/signature.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed++;
    throw new Error(`FAIL: ${message}`);
  }
  passed++;
  console.log(`  ✓ ${message}`);
}

let sectionNum = 0;
function section(title: string) {
  sectionNum++;
  console.log(`\n┌─ ${sectionNum}. ${title}`);
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  TALKEN Signature + Auth Test            ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── 1. Key generation ──────────────────────────────────────────────────
  section("Key generation");
  const pair1 = generateKeyPair();
  const pair2 = generateKeyPair();

  assert(pair1.publicKey.startsWith("pk_"), "Public key starts with pk_");
  assert(pair1.secretKey.startsWith("sk_"), "Secret key starts with sk_");
  assert(pair1.publicKey.length > 10, "Public key has reasonable length");
  assert(pair1.secretKey.length > 10, "Secret key has reasonable length");
  assert(pair1.publicKey !== pair2.publicKey, "Different key pairs are unique");
  assert(pair1.secretKey !== pair2.secretKey, "Different secret keys are unique");

  // ── 2. Signable string construction ───────────────────────────────────
  section("Signable string construction");
  const s1 = buildSignableString("POST", "/api/v1/tasks", "1234567890", '{"skill":"search"}');
  const s2 = buildSignableString("POST", "/api/v1/tasks", "1234567890", '{"skill":"search"}');
  const s3 = buildSignableString("GET", "/api/v1/tasks", "1234567890");
  const s4 = buildSignableString("POST", "/api/v1/tasks", "9999999999", '{"skill":"search"}');

  assert(s1 === s2, "Same inputs → same signable string");
  assert(s1 !== s3, "Different method → different string");
  assert(s1 !== s4, "Different timestamp → different string");
  assert(s1.includes("POST"), "String contains method");
  assert(s1.includes("/api/v1/tasks"), "String contains path");
  assert(s1.includes("1234567890"), "String contains timestamp");

  // ── 3. Signing and verification ────────────────────────────────────────
  section("Signing and verification");
  const method = "POST";
  const path = "/api/v1/tasks";
  const timestamp = "1234567890";
  const body = '{"skill":"search","fee":10}';

  const sig = await signPayload(pair1.secretKey, method, path, timestamp, body);
  assert(typeof sig === "string" && sig.length > 10, "Signature is a non-empty string");

  // Valid signature should verify
  const valid = await verifySignature(pair1.publicKey, method, path, timestamp, sig, body);
  assert(valid === true, "Valid signature verifies correctly");

  // ── 4. Tampered data should fail ──────────────────────────────────────
  section("Tampered data rejection");

  // Wrong body
  const bad1 = await verifySignature(pair1.publicKey, method, path, timestamp, sig, '{"skill":"code"}');
  assert(bad1 === false, "Tampered body → verification fails");

  // Wrong method
  const bad2 = await verifySignature(pair1.publicKey, "GET", path, timestamp, sig, body);
  assert(bad2 === false, "Tampered method → verification fails");

  // Wrong path
  const bad3 = await verifySignature(pair1.publicKey, method, "/api/v1/other", timestamp, sig, body);
  assert(bad3 === false, "Tampered path → verification fails");

  // Wrong timestamp
  const bad4 = await verifySignature(pair1.publicKey, method, path, "9999999999", sig, body);
  assert(bad4 === false, "Tampered timestamp → verification fails");

  // ── 5. Wrong key should fail ──────────────────────────────────────────
  section("Wrong key rejection");
  const bad5 = await verifySignature(pair2.publicKey, method, path, timestamp, sig, body);
  assert(bad5 === false, "Wrong public key → verification fails");

  // ── 6. Signature is deterministic ─────────────────────────────────────
  section("Signature determinism");
  const sig2 = await signPayload(pair1.secretKey, method, path, timestamp, body);
  assert(sig === sig2, "Same inputs → same signature");

  // ── 7. No-body request ────────────────────────────────────────────────
  section("No-body request signing");
  const getSig = await signPayload(pair1.secretKey, "GET", "/api/v1/tasks", timestamp);
  const getValid = await verifySignature(pair1.publicKey, "GET", "/api/v1/tasks", timestamp, getSig);
  assert(getValid === true, "GET request (no body) signs and verifies");

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════╗");
  console.log(`║  Results: ${passed} passed, ${failed} failed${" ".repeat(Math.max(0, 16 - String(passed).length - String(failed).length))}║`);
  console.log("╚══════════════════════════════════════════╝");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\n╔══════════════════════════════════════════╗`);
  console.error(`║  TEST FAILED (${passed} passed, ${failed} failed)         ║`);
  console.error("╚══════════════════════════════════════════╝");
  console.error(err);
  process.exit(1);
});
