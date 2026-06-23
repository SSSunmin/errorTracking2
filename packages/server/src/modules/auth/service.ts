import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma.js";
import {
  generateRefreshToken,
  getRefreshTokenExpiry,
  hashPassword,
  hashRefreshToken,
  issueAccessToken,
  verifyPassword
} from "../../lib/tokens.js";
import { badRequest, conflict, unauthorized } from "../../lib/errors.js";
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput
} from "./schemas.js";

const userSelect = {
  id: true,
  email: true,
  name: true,
  createdAt: true
} satisfies Prisma.UserSelect;

type PublicUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;
type PrismaClientOrTransaction = typeof prisma | Prisma.TransactionClient;

export interface PublicUserDto {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: PublicUserDto;
}

const toPublicUser = (user: PublicUser): PublicUserDto => ({
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt.toISOString()
});

const issueTokenPair = async (
  user: PublicUser,
  client: PrismaClientOrTransaction = prisma
): Promise<IssuedTokens> => {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const refreshTokenExpiresAt = getRefreshTokenExpiry();

  await client.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshTokenHash,
      expiresAt: refreshTokenExpiresAt
    }
  });

  return {
    accessToken: await issueAccessToken(user.id),
    refreshToken,
    refreshTokenExpiresAt,
    user: toPublicUser(user)
  };
};

export const registerUser = async (
  input: RegisterInput
): Promise<IssuedTokens> => {
  try {
    const passwordHash = await hashPassword(input.password);

    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          ...(input.name !== undefined ? { name: input.name } : {})
        },
        select: userSelect
      });

      return issueTokenPair(user, tx);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("Email is already registered");
    }

    throw error;
  }
};

export const loginUser = async (input: LoginInput): Promise<IssuedTokens> => {
  const user = await prisma.user.findUnique({
    where: { email: input.email }
  });

  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw unauthorized("Invalid email or password");
  }

  return issueTokenPair({
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt
  });
};

export const getCurrentUser = async (userId: string): Promise<PublicUserDto> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect
  });

  if (!user) {
    throw unauthorized("Invalid access token");
  }

  return toPublicUser(user);
};

export const updateProfile = async (
  userId: string,
  input: UpdateProfileInput
): Promise<PublicUserDto> => {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { name: input.name },
      select: userSelect
    });

    return toPublicUser(user);
  } catch (error) {
    // Stale token for a since-deleted user → treat as invalid (like getCurrentUser)
    // rather than surfacing a 500.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw unauthorized("Invalid access token");
    }
    throw error;
  }
};

export const changePassword = async (
  userId: string,
  input: ChangePasswordInput
): Promise<IssuedTokens> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw unauthorized("Invalid access token");
  }
  // 400 (not 401) for a wrong current password: the caller is already
  // authenticated, and the dashboard's request() retries 401s through a token
  // refresh — which would be wrong here. (Verify-then-update isn't transactional,
  // but a concurrent self-change is benign: both attempts know the password.)
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw badRequest("Current password is incorrect");
  }
  // The schema rejects new === current as plaintext; also reject a new password
  // that actually matches the stored hash (e.g. differs only by what was typed).
  if (await verifyPassword(user.passwordHash, input.newPassword)) {
    throw badRequest("New password must differ from the current one");
  }

  const passwordHash = await hashPassword(input.newPassword);

  // Update the hash, revoke every existing session (so other devices are logged
  // out), and mint a fresh pair for the current session — all atomically.
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    return issueTokenPair(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt
      },
      tx
    );
  });
};

export const rotateRefreshToken = async (
  refreshToken: string
): Promise<IssuedTokens> => {
  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const existingToken = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: userSelect
        }
      }
    });

    if (!existingToken) {
      throw unauthorized("Invalid refresh token");
    }

    if (existingToken.revokedAt) {
      await tx.refreshToken.updateMany({
        where: {
          userId: existingToken.userId,
          revokedAt: null
        },
        data: {
          revokedAt: now
        }
      });

      return {
        status: "reused" as const
      };
    }

    if (existingToken.expiresAt <= now) {
      throw unauthorized("Invalid refresh token");
    }

    const nextRefreshToken = generateRefreshToken();
    const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken);
    const nextRefreshTokenExpiresAt = getRefreshTokenExpiry();

    await tx.refreshToken.create({
      data: {
        userId: existingToken.userId,
        tokenHash: nextRefreshTokenHash,
        expiresAt: nextRefreshTokenExpiresAt
      }
    });

    await tx.refreshToken.update({
      where: { id: existingToken.id },
      data: {
        revokedAt: now,
        replacedByTokenHash: nextRefreshTokenHash
      }
    });

    return {
      status: "rotated" as const,
      accessToken: await issueAccessToken(existingToken.userId),
      refreshToken: nextRefreshToken,
      refreshTokenExpiresAt: nextRefreshTokenExpiresAt,
      user: toPublicUser(existingToken.user)
    };
  });

  if (result.status === "reused") {
    throw unauthorized("Invalid refresh token");
  }

  return result;
};

export const revokeRefreshToken = async (
  refreshToken: string | undefined
): Promise<void> => {
  if (!refreshToken) {
    return;
  }

  await prisma.refreshToken.updateMany({
    where: {
      tokenHash: hashRefreshToken(refreshToken),
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
};
