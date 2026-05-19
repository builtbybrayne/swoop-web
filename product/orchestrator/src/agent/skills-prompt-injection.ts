/**
 * Manual replication of ADK's SkillToolset prompt-injection contract.
 *
 * ## Why this file exists
 *
 * ADK's `SkillToolset` has a `processLlmRequest` method that's *meant* to
 * inject two things into every LLM request:
 *
 *   1. A `DEFAULT_SKILL_SYSTEM_INSTRUCTION` text telling the model it
 *      MUST call `load_skill` when a description matches.
 *   2. The `<available_skills>` XML block listing every skill's name +
 *      description as recognition signals.
 *
 * In practice, that injection **never fires** for our agent. ADK's
 * `LlmAgent` (see `node_modules/@google/adk/dist/cjs/agents/llm_agent.js`
 * around the `convertToolUnionToTools` call) flattens toolsets down to
 * their constituent child tools *before* calling `processLlmRequest`.
 * The 5 skill child tools (list_skills / load_skill / etc.) inherit
 * BaseTool's no-op processLlmRequest. The SkillToolset's own override
 * is dead code in ADK's pipeline.
 *
 * Result: Sonnet only sees the 5 meta-tools with their bland generic
 * descriptions; the framework's "you MUST use load_skill" guidance and
 * the skills-XML index never reach the model.
 *
 * This module replicates both pieces locally so we can prepend / append
 * them in our InstructionProvider — see `factory.ts`. Verbatim copies
 * (with attribution comments) of the strings/functions in:
 *   - `node_modules/@google/adk/dist/cjs/tools/skill/skill_toolset.js`
 *     (DEFAULT_SKILL_SYSTEM_INSTRUCTION)
 *   - `node_modules/@google/adk/dist/cjs/skills/prompt.js`
 *     (formatSkillsAsXml + escapeHtml)
 *
 * Neither symbol is exported from `@google/adk`'s public surface, so we
 * can't re-use them. If ADK ever fixes the toolset pipeline OR exports
 * these helpers, this file becomes dead code — delete it.
 *
 * See also: gotchas.md → "ADK SkillToolset.processLlmRequest never fires".
 */

import type { Skill } from '@google/adk';

/**
 * Verbatim copy of ADK's `DEFAULT_SKILL_SYSTEM_INSTRUCTION` constant from
 * `tools/skill/skill_toolset.js` (Apache-2.0 licensed; same module is in
 * `node_modules/@google/adk`). Telling the model what skills are and how
 * to use them via the 5 meta-tools.
 */
const DEFAULT_SKILL_SYSTEM_INSTRUCTION = `You can use specialized 'skills' to help you with complex tasks. You MUST use the skill tools to interact with these skills.

Skills are folders of instructions and resources that extend your capabilities for specialized tasks. Each skill folder contains:
- **SKILL.md** (required): The main instruction file with skill metadata and detailed markdown instructions.
- **references/** (Optional): Additional documentation or examples for skill usage.
- **assets/** (Optional): Templates, scripts or other resources used by the skill.
- **scripts/** (Optional): Executable scripts that can be run via bash.

This is very important:

1. If a skill seems relevant to the current user query, you MUST use the \`load_skill\` tool with \`name="<SKILL_NAME>"\` to read its full instructions before proceeding.
2. Once you have read the instructions, follow them exactly as documented before replying to the user. For example, If the instruction lists multiple steps, please make sure you complete all of them in order.
3. The \`load_skill_resource\` tool is for viewing files within a skill's directory (e.g., \`references/*\`, \`assets/*\`, \`scripts/*\`). Do NOT use other tools to access these files.
4. Use \`run_skill_script\` to run scripts from a skill's \`scripts/\` directory. Use \`load_skill_resource\` to view script content first if needed.
`;

