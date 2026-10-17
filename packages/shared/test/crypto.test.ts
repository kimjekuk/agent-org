import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/crypto";
import { hashPassword, verifyPassword } from "../src/password";

const key = randomBytes(32).toString("hex");

describe("API 키 암호화 (AES-256-GCM)", () => {
  it("암호화한 값을 원래대로 복호화한다", () => {
    const secret = "sk-ant-api03-예시-키";
    const token = encryptSecret(secret, key);
    expect(token).not.toContain(secret);
    expect(decryptSecret(token, key)).toBe(secret);
  });

  it("같은 값도 매번 다른 암호문이 나온다 (IV 무작위)", () => {
    expect(encryptSecret("a", key)).not.toBe(encryptSecret("a", key));
  });

  it("다른 키로는 복호화할 수 없다", () => {
    const token = encryptSecret("secret", key);
    expect(() => decryptSecret(token, randomBytes(32).toString("hex"))).toThrow();
  });

  it("암호문이 변조되면 복호화에 실패한다", () => {
    const [v, iv, tag, data] = encryptSecret("secret", key).split(":");
    const tampered = Buffer.from(data, "base64");
    tampered[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, tampered.toString("base64")].join(":"), key)).toThrow();
  });

  it("ENCRYPTION_KEY 형식이 틀리면 거부한다", () => {
    expect(() => encryptSecret("x", "short")).toThrow(/ENCRYPTION_KEY/);
  });
});

describe("비밀번호 해시 (scrypt)", () => {
  it("맞는 비밀번호만 통과한다", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("형식이 깨진 해시는 거부한다", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});
