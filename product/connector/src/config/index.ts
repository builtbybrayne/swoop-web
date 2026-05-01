/**
 * Public config surface for @swoop/connector.
 *
 * See ./schema.ts for the env-var contract and ./load.ts for the parser.
 */

export { loadConfig } from './load.js';
export { configSchema, PACKAGE_ROOT, type Config, type RawConfig } from './schema.js';
