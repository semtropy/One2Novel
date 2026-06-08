/**
 * Relationship Graph Service — asymmetric character relationships.
 * ADAPTED from OP CharacterDynamicsService (1922 lines).
 */
import { getPrisma } from "../../../../platform/db/client";

export interface RelationEdge {
  id: string;
  sourceId: string; targetId: string;
  type: string;
  attitudeSource: string | null; attitudeTarget: string | null;
  stage: string | null; currentTension: string | null;
  volumePresence: Record<string, string> | null;
  sourceName: string; targetName: string;
}

export interface RelationshipGraph {
  nodes: Array<{ id: string; name: string; role: string }>;
  edges: RelationEdge[];
}

export async function getGraph(novelId: string): Promise<RelationshipGraph> {
  const prisma = getPrisma();
  const [characters, relations] = await Promise.all([
    prisma.novelCharacter.findMany({ where: { novelId }, select: { id: true, name: true, role: true } }),
    prisma.novelCharacterRelation.findMany({
      where: { novelId },
      include: { sourceCharacter: { select: { name: true } }, targetCharacter: { select: { name: true } } },
    }),
  ]);

  return {
    nodes: characters.map(c => ({ id: c.id, name: c.name, role: c.role })),
    edges: relations.map(r => ({
      id: r.id, sourceId: r.sourceCharacterId, targetId: r.targetCharacterId,
      type: r.type, attitudeSource: r.attitudeSource, attitudeTarget: r.attitudeTarget,
      stage: r.stage, currentTension: r.currentTension,
      volumePresence: r.volumePresence ? JSON.parse(r.volumePresence) : null,
      sourceName: r.sourceCharacter.name, targetName: r.targetCharacter.name,
    })),
  };
}

export async function upsertRelation(data: {
  novelId: string; sourceCharacterId: string; targetCharacterId: string;
  type: string; attitudeSource?: string; attitudeTarget?: string;
  stage?: string; currentTension?: string; summary?: string;
}) {
  const prisma = getPrisma();
  const existing = await prisma.novelCharacterRelation.findFirst({
    where: { novelId: data.novelId, sourceCharacterId: data.sourceCharacterId, targetCharacterId: data.targetCharacterId },
  });
  if (existing) {
    return prisma.novelCharacterRelation.update({ where: { id: existing.id }, data });
  }
  return prisma.novelCharacterRelation.create({ data });
}

export async function deleteRelation(id: string) {
  return getPrisma().novelCharacterRelation.delete({ where: { id } });
}

export async function getCharacterRelationships(characterId: string) {
  const prisma = getPrisma();
  const [outgoing, incoming] = await Promise.all([
    prisma.novelCharacterRelation.findMany({
      where: { sourceCharacterId: characterId },
      include: { targetCharacter: { select: { name: true } } },
    }),
    prisma.novelCharacterRelation.findMany({
      where: { targetCharacterId: characterId },
      include: { sourceCharacter: { select: { name: true } } },
    }),
  ]);
  return { outgoing, incoming };
}
