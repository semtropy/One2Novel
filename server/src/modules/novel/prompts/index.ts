/**
 * Prompt barrel — side-effect imports register all prompts into promptRegistry.
 * Imported by app.ts at startup (after aiService.ts is fully initialized).
 */
import "./planningPrompts";
import "./productionPrompts";
import "./postWritePrompts";
import "./timelinePrompts";
import "./payoffPrompts";
import "./referencePrompts";
// stylePrompts removed — style extraction now uses reference.writing_assets.extract (richer struct)
import "./worldPrompts";
