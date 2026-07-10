/**
 * Projection Types — shared interfaces for the commit + projection system.
 */

export interface ProjectionResult {
  success: boolean;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsOutdated: number;
  error?: string;
}

export interface ProjectionWriter {
  name: string;
  run(commitId: string, novelId: string, chapterId: string, chapterOrder: number, content?: string, extractionResult?: Record<string, unknown>): Promise<ProjectionResult>;
}

export type EventType =
  | 'character_state_change'
  | 'character_death'
  | 'character_revival'
  | 'new_relationship'
  | 'relationship_change'
  | 'world_rule_update'
  | 'payoff_set_up'
  | 'payoff_paid'
  | 'location_change'
  | 'goal_change'
  | 'new_entity_appeared'
  | 'entity_departed';

/** Maps event types to the writers that need them */
export const EVENT_WRITER_MAP: Record<EventType, string[]> = {
  character_state_change: ['state', 'memory', 'vector'],
  character_death: ['state', 'memory', 'vector'],
  character_revival: ['state', 'memory', 'vector'],
  new_relationship: ['state', 'vector'],
  relationship_change: ['state', 'vector'],
  world_rule_update: ['memory', 'vector'],
  payoff_set_up: ['memory', 'vector'],
  payoff_paid: ['memory', 'vector'],
  location_change: ['state', 'vector'],
  goal_change: ['state', 'vector'],
  new_entity_appeared: ['state', 'vector'],
  entity_departed: ['state', 'vector'],
};

/** Writers that always run for any completed chapter */
export const ALWAYS_RUN_WRITERS = ['summary', 'vector'];

export type ProjectionWriterName = 'state' | 'index' | 'summary' | 'memory' | 'vector';
