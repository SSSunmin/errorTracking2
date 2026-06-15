import { randomBytes } from "node:crypto";

import { Prisma, type Project, type ProjectKey } from "@prisma/client";

import { conflict, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { buildDsn } from "../keys/dsn.js";
import type {
  CreateProjectInput,
  CreateProjectKeyInput,
  UpdateProjectInput,
  UpdateProjectKeyInput
} from "./schemas.js";

interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  platform: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectListItemDto extends ProjectDto {
  keyCount: number;
}

interface ProjectKeyDto {
  id: string;
  projectId: string;
  publicKey: string;
  label: string | null;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  dsn: string;
}

const defaultPlatform = "javascript-browser";
const defaultKeyLabel = "Default DSN";
const maxProjectCreateAttempts = 5;

const toProjectDto = (project: Project): ProjectDto => ({
  id: project.id,
  name: project.name,
  slug: project.slug,
  platform: project.platform,
  createdAt: project.createdAt.toISOString(),
  updatedAt: project.updatedAt.toISOString()
});

const toProjectKeyDto = (key: ProjectKey): ProjectKeyDto => ({
  id: key.id,
  projectId: key.projectId,
  publicKey: key.publicKey,
  label: key.label,
  isActive: key.isActive,
  lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  createdAt: key.createdAt.toISOString(),
  dsn: buildDsn(key.publicKey, key.projectId)
});

const normalizeSlug = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized.length > 0 ? normalized : "project";
};

const randomPublicKey = (): string => randomBytes(16).toString("hex");

const isKnownPrismaError = (
  error: unknown
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError;

const prismaErrorTargetsField = (
  error: Prisma.PrismaClientKnownRequestError,
  field: string
): boolean => {
  const target = error.meta?.target;

  return Array.isArray(target)
    ? target.includes(field)
    : typeof target === "string" && target.includes(field);
};

const isSlugUniqueConstraintError = (error: unknown): boolean =>
  isKnownPrismaError(error) &&
  error.code === "P2002" &&
  prismaErrorTargetsField(error, "slug");

const isRecordNotFoundError = (error: unknown): boolean =>
  isKnownPrismaError(error) && error.code === "P2025";

const getUniqueSlug = async (baseValue: string): Promise<string> => {
  const baseSlug = normalizeSlug(baseValue);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const slug =
      attempt === 0 ? baseSlug : `${baseSlug}-${String(attempt + 1)}`;
    const existingProject = await prisma.project.findUnique({
      where: { slug },
      select: { id: true }
    });

    if (!existingProject) {
      return slug;
    }
  }

  return `${baseSlug}-${randomBytes(4).toString("hex")}`;
};

const getOwnedProject = async (
  projectId: string,
  ownerId: string
): Promise<Project> => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId
    }
  });

  if (!project) {
    throw notFound("Project not found");
  }

  return project;
};

const getOwnedProjectKey = async (
  projectId: string,
  ownerId: string,
  keyId: string
): Promise<ProjectKey> => {
  await getOwnedProject(projectId, ownerId);

  const key = await prisma.projectKey.findFirst({
    where: {
      id: keyId,
      projectId
    }
  });

  if (!key) {
    throw notFound("Project key not found");
  }

  return key;
};

export const listProjects = async (
  ownerId: string
): Promise<{ projects: ProjectListItemDto[] }> => {
  const projects = await prisma.project.findMany({
    where: { ownerId },
    include: {
      _count: {
        select: {
          keys: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return {
    projects: projects.map((project) => ({
      ...toProjectDto(project),
      keyCount: project._count.keys
    }))
  };
};

export const createProject = async (
  ownerId: string,
  input: CreateProjectInput
): Promise<{ project: ProjectDto; key: ProjectKeyDto; dsn: string }> => {
  for (let attempt = 0; attempt < maxProjectCreateAttempts; attempt += 1) {
    const slug = await getUniqueSlug(input.slug ?? input.name);

    try {
      const project = await prisma.project.create({
        data: {
          name: input.name,
          slug,
          platform: input.platform ?? defaultPlatform,
          ownerId,
          keys: {
            create: {
              publicKey: randomPublicKey(),
              label: defaultKeyLabel
            }
          }
        },
        include: {
          keys: {
            orderBy: { createdAt: "asc" },
            take: 1
          }
        }
      });

      const key = project.keys[0];
      if (!key) {
        throw new Error("Project key was not created");
      }

      const keyDto = toProjectKeyDto(key);

      return {
        project: toProjectDto(project),
        key: keyDto,
        dsn: keyDto.dsn
      };
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw conflict("Could not allocate a unique project slug");
};

export const getProject = async (
  ownerId: string,
  projectId: string
): Promise<{ project: ProjectDto }> => ({
  project: toProjectDto(await getOwnedProject(projectId, ownerId))
});

export const updateProject = async (
  ownerId: string,
  projectId: string,
  input: UpdateProjectInput
): Promise<{ project: ProjectDto }> => {
  try {
    const project = await prisma.project.update({
      where: {
        id: projectId,
        ownerId
      },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.platform !== undefined ? { platform: input.platform } : {})
      }
    });

    return {
      project: toProjectDto(project)
    };
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw notFound("Project not found");
    }

    throw error;
  }
};

export const deleteProject = async (
  ownerId: string,
  projectId: string
): Promise<void> => {
  try {
    await prisma.project.delete({
      where: {
        id: projectId,
        ownerId
      }
    });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw notFound("Project not found");
    }

    throw error;
  }
};

export const listProjectKeys = async (
  ownerId: string,
  projectId: string
): Promise<{ keys: ProjectKeyDto[] }> => {
  await getOwnedProject(projectId, ownerId);

  const keys = await prisma.projectKey.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" }
  });

  return {
    keys: keys.map(toProjectKeyDto)
  };
};

export const createProjectKey = async (
  ownerId: string,
  projectId: string,
  input: CreateProjectKeyInput
): Promise<{ key: ProjectKeyDto; dsn: string }> => {
  await getOwnedProject(projectId, ownerId);

  const key = await prisma.projectKey.create({
    data: {
      projectId,
      publicKey: randomPublicKey(),
      ...(input.label !== undefined ? { label: input.label } : {})
    }
  });

  const keyDto = toProjectKeyDto(key);

  return {
    key: keyDto,
    dsn: keyDto.dsn
  };
};

export const rotateProjectKey = async (
  ownerId: string,
  projectId: string,
  keyId: string
): Promise<{ key: ProjectKeyDto; dsn: string }> => {
  const oldKey = await getOwnedProjectKey(projectId, ownerId, keyId);

  const newKey = await prisma.$transaction(async (tx) => {
    await tx.projectKey.update({
      where: { id: oldKey.id },
      data: { isActive: false }
    });

    return tx.projectKey.create({
      data: {
        projectId,
        publicKey: randomPublicKey(),
        label: oldKey.label
      }
    });
  });

  const keyDto = toProjectKeyDto(newKey);

  return {
    key: keyDto,
    dsn: keyDto.dsn
  };
};

export const updateProjectKey = async (
  ownerId: string,
  projectId: string,
  keyId: string,
  input: UpdateProjectKeyInput
): Promise<{ key: ProjectKeyDto; dsn: string }> => {
  try {
    const key = await prisma.projectKey.update({
      where: {
        id: keyId,
        projectId,
        project: {
          ownerId
        }
      },
      data: {
        isActive: input.isActive
      }
    });

    const keyDto = toProjectKeyDto(key);

    return {
      key: keyDto,
      dsn: keyDto.dsn
    };
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw notFound("Project key not found");
    }

    throw error;
  }
};
