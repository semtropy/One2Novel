/**
 * Commit Router — determines which projection writers to run
 * based on the commit's extraction result.
 *
 * Phase 3: Runs all 5 writers for every accepted commit.
 * Phase 4: Selective routing based on event types.
 */

import {
  EVENT_WRITER_MAP,
  ALWAYS_RUN_WRITERS,
  type ProjectionWriterName,
  type EventType,
} from './projectionTypes';

/**
 * Determine which writers to run for a commit.
 *
 * Phase 3 (simple): always returns all 5 writers.
 * Phase 4 (granular): inspects event types from extractionResult
 * and returns only the writers that need them.
 */
export function determineRequiredWriters(
  extractionResult?: Record<string, unknown> | null,
): ProjectionWriterName[] {
  // Phase 3: run all writers
  return ['state', 'index', 'summary', 'memory', 'vector'];
}

/**
 * Extract event types from extractionResult.
 * Returns empty array if no events found.
 */
export function extractEventTypes(
  extractionResult?: Record<string, unknown> | null,
): EventType[] {
  if (!extractionResult) return [];

  const acceptedEvents = extractionResult.accepted_events as Array<{ type?: string }> | undefined;
  if (!acceptedEvents) return [];

  // Normalize event type aliases to canonical types
  const canonicalTypes = new Set<EventType>();
  for (const evt of acceptedEvents) {
    const type = evt.type;
    if (!type) continue;

    // Map common aliases to canonical types
    const aliased = EVENT_TYPE_ALIASES[type] ?? type;
    if (aliased in EVENT_WRITER_MAP) {
      canonicalTypes.add(aliased as EventType);
    }
  }

  return [...canonicalTypes];
}

/**
 * Event type alias mapping (adapted from wNW).
 */
const EVENT_TYPE_ALIASES: Record<string, string> = {
  breakthrough: 'character_state_change',
  power_breakthrough: 'character_state_change',
  level_up: 'character_state_change',
  relationship_changed: 'relationship_change',
  new_friend: 'new_relationship',
  new_enemy: 'new_relationship',
  world_rule_revealed: 'world_rule_update',
  world_rule_broken: 'world_rule_update',
  open_loop_created: 'payoff_set_up',
  open_loop_closed: 'payoff_paid',
  promise_created: 'payoff_set_up',
  promise_paid_off: 'payoff_paid',
  artifact_obtained: 'location_change',
  appeared: 'new_entity_appeared',
  departed: 'entity_departed',
  died: 'character_death',
  revived: 'character_revival',
};

/**
 * Get the set of writer names required for given event types.
 * Always includes the always-run writers.
 */
export function getRequiredWritersFromEvents(
  eventTypes: EventType[],
): Set<ProjectionWriterName> {
  const writers = new Set<ProjectionWriterName>(ALWAYS_RUN_WRITERS as ProjectionWriterName[]);

  for (const eventType of eventTypes) {
    const required = EVENT_WRITER_MAP[eventType];
    if (required) {
      for (const w of required) {
        writers.add(w as ProjectionWriterName);
      }
    }
  }

  return writers;
}
