# Agent model configuration — verified 10 September 2026

The failed production job used `claude-sonnet-5.6` because the ignored local `apps/kairos-worker/runner.env.bat`, line 12, explicitly set `KAIROS_COPILOT_DEFAULT_MODEL` to that value. The checked-in worker adapter and environment example already use `claude-sonnet-5`. The invalid local override has now been corrected to `claude-sonnet-5`; no other saved runner settings were changed.

## Model IDs and engines

An engine is the program executing the mission: Copilot CLI, Claude Code or Codex CLI. The model is the AI selected inside that program. Copilot supports multiple providers; selecting the Copilot engine does not imply an OpenAI model.

| Requested model | Exact model ID | Verification |
|---|---|---|
| Claude Sonnet 5 | `claude-sonnet-5` | Authenticated Copilot `models.list`; successful production research and report commit |
| GPT-5.6 Sol | `gpt-5.6-sol` | Authenticated Copilot `models.list` and installed Codex model catalog |
| GPT-5.6 Terra | `gpt-5.6-terra` | Authenticated Copilot `models.list` and installed Codex model catalog |
| GPT-5.6 Luna | `gpt-5.6-luna` | Authenticated Copilot `models.list` and installed Codex model catalog |

The UI catalog is a dated set of engine-specific choices, not a live entitlement check. Custom IDs remain available for private deployments and future models. Claude API/Claude Code IDs and Copilot IDs differ for some releases—for example, Haiku uses `claude-haiku-4-5-20251001` on the Claude API and `claude-haiku-4.5` in Copilot. They must not share a provider-agnostic ID list.

Model precedence in Aeon: explicit mission model → runner engine default → CLI default when Aeon supplies no default. Programmatic card configuration already accepts `metadata.hangar.model`; the worker passes it as `--model` (Copilot/Claude) or `-m` (Codex). REST and MCP require no protocol or package upgrade for those existing fields. No MCP connection was used to run these tests.

The [sanitized inventory](results/models-1009.json) records all 16 models available to this Copilot account. Run `node aeon_os/workflows/probe-copilot-models.mjs` to refresh it without generating a response. The workflow harness now checks this authenticated catalog before creating a card/session; an explicit negative check rejected `claude-sonnet-5.6` before any production writes. Copilot 1.0.83 reported itself as current, so no package upgrade was performed.

## Sources

- [Anthropic model IDs](https://platform.claude.com/docs/en/models/overview): Sonnet 5, Opus 5, Fable 5.1 and Haiku IDs.
- [OpenAI GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol): exact Sol ID; OpenAI also documents `gpt-5.6` as a Sol alias, but the explicit ID avoids ambiguity.
- [OpenAI model catalog](https://developers.openai.com/api/docs/models): current OpenAI family names and IDs.
- [GitHub supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models): public product/client availability; account policy can restrict it further.
- [Copilot programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference): `--model`, `/model` discovery and model precedence.

Installed binaries observed: Copilot CLI 1.0.83, Claude Code 2.1.267 and Codex CLI 0.153.4. Runtime test results are recorded separately in [verification.md](verification.md); a catalog entry is not a completed agent job.
