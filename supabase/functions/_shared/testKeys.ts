/**
 * Test-only helpers: generate an RSA key pair and derive the PKCS#1 form GitHub
 * ships, so the PEM handling is exercised on both shapes without any real key.
 */
import { bytesToBase64 } from "../../../shared/base64.ts";

export async function generateTestKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  pkcs8Pem: string;
  pkcs1Pem: string;
  pkcs8Der: Uint8Array;
}> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8Der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pkcs1Der = pkcs8ToPkcs1(pkcs8Der);
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    pkcs8Der,
    pkcs8Pem: toPem("PRIVATE KEY", pkcs8Der),
    pkcs1Pem: toPem("RSA PRIVATE KEY", pkcs1Der),
  };
}

export function toPem(label: string, der: Uint8Array): string {
  const body = bytesToBase64(der).replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/** Minimal DER TLV reader. */
function readTlv(bytes: Uint8Array, offset: number): { tag: number; length: number; start: number } {
  const tag = bytes[offset]!;
  let length = bytes[offset + 1]!;
  let cursor = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    length = 0;
    for (let i = 0; i < count; i += 1) length = (length << 8) | bytes[cursor + i]!;
    cursor += count;
  }
  return { tag, length, start: cursor };
}

/** PKCS#8 PrivateKeyInfo → the inner PKCS#1 RSAPrivateKey bytes. */
export function pkcs8ToPkcs1(pkcs8: Uint8Array): Uint8Array {
  const outer = readTlv(pkcs8, 0); // SEQUENCE
  let cursor = outer.start;
  const version = readTlv(pkcs8, cursor); // INTEGER 0
  cursor = version.start + version.length;
  const algorithm = readTlv(pkcs8, cursor); // SEQUENCE
  cursor = algorithm.start + algorithm.length;
  const octet = readTlv(pkcs8, cursor); // OCTET STRING
  if (octet.tag !== 0x04) throw new Error("expected OCTET STRING");
  return pkcs8.slice(octet.start, octet.start + octet.length);
}
