import { randomBytes } from "node:crypto";

import { Prisma, type Project, type ProjectKey } from "@prisma/client";

import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { buildDsn } from "../keys/dsn.js";
import type {
  CreateProjectInput,
  CreateProjectKeyInput,
  ProjectStatsQuery,
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

interface ProjectOverviewDto {
  projectId: string;
  events: number;
  openIssues: number;
  lastEventAt: string | null;
  buckets: { bucket: string; count: number }[];
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

// Membership-based access: `ownerId` is the current user id; any project member
// (owner or member role) may read/write the project. Returns notFound for
// non-members so existence isn't leaked.
const getOwnedProject = async (
  projectId: string,
  ownerId: string
): Promise<Project> => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      members: { some: { userId: ownerId } }
    }
  });

  if (!project) {
    throw notFound("Project not found");
  }

  return project;
};

// Owner-role access: the caller must be an OWNER-role member. Non-members get
// notFound (don't leak existence); plain members get forbidden. Used for project
// settings and DSN key management — consistent with member management
// (ensureProjectAdmin).
const getAdminProject = async (
  projectId: string,
  ownerId: string
): Promise<Project> => {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: ownerId } },
    select: { role: true }
  });

  if (!membership) {
    throw notFound("Project not found");
  }
  if (membership.role !== "owner") {
    throw forbidden("Only project owners can modify this project");
  }

  return getOwnedProject(projectId, ownerId);
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
    // Every project the current user is a member of (owner role included).
    where: { members: { some: { userId: ownerId } } },
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
          members: {
            create: {
              userId: ownerId,
              role: "owner"
            }
          },
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

export const getProjectsOverview = async (
  ownerId: string,
  query: ProjectStatsQuery
): Promise<{ projects: ProjectOverviewDto[] }> => {
  const projects = await prisma.project.findMany({
    where: { members: { some: { userId: ownerId } } },
    select: { id: true },
    orderBy: { createdAt: "desc" }
  });

  if (projects.length === 0) {
    return { projects: [] };
  }

  const projectIds = projects.map((project) => project.id);
  const now = new Date();
  const windowMs =
    query.window === "24h" ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
  const since = new Date(now.getTime() - windowMs);
  const truncUnit = query.window === "24h" ? "hour" : "day";

  const [eventRows, lastEventRows, issueRows] = await Promise.all([
    prisma.$queryRaw<{ projectId: string; bucket: Date; count: bigint }[]>`
      SELECT "projectId",
        date_trunc(${truncUnit}, "receivedAt") AS bucket,
        COUNT(*)::bigint AS count
      FROM "Event"
      WHERE "projectId" IN (${Prisma.join(projectIds)})
        AND "receivedAt" >= ${since}
      GROUP BY "projectId", bucket
      ORDER BY bucket ASC
    `,
    prisma.$queryRaw<{ projectId: string; lastEventAt: Date | null }[]>`
      SELECT "projectId", MAX("receivedAt") AS "lastEventAt"
      FROM "Event"
      WHERE "projectId" IN (${Prisma.join(projectIds)})
      GROUP BY "projectId"
    `,
    prisma.issue.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: projectIds },
        status: "unresolved"
      },
      _count: { _all: true }
    })
  ]);

  const eventsByProject = new Map<
    string,
    { events: number; buckets: { bucket: string; count: number }[] }
  >();
  for (const row of eventRows) {
    const count = Number(row.count);
    const current = eventsByProject.get(row.projectId) ?? {
      events: 0,
      buckets: []
    };
    current.events += count;
    current.buckets.push({
      bucket: row.bucket.toISOString(),
      count
    });
    eventsByProject.set(row.projectId, current);
  }

  const lastEventByProject = new Map(
    lastEventRows.map((row) => [
      row.projectId,
      // GROUP BY only yields rows for projects that have events, so MAX is
      // non-null in practice; guard anyway since the type allows null.
      row.lastEventAt ? row.lastEventAt.toISOString() : null
    ])
  );
  const openIssuesByProject = new Map(
    issueRows.map((row) => [row.projectId, row._count._all])
  );

  return {
    projects: projects.map((project) => {
      const eventSummary = eventsByProject.get(project.id);
      return {
        projectId: project.id,
        events: eventSummary?.events ?? 0,
        openIssues: openIssuesByProject.get(project.id) ?? 0,
        lastEventAt: lastEventByProject.get(project.id) ?? null,
        buckets: eventSummary?.buckets ?? []
      };
    })
  };
};