/**
 * Verbatim copy of ADK's `escapeHtml` helper from `skills/prompt.js`.
 *
 * Intentionally NOT consolidated to the `he` dep used elsewhere in the
 * codebase (ingestion/chunk.ts, ui/widgets/text-utils.ts, harness/view-
 * transcript.ts). This module's whole purpose is to reproduce what ADK
 * *would* have emitted via SkillToolset.processLlmRequest if the
 * framework's pipeline hadn't dropped it (see file header + gotchas.md).
 * Swapping in `he.encode` would change the exact byte sequence Sonnet
 * sees in the `<available_skills>` block — possibly subtly different
 * named references / numeric ranges. We hold the wire-format invariant
 * here even though it duplicates the encoder dep. If ADK ever ships
 * their own helpers as named exports, replace this with their actual
 * impl; do not switch to `he`.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Verbatim port of ADK's `formatSkillsAsXml` from `skills/prompt.js`.
 * Produces the `<available_skills>...</available_skills>` block listing
 * each skill's name + description (recognition signal). Bodies are NOT
 * included here — that's what the optional appendix below covers.
 */
function formatSkillsAsXml(skills: readonly Skill[]): string {
  if (!skills || skills.length === 0) {
    return '<available_skills>\n</available_skills>';
  }
  const lines: string[] = ['<available_skills>'];
  for (const item of skills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeHtml(item.frontmatter.name)}</name>`);
    lines.push(
      `    <description>${escapeHtml(item.frontmatter.description)}</description>`,
    );
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

/**
 * Renders every skill's body as a single appendix block. Used only when
 * `PRELOAD_SKILL_BODIES=true` (see config schema). Bypasses the
 * list_skills/load_skill dance entirely — Sonnet sees every pattern's
 * full instructions in the system prompt regardless of whether it would
 * have called the load tool.
 *
 * Each skill renders as:
 *
 *     ### Skill: <name>
 *
 *     <description>
 *
 *     <body>
 *
 * with `\n\n---\n\n` between skills. Wrapped in a header so the model
 * can tell the appendix apart from the main brief.
 */
function formatSkillBodiesAppendix(skills: readonly Skill[]): string {
  if (!skills || skills.length === 0) {
    return '';
  }
  const sections = skills.map((skill) => {
    const { name, description } = skill.frontmatter;
    return [
      `### Skill: ${name}`,
      '',
      description,
      '',
      skill.instructions.trim(),
    ].join('\n');
  });
  return [
    '## Appendix: skill bodies (preloaded)',
    '',
    'The full body of every skill listed in `<available_skills>` above is included here for direct reference. You do not need to call `load_skill` — every pattern is already in your context. Treat each section as you would the loaded output of `load_skill(name="<skill-name>")`.',
    '',
    sections.join('\n\n---\n\n'),
  ].join('\n');
}

export interface BuildSkillsInjectionOptions {
  /** When true, append every skill body as a final appendix block. */
  readonly includeBodies: boolean;
}

/**
 * Build the skills-prompt injection string. Concatenates (in order):
 *
 *   1. The ADK `DEFAULT_SKILL_SYSTEM_INSTRUCTION` text.
 *   2. The `<available_skills>` XML block of names + descriptions.
 *   3. (Optional) The full skill-body appendix.
 *
 * Sections are separated by `\n\n---\n\n` — same separator as the
 * `system/` prompt-fragment loader, so the joined result reads as one
 * continuous brief to the model.
 *
 * Caller is responsible for placing the returned string after the main
 * `system/` prompt content (see `factory.ts`).
 */
export function buildSkillsPromptInjection(
  skills: readonly Skill[],
  options: BuildSkillsInjectionOptions,
): string {
  const parts: string[] = [DEFAULT_SKILL_SYSTEM_INSTRUCTION.trim(), formatSkillsAsXml(skills)];
  if (options.includeBodies) {
    const bodies = formatSkillBodiesAppendix(skills);
    if (bodies) {
      parts.push(bodies);
    }
  }
  return parts.join('\n\n---\n\n');
}
