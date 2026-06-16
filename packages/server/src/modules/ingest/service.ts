import { unauthorized } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

const invalidProjectKeyMessage = "Invalid project key";

export const validateProjectKey = async (
  projectId: string,
  publicKey: string
): Promise<void> => {
  const projectKey = await prisma.projectKey.findUnique({
    where: {
      publicKey
    },
    select: {
      id: true,
      projectId: true,
      isActive: true
    }
  });

  if (!projectKey) {
    throw unauthorized(invalidProjectKeyMessage);
  }

  if (projectKey.projectId !== projectId || !projectKey.isActive) {
    throw unauthorized(invalidProjectKeyMessage);
  }
};

export const markProjectKeyUsed = async (publicKey: string): Promise<void> => {
  await prisma.projectKey.update({
    where: { publicKey },
    data: {
      lastUsedAt: new Date()
    }
  });
};
