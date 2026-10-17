// API 키 암호화 (AES-256-GCM). 키는 .env의 ENCRYPTION_KEY (hex 64자 = 32바이트, deploy.sh가 자동 생성).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function loadKey(keyHex = process.env.ENCRYPTION_KEY): Buffer {
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error("ENCRYPTION_KEY는 hex 64자(32바이트)여야 합니다");
  }
  return Buffer.from(keyHex, "hex");
}

/** 결과 형식: v1:<iv>:<tag>:<암호문> (모두 base64) */
export function encryptSecret(plain: string, keyHex?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(keyHex), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), encrypted].map((p) => (typeof p === "string" ? p : p.toString("base64"))).join(":");
}

export function decryptSecret(token: string, keyHex?: string): string {
  const [version, iv, tag, data] = token.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("암호문 형식이 올바르지 않습니다");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(keyHex), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
