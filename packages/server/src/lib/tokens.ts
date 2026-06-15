import { createHash, randomBytes, randomUUID } from "node:crypto";

import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { JOSEError } from "jose/errors";
import pino from "pino";

import { env } from "../config/env.js";
import { unauthorized } from "./errors.js";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const accessTokenTtl = "15m";
const refreshTokenByteLength = 32;
const tokenLogger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "warn"
});

export const refreshTokenTtlMs = 7 * 24 * 60 * 60 * 1000;

export interface AccessTokenPayload {
  sub: string;
  jti?: string;
}

export const hashPassword = async (password: string): Promise<string> =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1
  });

export const verifyPassword = async (
  passwordHash: string,
  password: string
): Promise<boolean> => argon2.verify(passwordHash, password);

export const issueAccessToken = async (userId: string): Promise<string> =>
  new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(accessTokenTtl)
    .sign(accessSecret);

export const verifyAccessToken = async (
  token: string
): Promise<AccessTokenPayload> => {
  const payload = await (async () => {
    try {
      const verified = await jwtVerify(token, accessSecret, {
        algorithms: ["HS256"]
      });

      return verified.payload;
    } catch (error) {
      if (error instanceof JOSEError) {
        tokenLogger.warn({ err: error }, "access token verification failed");
        throw unauthorized("Invalid access token");
      }

      tokenLogger.warn({ err: error }, "unexpected access token verification error");
      throw error;
    }
  })();

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw unauthorized("Invalid access token");
  }

  return {
    sub: payload.sub,
    ...(typeof payload.jti === "string" ? { jti: payload.jti } : {})
  };
};

export const generateRefreshToken = (): string =>
  randomBytes(refreshTokenByteLength).toString("hex");

export const hashRefreshToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const getRefreshTokenExpiry = (): Date =>
  new Date(Date.now() + refreshTokenTtlMs);