export const getProjectStats = async (
  ownerId: string,
  projectId: string,
  query: ProjectStatsQuery
): Promise<{
  buckets: { bucket: string; count: number; users: number }[];
  totalEvents: number;
  affectedUsers: number;
}> => {
  // Ownership check (404 when not owned), same pattern as getProject.
  await getOwnedProject(projectId, ownerId);

  const now = new Date();
  const windowMs =
    query.window === "24h" ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
  const since = new Date(now.getTime() - windowMs);
  const truncUnit = query.window === "24h" ? "hour" : "day";

  // Bucketed counts + distinct affected users per bucket over the whole
  // project's events in the window. The affected-user identity key falls back
  // id → email → username, so a user the SDK identifies only by email/username
  // still counts (Sentry's user-identifier precedence). NULLIF treats a blank
  // string as absent so an empty id (`{id:""}`) falls through to email/username.
  // COUNT(DISTINCT …) ignores rows where all three are null. Limitation: the same
  // person seen once with an id and once with only an email counts twice — there
  // is no cross-key identity resolution.
  const rows = await prisma.$queryRaw<
    { bucket: Date; count: bigint; users: bigint }[]
  >`
    SELECT date_trunc(${truncUnit}, "receivedAt") AS bucket,
      COUNT(*)::bigint AS count,
      COUNT(DISTINCT COALESCE(NULLIF("userContext"->>'id', ''), NULLIF("userContext"->>'email', ''), NULLIF("userContext"->>'username', '')))::bigint AS users
    FROM "Event"
    WHERE "projectId" = ${projectId}
      AND "receivedAt" >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  // Distinct affected users over the window, same id → email → username key.
  const userRows = await prisma.$queryRaw<{ users: bigint }[]>`
    SELECT COUNT(DISTINCT COALESCE(NULLIF("userContext"->>'id', ''), NULLIF("userContext"->>'email', ''), NULLIF("userContext"->>'username', '')))::bigint AS users
    FROM "Event"
    WHERE "projectId" = ${projectId}
      AND "receivedAt" >= ${since}
  `;

  const buckets = rows.map((row) => ({
    bucket: row.bucket.toISOString(),
    count: Number(row.count),
    users: Number(row.users)
  }));

  return {
    buckets,
    // Derive from the buckets so totalEvents and the chart never disagree
    // (no second COUNT(*) that could race a concurrent insert).
    totalEvents: buckets.reduce((sum, b) => sum + b.count, 0),
    affectedUsers: Number(userRows[0]?.users ?? 0)
  };
};

export const getProjectEnvironmentStats = async (
  ownerId: string,
  projectId: string,
  query: ProjectStatsQuery
): Promise<{
  environments: {
    environment: string | null;
    events: number;
    issues: number;
    affectedUsers: number;
  }[];
}> => {
  // Ownership check (404 when not owned), same pattern as getProjectStats.
  await getOwnedProject(projectId, ownerId);

  const now = new Date();
  const windowMs =
    query.window === "24h" ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
  const since = new Date(now.getTime() - windowMs);

  // Per-environment rollup over the window: event volume, distinct issues, and
  // distinct affected users (same id → email → username fallback key as the
  // time-bucket stats). GROUP BY collapses NULL environments into a single row
  // (events the SDK sent untagged); it is returned as `environment: null`.
  // Busiest environment first; ties broken by name (the null row sorts last) for
  // a deterministic order — NULLS LAST is made explicit so it never depends on a
  // server default.
  const rows = await prisma.$queryRaw<
    { environment: string | null; events: bigint; issues: bigint; users: bigint }[]
  >`
    SELECT "environment" AS environment,
      COUNT(*)::bigint AS events,
      COUNT(DISTINCT "issueId")::bigint AS issues,
      COUNT(DISTINCT COALESCE(NULLIF("userContext"->>'id', ''), NULLIF("userContext"->>'email', ''), NULLIF("userContext"->>'username', '')))::bigint AS users
    FROM "Event"
    WHERE "projectId" = ${projectId}
      AND "receivedAt" >= ${since}
    GROUP BY "environment"
    ORDER BY events DESC, "environment" ASC NULLS LAST
  `;

  return {
    environments: rows.map((row) => ({
      environment: row.environment,
      events: Number(row.events),
      issues: Number(row.issues),
      affectedUsers: Number(row.users)
    }))
  };
};

interface ClientStat {
  name: string;
  events: number;
  issues: number;
  affectedUsers: number;
}

// Bucket for browser/OS names that weren't parsed (non-browser clients like
// curl/node, or events ingested before UA enrichment / with no User-Agent).
const UA_UNKNOWN = "알 수 없음";

// One browser- or OS-name distribution over the window. We aggregate the names
// the ingest pipeline already parsed from each request's User-Agent (ua-parser-js
// → contexts.{browser,os}.name in enrich.ts), so the chart matches the event
// detail exactly and needs no read-time re-parsing. Pure SQL GROUP BY → one row
// per distinct name; NULL collapses into "알 수 없음". `dimension` is a literal
// 'browser'|'os' bound as a parameter (the JSON key), never user input.
const clientDistribution = (
  projectId: string,
  since: Date,
  dimension: "browser" | "os"
): Promise<{ name: string; events: bigint; issues: bigint; users: bigint }[]> =>
  prisma.$queryRaw`
    SELECT COALESCE("contexts"->${dimension}->>'name', ${UA_UNKNOWN}) AS name,
      COUNT(*)::bigint AS events,
      COUNT(DISTINCT "issueId")::bigint AS issues,
      COUNT(DISTINCT COALESCE(NULLIF("userContext"->>'id', ''), NULLIF("userContext"->>'email', ''), NULLIF("userContext"->>'username', '')))::bigint AS users
    FROM "Event"
    WHERE "projectId" = ${projectId}
      AND "receivedAt" >= ${since}
    GROUP BY 1
    ORDER BY events DESC, name ASC
  `;

const toClientStats = (
  rows: { name: string; events: bigint; issues: bigint; users: bigint }[]
): ClientStat[] =>
  rows.map((row) => ({
    name: row.name,
    events: Number(row.events),
    issues: Number(row.issues),
    affectedUsers: Number(row.users)
  }));

export const getProjectClientStats = async (
  ownerId: string,
  projectId: string,
  query: ProjectStatsQuery
): Promise<{ browsers: ClientStat[]; os: ClientStat[] }> => {
  await getOwnedProject(projectId, ownerId);

  const now = new Date();
  const windowMs =
    query.window === "24h" ? 24 * 60 * 60 * 1_000 : 7 * 24 * 60 * 60 * 1_000;
  const since = new Date(now.getTime() - windowMs);

  const [browsers, os] = await Promise.all([
    clientDistribution(projectId, since, "browser"),
    clientDistribution(projectId, since, "os")
  ]);

  return { browsers: toClientStats(browsers), os: toClientStats(os) };
};

export const updateProject = async (
  ownerId: string,
  projectId: string,
  input: UpdateProjectInput
): Promise<{ project: ProjectDto }> => {
  // Owner-role only; prove the caller is an owner first, then update by id
  // (Prisma's update `where` can't take a relation filter).
  await getAdminProject(projectId, ownerId);

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.platform !== undefined ? { platform: input.platform } : {})
    }
  });

  return {
    project: toProjectDto(project)
  };
};

export const deleteProject = async (
  ownerId: string,
  projectId: string
): Promise<void> => {
  // Founder-only: any member sees the project (getOwnedProject → 404 for
  // non-members), but only Project.ownerId may delete it (403 for other members)
  // — consistent with GET returning 200 for the same member.
  const project = await getOwnedProject(projectId, ownerId);
  if (project.ownerId !== ownerId) {
    throw forbidden("Only the project owner can delete this project");
  }

  try {
    await prisma.project.delete({
      where: { id: projectId }
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
  // Owner-role only: DSN keys are SDK credentials.
  await getAdminProject(projectId, ownerId);

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
  // Owner-role only: rotation deactivates the existing DSN credential.
  await getAdminProject(projectId, ownerId);
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
  // Owner-role only; prove the caller is an owner, then update by id + project.
  await getAdminProject(projectId, ownerId);

  try {
    const key = await prisma.projectKey.update({
      where: {
        id: keyId,
        projectId
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
