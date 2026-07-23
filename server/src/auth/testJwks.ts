import { generateKeyPairSync, createPublicKey } from "node:crypto";
import jwt from "jsonwebtoken";

/**
 * A fresh RSA keypair generated once per test process (NODE_ENV=test only —
 * see middleware.ts) so the test suite can mint real, RS256-signed access
 * tokens shaped exactly like Auth0's, without any network call to a real
 * Auth0 tenant. express-oauth2-jwt-bearer is configured to trust this key
 * directly via its `publicKey` option instead of fetching a remote JWKS —
 * this exercises the exact same signature/issuer/audience verification code
 * path as production, just against a local key instead of Auth0's.
 *
 * Not a secret worth rotating or protecting: it signs nothing outside this
 * test process, and a new one is generated every run.
 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

export const TEST_ISSUER = "https://test.nerobooks.local/";
export const TEST_KID = "test-key-1";

export const testJwk = {
  ...(createPublicKey(publicKey).export({ format: "jwk" }) as Record<string, unknown>),
  kid: TEST_KID,
  alg: "RS256",
  use: "sig",
};

export function signTestAccessToken(sub: string, audience: string): string {
  return jwt.sign({}, privateKey, {
    algorithm: "RS256",
    issuer: TEST_ISSUER,
    audience,
    subject: sub,
    keyid: TEST_KID,
    expiresIn: "1h",
  });
}
