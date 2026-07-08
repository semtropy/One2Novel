/**
 * Context Block Builders — re-export layer for the deep ContextAssembler module.
 *
 * This file is intentionally thin. All assembly logic lives in
 * `contextAssembler.ts` where the interface is a single function
 * (`assembleChapterBlocks`) and the implementation absorbs 12+ module
 * dependencies behind one seam.
 *
 * This file re-exports for backward compatibility with existing callers.
 */

export {
  assembleChapterBlocks,
  assembleChapterContext,
  fetchAssemblyBase,
  type ChapterContext,
} from "./contextAssembler";
