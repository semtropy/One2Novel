/**
 * Post-Write Hooks — re-export layer for the deep PostWriteBus module.
 *
 * This file is intentionally thin. All handler registration and emission
 * logic lives in `postWriteBus.ts` where the interface is a single function
 * (`runPostWriteHooks`) and the implementation absorbs 10 handlers behind
 * the shared novelEventBus seam.
 *
 * This file re-exports for backward compatibility.
 */

export { runPostWriteHooks, registerPostWriteHandlers } from "./postWriteBus";
