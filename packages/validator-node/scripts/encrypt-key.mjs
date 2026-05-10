/**
 * Standalone key encryption script — runs with plain `node`.
 * Usage: TALKEN_WALLET_PRIVATE_KEY=0x... TALKEN_KEY_PASSWORD=xxx node scripts/encrypt-key.mjs
 */

import { createCipheriv, randomBytes, scryptSync } from "crypto";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ALGORITHM = "aes-256-cbc";
const KEY_DIR = join(homedir(), ".talken");
const KEY_FILE = join(KEY_DIR, "key.enc");

const pk = process.env.TALKEN_WALLET_PRIVATE_KEY;
const password = process.env.TALKEN_KEY_PASSWORD;

if (!pk || !password) {
  console.error("TALKEN_WALLET_PRIVATE_KEY and TALKEN_KEY_PASSWORD required");
  process.exit(1);
}

const salt = randomBytes(16);
const iv = randomBytes(16);
const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });

const cipher = createCipheriv(ALGORITHM, key, iv);
let encrypted = cipher.update(pk, "utf8", "hex");
encrypted += cipher.final("hex");

if (!existsSync(KEY_DIR)) {
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
}

const payload = JSON.stringify({
  iv: iv.toString("hex"),
  salt: salt.toString("hex"),
  data: encrypted,
});

writeFileSync(KEY_FILE, payload, { mode: 0o600 });
console.log("私钥已加密存储在 ~/.talken/key.enc");
