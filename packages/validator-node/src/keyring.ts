/**
 * Keyring — AES-256-CBC encrypted key storage.
 * Stores encrypted private key at ~/.talken/key.enc
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ALGORITHM = "aes-256-cbc";
const KEY_DIR = join(homedir(), ".talken");
const KEY_FILE = join(KEY_DIR, "key.enc");

interface EncryptedKey {
  iv: string;
  salt: string;
  data: string;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function encryptKey(privateKey: string, password: string): void {
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(privateKey, "utf8", "hex");
  encrypted += cipher.final("hex");

  if (!existsSync(KEY_DIR)) {
    mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  }

  const payload: EncryptedKey = {
    iv: iv.toString("hex"),
    salt: salt.toString("hex"),
    data: encrypted,
  };

  writeFileSync(KEY_FILE, JSON.stringify(payload), { mode: 0o600 });
}

export function decryptKey(password: string): string {
  if (!existsSync(KEY_FILE)) {
    throw new Error("未找到加密密钥文件。请先运行 install.sh 完成质押配置。");
  }

  const payload: EncryptedKey = JSON.parse(readFileSync(KEY_FILE, "utf-8"));
  const salt = Buffer.from(payload.salt, "hex");
  const iv = Buffer.from(payload.iv, "hex");
  const key = deriveKey(password, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(payload.data, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function hasKeyring(): boolean {
  return existsSync(KEY_FILE);
}

export function getKeyringPath(): string {
  return KEY_FILE;
}
