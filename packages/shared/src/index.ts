export * from './markets.js'
export * from './locale.js'
export * from './messages.js'
export * from './pricing.js'
export * from './types.js'
export * from './brand.js'
export * from './text.js'
export * from './money.js'
export * from './hash.js'

/** Bumped whenever observation, diff or report logic changes shape. */
export const HARNESS_VERSION = '0.1.0'

/** Reproducibility floor from SPEC 4.4. Below this a surface is not observable. */
export const REPRODUCIBILITY_THRESHOLD = 0.8
