import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM token vault. The key is 32 bytes, base64, from TOKEN_VAULT_KEY. Never log the plaintext. */

export function decodeKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("TOKEN_VAULT_KEY must be 32 bytes of base64");
  return key;
}

export function encrypt(plain: string, keyB64: string): string {
  const key = decodeKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decrypt(payload: string, keyB64: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("bad vault payload");
  const key = decodeKey(keyB64);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plain.toString("utf8");
}
