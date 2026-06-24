import { Prisma, type ProjectRole } from "@prisma/client";

import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import type { AddMemberInput, UpdateMemberInput } from "./schemas.js";

interface ProjectMemberDto {
  userId: string;
  email: string;
  name: string | null;
  role: ProjectRole;
  createdAt: string;
}

// Membership-based read access: any member may view the member list. Returns the
// project's ownerId so callers needn't re-query.
const ensureMember = async (
  userId: string,
  projectId: string
): Promise<{ ownerId: string }> => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, members: { some: { userId } } },
    select: { ownerId: true }
  });

  if (!project) {
    throw notFound("Project not found");
  }

  return project;
};

// Member-management access: the caller must be an OWNER-role member. Non-members
// get notFound (don't leak existence); plain members get forbidden. Returns the
// project's founder id (Project.ownerId), which is immutable (no endpoint changes
// it) and used by callers to protect the founder from demotion/removal.
const ensureProjectAdmin = async (
  userId: string,
  projectId: string
): Promise<{ ownerId: string }> => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, members: { some: { userId } } },
    select: {
      ownerId: true,
      members: { where: { userId }, select: { role: true } }
    }
  });

  if (!project) {
    throw notFound("Project not found");
  }
  if (project.members[0]?.role !== "owner") {
    throw forbidden("Only project owners can manage members");
  }

  return { ownerId: project.ownerId };
};

export const listMembers = async (
  userId: string,
  projectId: string
): Promise<{ members: ProjectMemberDto[] }> => {
  await ensureMember(userId, projectId);

  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: "asc" }
  });

  return {
    members: members.map((member) => ({
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
      createdAt: member.createdAt.toISOString()
    }))
  };
};

export const addMember = async (
  userId: string,
  projectId: string,
  input: AddMemberInput
): Promise<{ member: ProjectMemberDto }> => {
  await ensureProjectAdmin(userId, projectId);

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true }
  });

  if (!user) {
    throw notFound("User not found");
  }

  try {
    const member = await prisma.projectMember.create({
      data: {
        projectId,
        userId: user.id,
        role: input.role ?? "member"
      }
    });

    return {
      member: {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: member.role,
        createdAt: member.createdAt.toISOString()
      }
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw conflict("User is already a member of this project");
    }

    throw error;
  }
};

export const updateMemberRole = async (
  userId: string,
  projectId: string,
  targetUserId: string,
  input: UpdateMemberInput
): Promise<{ member: ProjectMemberDto }> => {
  // The founder (Project.ownerId) is always an owner-role member and may not be
  // demoted; ensureProjectAdmin returns it so we needn't re-query.
  const { ownerId } = await ensureProjectAdmin(userId, projectId);
  if (targetUserId === ownerId && input.role !== "owner") {
    throw badRequest("The project owner's role cannot be changed");
  }

  try {
    const member = await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      data: { role: input.role },
      include: { user: { select: { email: true, name: true } } }
    });

    return {
      member: {
        userId: member.userId,
        email: member.user.email,
        name: member.user.name,
        role: member.role,
        createdAt: member.createdAt.toISOString()
      }
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw notFound("Member not found");
    }

    throw error;
  }
};

export const removeMember = async (
  userId: string,
  projectId: string,
  targetUserId: string
): Promise<void> => {
  // The founder (Project.ownerId) may not be removed; ensureProjectAdmin returns
  // it so we needn't re-query.
  const { ownerId } = await ensureProjectAdmin(userId, projectId);
  if (targetUserId === ownerId) {
    throw badRequest("The project owner cannot be removed");
  }

  try {
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId: targetUserId } }
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw notFound("Member not found");
    }

    throw error;
  }
};
