/**
 * Prompt barrel — side-effect imports register all prompts into promptRegistry.
 * Imported by aiService.ts at startup; must come after promptRegistry definition.
 */
import "./planningPrompts";
import "./productionPrompts";
import "./postWritePrompts";
import "./timelinePrompts";
import "./payoffPrompts";
import "./referencePrompts";
import "./stylePrompts";
import "./worldPrompts";
