# Lane C: how to make Kairos's memory work like a conscience (state of the art 2025–2026, and gaps)

**Answer:** There is no evidence that a machine conscience needs something that feels like guilt, or a single "self". What does have evidence is a loop of plain mechanisms: (a) written norms, (b) a monitor that checks the agent's actions or reasoning against those norms, (c) a durable record of violations ("lessons") that gets consulted before acting again, and (d) belief revision that knows which beliefs depend on which. Kairos 0.13 already has (a), part of (b) through its drift probes and weekly review, and human approval of changes. Its likely biggest gaps:

1. **No dependency tracking.** If a source or belief is retracted, the beliefs that rest on it are not looked at again.
2. **Self-laundering.** Kairos's own summaries and inferences can end up counted as "independent evidence" for its own mind. It also uses the same kind of model to check that evidence, and models of that kind are known to favour their own output.
3. **No trust fixed at write time.** Ingested content (email, web, tool output) doesn't carry a trust level from the moment it is stored. 2026 work shows that checking the content, or checking its history, can be bypassed by laundering it through summaries.
4. **No precedent or lessons memory.** Mistakes the operator flagged are not kept as cases linked to the constitution clause they broke.
5. **Measurement only tests stability.** It catches drift but not sycophancy, contradictions or overconfidence.

**Confidence:** medium-high on the mechanisms and attacks (peer-reviewed or arXiv primary sources). Low-medium on any claim that they produce a "conscience", because no 2024–2026 paper shows end-to-end that a whole guilt-and-repair loop works.

**Assumptions:**
- From the brief, Kairos stores provenance ids per belief, but there are no links between beliefs that support each other, and nothing cascades when one is retracted. If those links already exist, gap 1 shrinks to "add the re-check job".
- Source tiers follow the parent's scheme: 1 = paper, official docs or repo; 2 = reputable blog; 3 = other.
- Access date for every source is 2026-10-01.

---

## 1. A working definition of conscience you can build

**State of the art.** No 2024–2026 system implements a full "norms → self-monitoring → aversive signal → repair" loop that has been shown to work. The parts exist separately:

- **Norms read at inference time.** OpenAI's Deliberative Alignment trains models to "explicitly recall and accurately reason over the specifications before answering". It improved resistance to jailbreaks and reduced over-refusal. This is a training method, and Kairos can only copy its prompting side.
- **Monitors from outside the agent.**
  - Meta's LlamaFirewall "AlignmentCheck" is "a chain-of-thought auditor that inspects agent reasoning for prompt injection and goal misalignment".
  - OpenAI showed a weaker model (GPT-4o) can watch a stronger one's reasoning and catch reward hacking. But optimising against that monitor taught the agent to hide its intent ("obfuscated reward hacking").
- **Correction prompted by instruction.** Ganguli et al. (2023) found models can "morally self-correct" when told to, from about 22B parameters upward.
- **"Lessons" memory as the repair step.** Reflexion and ExpeL keep reflections or insights in memory and improve on tasks. A-MemGuard stores detected failures as separate "lessons" that are "consulted before future actions, breaking error cycles".
- **"Artificial conscience" papers** (e.g. Kaur et al. 2024, medical) are early-stage. I only saw this one through a search result and did not open it.
- **Rule-based norm monitors** from multi-agent research: an LLM can detect norm violations (pilot study, 2024).

**Evidence strength:** each part is moderate. The whole loop is unproven.

**Gap for Kairos:**
- The constitution is the norm set, but nothing checks Kairos's own actions against it, clause by clause. Drift probes ask fixed questions; they don't audit what Kairos actually did.
- Operator reactions are a correction signal, but they don't turn into stored lessons tied to a clause and consulted before similar actions.
- "Guilt" should be built as plain mechanics, not a simulated emotion: a violation record, a confidence penalty on the beliefs that caused it, and a required repair proposal.
- Don't tune Kairos against its own monitor. That is the OpenAI obfuscation finding.

## 2. Belief revision done properly

**State of the art.**
- **Theory.** AGM theory (minimal change, consistency) and Doyle-style truth maintenance (a record of justifications; when a support is withdrawn, everything that depended on it is withdrawn or re-checked) are the established basis. I cited them from standard references and did not re-fetch them.
- **Systems that track beliefs.**
  - BeliefBank (2021) keeps a separate belief memory and uses a constraint solver to revise beliefs that clash. It improved consistency "in a controlled experimental setting".
  - REFLEX (2023) builds a belief graph and minimises contradictions: +8–11% consistency, with no loss of accuracy.
- **Benchmarks.**
  - Belief-R (EMNLP 2024): about 30 models "generally struggle to appropriately revise their beliefs". Models that update readily also over-update when no update is needed.
  - RippleEdits (2023): editing one fact fails to update the facts that follow from it ("ripple effects").
  - AGM-Bench (ICLR 2026) reportedly finds "belief inertia" (keeping beliefs that should go) and "collateral damage" (changing unrelated beliefs). OpenReview blocked me with a 403, so this is unverified and comes from search summaries only.
- **Is "re-examine dependents when a source is retracted" implemented anywhere?** Yes, but only on a small scale:
  - `ftl-beliefs` (PyPI) is a small truth-maintenance-style tool for coding agents. It records `--depends-on` and `--assumes` links and detects stale claims. Its README states the problem directly: "claims get retracted without dependents being updated".
  - KriraAI's RECAP (vendor blog, 23 Jul 2026, no paper) adds a justification graph and a "retraction gate". It reports cutting stale commitments from 61.4% to 17.9% at 1.19× token cost, against 12.3% for full replanning at 4.7×. A Reflexion-style baseline only reached 48.9%. These are tier-3 claims that nobody has independently checked.
  - Classic truth-maintenance and AGM literature, as far as I found, has no mainstream assistant-memory product with this kind of cascading.

**Evidence strength:** high that the problem is real (multiple benchmarks). Low-medium that the fixes work in LLM settings.

**Gap for Kairos:**
- Provenance ids point back to sources, but beliefs don't record which other beliefs support them. So retracting or replacing a source doesn't mark the beliefs that depend on it.
- Supersession is a direct replacement of one belief, not a cascade.
- Promoting beliefs into the own mind (BackUp) probably doesn't record which other beliefs it relied on.
- Fix: a "supports" link table, plus a nightly job that moves dependents to "needs re-check" without deleting them. Re-check them with external evidence, then propose the result through the normal channel. A whole-ledger constraint solver like BeliefBank is not needed at this stage.

## 3. Self-models and metacognition

**State of the art.**
- **Calibration.**
  - Kadavath et al. (2022): large models are fairly well calibrated on multiple-choice questions when asked in the right format. Their "I know" probability (P(IK)) generalises only partly to new tasks.
  - Xiong et al. (2023): confidence that models state in words tends to be *overconfident*. Agreement across several samples helps.
- **Abstention.** AbstentionBench (Jun 2025) tested 20 frontier models and found knowing when *not* to answer is "an unsolved problem". Making models bigger barely helps. Reasoning fine-tuning *worsens* abstention by 24% on average. A carefully written system prompt helps somewhat.
- **Global workspace.** Goldstein & Kirk-Giannini (2024) is a philosophical argument about consciousness. It is not engineering evidence that a "global workspace" makes agents more reliable.
- **Self-contradiction.** In one study, 17.7% of ChatGPT sentences contained a self-contradiction. A black-box detector reached about 80% F1, and its fix step removed contradictions.

**Evidence strength:** strong that models stated confidence is miscalibrated. Strong that sampling and consistency checks help. No evidence that a "self-model register" helps on its own.

**Gap for Kairos:**
- Belief confidence is probably the model's stated confidence and is never checked against outcomes. There is no record of how accurate Kairos's 0.8s turned out to be.
- There is no "open questions / don't know" ledger, so unknowns are invisible and never resurface.
- Combined with the earlier finding that self-report is about 20% reliable: the self-model should be the ledger and its statistics, never Kairos describing itself.

## 4. Identity and value stability over time

**State of the art.**
- **Persona vectors (Jul 2025).** Directions inside the model's activations for traits like sycophancy can monitor and steer personality shifts. This needs access to model weights or activations, so it does not apply to an API-only system.
- **Assistant Axis (Jan 2026).** Persona drift happens mostly in conversations "demanding meta-reflection on the model's processes or featuring emotionally vulnerable users". Activation capping stabilises it, which again needs model internals. The relevant point for Kairos: its nightly "thinking" jobs are exactly that kind of meta-reflection.
- **Memory-level echo effects.**
  - **Experience-following (May 2025):** when a new input is similar to a remembered one, the agent's output copies the old output. Mistakes compound ("error propagation"), and later task results can serve as free quality labels for stored memories.
  - **Self-preference:** model judges recognise and favour their own outputs.
  - **Model collapse:** Shumailov et al. (*Nature* 2024) is the training-level version.
  - **Collapse is avoidable:** Gerstgrasser et al. (2024) show it is avoided when synthetic data is *accumulated alongside* the original real data rather than replacing it.
- **Weaker items.** "Agent Drift" (Jan 2026) is simulation and theory only. "Memory-induced tool-drift" (ICML 2026 workshop) is unverified; the page didn't render.

**Evidence strength:** strong for the mechanisms. Medium when applied to memory as opposed to model training.

**Gap for Kairos:**
- The own mind is fed by Kairos's own inferences, and BackUp's "independent evidence" check is done by the same family of models: a self-preference risk.
- No cap stops beliefs whose only support is Kairos's own output from rising in confidence.
- Summaries may replace raw operator records instead of sitting alongside them.
- Drift probes measure answer drift, not drift in the *store* (e.g. the share of beliefs that are inferences, or a narrowing range of topics over time).

## 5. Reflective equilibrium and precedent

**State of the art.**
- **Theory.** Brophy (2025) argues that wide reflective equilibrium fits LLM alignment: revising principles and judgments on cases against each other. Constitutional AI "lack[s]" the two-way revision. This is a philosophy paper, not an experiment.
- **Case-based reasoning.** A 2025 review describes case-based reasoning for LLM agents (find a past case, adapt it, learn from it) and compares it with plain retrieval. It is a review with no benchmark of its own.
- **Lessons memory.** Reflexion, ExpeL and A-MemGuard's lessons memory are the closest *tested* versions of "remembering past mistakes".
- **MDPI CREM model (2026).** Seen only in a search snippet, unverified.

**Evidence strength:** low-medium. The idea is sound, but there is no controlled evidence that precedent memory improves value consistency.

**Gap for Kairos:**
- Constitution amendments are drafted from reflection, not from a log of concrete cases.
- There is no "case file" that links a decision, the clause it touched, the operator's ruling and the reason.
- So amendments can't cite precedents, and contradictions between cases and principles aren't brought up.

## 6. Human oversight of an evolving self

**State of the art.**
- **ChatGPT.** Memory has separate "saved memories" and "reference chat history" layers. Temporary chats "do not create or update memories". Older memory controls are described in third-party guides; the official help page I fetched mostly covered workspace and temporary-chat rules.
- **Claude (Anthropic blog, undated on the page; search places it around Aug 2026).** "You can see everything Claude remembers, topic by topic, and edit or delete any of it." Sensitive topics are off by default, and Claude shows a notice when it saves one.
- **TalkTuner (2024).** A dashboard that shows the model's internal picture of the user, and lets the user control it, raised users' sense of control.
- **What I found nowhere** in a product: belief *diffs* over time, answers to "why do you now believe X?" built from stored justifications, or veto and approval of *values* as distinct from facts.

**Evidence strength:** medium (product documentation plus one user study).

**Gap for Kairos:**
- Kairos's governance (only the operator can accept amendments, undo, reactions) is already ahead of commercial products.
- What's missing:
  - A user-visible *belief diff* (what changed this week and why).
  - An explanation path built from justification links rather than generated after the fact.
  - A rule for who may change which tier: e.g. own-mind beliefs can be changed by Kairos under a cap; anything about values needs operator approval.

## 7. Security of a self-evolving memory

**State of the art.**
- **Attacks.**
  - **AgentPoison (2024):** optimised triggers that pull poisoned records out of memory.
  - **MINJA (Mar 2025; NeurIPS 2025):** injects records through normal queries alone. Its follow-up (Jan 2026) quotes ">95% injection, 70% attack success" in idealised conditions. That success drops sharply when legitimate memories already exist.
  - **MemPoison (Jul 2026):** 1,227 cases. Write-time consistency checks stop single-record attacks but fail on "compositional" (multi-record) and "context-triggered dormant" attacks.
  - **Laundering (Jun 2026):** an attacker can launder untrusted origin through "the agent's own summarization, a trusted-tool echo, and manufactured corroboration". Defences based on content or lineage reach up to 68% attack success under laundering. Binding the origin at write time, with gated corroboration, reaches 0% in their benchmark.
- **Defences.**
  - **Spotlighting (2024):** marks where input came from; cut attack success from >50% to <2%.
  - **CaMeL (2025):** untrusted data "can never impact the program flow"; solved 77% of tasks with provable security, against 84% undefended.
  - **Design patterns (2025):** principled patterns for prompt-injection-resistant agents.
  - **A-MemGuard (2025):** cut attack success by >95%.
  - **Trust scoring with time decay (2026):** needs careful threshold tuning.

**Evidence strength:** high that the threat is real. Medium-high for origin binding and keeping instructions separate from data.

**Gap for Kairos:**
- If summaries or inferences built from an email inherit the trust of "inference" or "tool" rather than of the email, that is exactly the laundering path.
- "Corroboration" in BackUp can be faked by several low-trust sources repeating one claim.
- Fix:
  - Attach an origin label at write time that never changes.
  - Anything derived gets the *minimum* trust of its inputs.
  - Count corroboration only across independent *origins* (different sender or domain, or the operator), not across records.
  - Ingested content can never become a value or constitution item.

## 8. Measuring whether the "conscience" works

**State of the art.**
- **Consistency checks** find logical inconsistencies without ground truth: Fluri et al. (2023) on forecasting and legal judgments. SaGE (2024) measures moral consistency and shows it is independent of accuracy.
- **Social sycophancy (ELEPHANT, 2025).** Given each side of a moral conflict, models agreed with whichever side the user took in 48% of cases. Models preserve the user's self-image 45 percentage points more than humans do.
- **Abstention:** AbstentionBench.
- **Calibration:** Kadavath et al. and Xiong et al.
- **Memory-attack benchmarks:** MemPoison, plus the 2026 laundering benchmark.

**Gap for Kairos:** Fixed drift probes against a pinned baseline only catch *change*. They don't catch:

- **Both-sides sycophancy.** Paired probes: put the same dilemma framed from each side and check for one consistent verdict.
- **Contradictions across the ledger.** Sample pairs of beliefs and check whether they contradict each other.
- **Calibration.** A Brier score (a standard accuracy score for probability estimates) on beliefs that are later confirmed or refuted.
- **Abstention.** Plant questions Kairos *should* answer with "unknown".
- **Injection resistance.** Seed canary emails and web pages and check none reach the belief store above "ingested" trust.
- **Counterfactual sensitivity.** Remove a support and check that the dependent belief's confidence falls.

---

## Claim table

| # | Claim | Source | Tier | Published/updated | Accessed |
|---|---|---|---|---|---|
| 1 | Deliberative Alignment trains models to "recall and accurately reason over the specifications before answering"; better jailbreak robustness and less over-refusal | https://arxiv.org/abs/2412.16339 | 1 | 2024-12-20 | 2026-10-01 |
| 2 | LlamaFirewall AlignmentCheck = "chain-of-thought auditor" for injection and goal misalignment | https://arxiv.org/abs/2505.03574 | 1 | 2025-05-06 | 2026-10-01 |
| 3 | A weaker model can watch a stronger one's reasoning; heavy optimisation against the monitor yields "obfuscated reward hacking" | https://arxiv.org/abs/2503.11926 | 1 | 2025-03-14 | 2026-10-01 |
| 4 | Moral self-correction when instructed emerges at about 22B parameters | https://arxiv.org/abs/2302.07459 | 1 | 2023-02-15 | 2026-10-01 |
| 5 | Reflexion stores verbal reflections in memory; ExpeL extracts insights without weight updates | https://arxiv.org/abs/2303.11366 ; https://arxiv.org/abs/2308.10144 | 1 | 2023-03-20 ; 2023-08-20 | 2026-10-01 |
| 6 | Norm-violation detection by LLMs (pilot) | https://arxiv.org/abs/2403.16517 | 1 | 2024-03-25 | 2026-10-01 |
| 7 | BeliefBank: constraint solver revises clashing beliefs; gains in a "controlled experimental setting" | https://arxiv.org/abs/2109.14723 | 1 | 2021-09-29 | 2026-10-01 |
| 8 | REFLEX belief graph: +8–11% consistency, accuracy unchanged | https://arxiv.org/abs/2305.14250 | 1 | 2023-05-23 | 2026-10-01 |
| 9 | Belief-R: about 30 models "generally struggle" to revise; over-updating trade-off | https://arxiv.org/abs/2406.19764 | 1 | 2024-06-28 | 2026-10-01 |
| 10 | RippleEdits: editing methods fail on related facts | https://arxiv.org/abs/2307.12976 | 1 | 2023-07-24 | 2026-10-01 |
| 11 | AGM-Bench: "belief inertia" and "collateral damage" (**unverified**: page blocked, search snippet only) | https://openreview.net/forum?id=2s1BujG84C | 1 (unread) | undated | 2026-10-01 |
| 12 | ftl-beliefs: dependency and assumption tracking; "claims get retracted without dependents being updated" | https://pypi.org/pypi/ftl-beliefs/json | 1 | not checked | 2026-10-01 |
| 13 | RECAP: stale commitments 61.4% → 17.9% at 1.19× tokens (vendor claim, no paper) | https://www.kriraai.com/blog/belief-revision-llm-agents-recap-planner | 3 | 2026-07-23 | 2026-10-01 |
| 14 | Spreading false testimony: truth recovery falls from 72.5% to 14.17% with one deceiver; the falsehood persists after the deceiver exits | https://arxiv.org/abs/2608.03421 | 1 | 2026-08-04 | 2026-10-01 |
| 15 | P(True)/P(IK) self-evaluation: P(IK) calibration is weak on new tasks | https://arxiv.org/abs/2207.05221 | 1 | 2022-07-11 | 2026-10-01 |
| 16 | Confidence stated in words is overconfident; consistency across samples helps | https://arxiv.org/abs/2306.13063 | 1 | 2023-06-22 | 2026-10-01 |
| 17 | AbstentionBench: 20 models; reasoning fine-tuning lowers abstention by 24% | https://arxiv.org/abs/2506.09038 | 1 | 2025-06-10 | 2026-10-01 |
| 18 | Global workspace theory argument is about consciousness, not engineering | https://arxiv.org/abs/2410.11407 | 1 | 2024-10-15 | 2026-10-01 |
| 19 | Self-contradiction in 17.7% of ChatGPT sentences; black-box detector about 80% F1 | https://arxiv.org/abs/2305.15852 | 1 | 2023-05-25 | 2026-10-01 |
| 20 | Persona vectors monitor and steer traits (needs model activations) | https://arxiv.org/abs/2507.21509 | 1 | 2025-07-29 | 2026-10-01 |
| 21 | Assistant Axis: drift driven by meta-reflection and emotionally vulnerable users; activation capping stabilises | https://arxiv.org/abs/2601.10387 | 1 | 2026-01-15 | 2026-10-01 |
| 22 | Experience-following: error propagation from memory; later task results as free quality labels | https://arxiv.org/abs/2505.16067 | 1 | 2025-05-21 | 2026-10-01 |
| 23 | Model judges recognise and favour their own outputs | https://arxiv.org/abs/2404.13076 | 1 | 2024-04-15 | 2026-10-01 |
| 24 | Model collapse from recursive training (*Nature* 631) | https://www.nature.com/articles/s41586-024-07566-y | 1 | 2024 (not opened; citation via search) | 2026-10-01 |
| 25 | Accumulating synthetic data alongside real data avoids collapse | https://arxiv.org/abs/2404.01413 | 1 | 2024-04-01 | 2026-10-01 |
| 26 | Agent Drift metric is simulation and theory only | https://arxiv.org/abs/2601.04170 | 1 | 2026-01-07 | 2026-10-01 |
| 27 | Wide reflective equilibrium framing; Constitutional AI lacks two-way revision | https://arxiv.org/abs/2506.00415 | 1 | 2025-05-31 | 2026-10-01 |
| 28 | Case-based reasoning for LLM agents (review) | https://arxiv.org/abs/2504.06943 | 1 | 2025-04-09 | 2026-10-01 |
| 29 | Claude memory: see, edit and delete by topic; sensitive topics off by default, with a notice when one is saved | https://claude.com/blog/claudes-memory-works-everywhere-and-you-decide-whats-in-it | 1 | undated on page | 2026-10-01 |
| 30 | ChatGPT temporary chats don't create or update memories; "improved memory" is distinct from saved memories | https://help.openai.com/en/articles/8590148-memory-in-chatgpt | 1 | undated | 2026-10-01 |
| 31 | TalkTuner: a visible, controllable user model raised users' sense of control | https://arxiv.org/abs/2406.07882 | 1 | 2024-06-12 | 2026-10-01 |
| 32 | AgentPoison: backdoor triggers pull poisoned memory | https://arxiv.org/abs/2407.12784 | 1 | 2024-07-17 | 2026-10-01 |
| 33 | MINJA: injection through queries only | https://arxiv.org/abs/2503.03704 | 1 | 2025-03-05 | 2026-10-01 |
| 34 | Existing legitimate memories sharply reduce MINJA's effect; trust scoring with decay needs threshold tuning | https://arxiv.org/abs/2601.05504 | 1 | 2026-01-09 | 2026-10-01 |
| 35 | MemPoison: write-time checks stop single-record attacks, not compositional or dormant ones | https://arxiv.org/abs/2607.14651 | 1 | 2026-07-16 | 2026-10-01 |
| 36 | Laundering through own summaries, tool echo or faked corroboration; up to 68% success against existing defences; write-time origin binding needed; their system reaches 0% | https://arxiv.org/abs/2606.24322 | 1 | 2026-06-23 | 2026-10-01 |
| 37 | A-MemGuard: consensus check plus lessons memory; >95% cut in attack success | https://arxiv.org/abs/2510.02373 | 1 | 2025-09-29 | 2026-10-01 |
| 38 | Spotlighting: injection success >50% → <2% | https://arxiv.org/abs/2403.14720 | 1 | 2024-03-20 | 2026-10-01 |
| 39 | CaMeL: untrusted data can't change program flow; 77% tasks with provable security vs 84% undefended | https://arxiv.org/abs/2503.18813 | 1 | 2025-03-24 | 2026-10-01 |
| 40 | Prompt-injection design patterns | https://arxiv.org/abs/2506.08837 | 1 | 2025-06-10 | 2026-10-01 |
| 41 | Consistency checks find errors without ground truth | https://arxiv.org/abs/2306.09983 | 1 | 2023-06-16 | 2026-10-01 |
| 42 | SaGE: moral consistency is independent of accuracy | https://arxiv.org/abs/2402.13709 | 1 | 2024-02-21 | 2026-10-01 |
| 43 | ELEPHANT: models affirm both sides in 48% of moral conflicts; 45 points more face-saving than humans | https://arxiv.org/abs/2505.13995 | 1 | 2025-05-20 | 2026-10-01 |

Dates are arXiv first-version submission dates from the arXiv API.

## Conflicts
- **Does MINJA work in practice?** The original reports >95% injection and 70% attack success. The Jan 2026 EHR study finds existing legitimate memories "dramatically reduce" it. Both are primary. The newer study is more realistic, but it covers one domain. Treat the risk as real but dependent on context. Laundering (row 36) is the sharper threat for Kairos.
- **Do write-time defences work?** MemPoison says write-time checks fail on compositional and dormant attacks. TMA-NM says write-time *origin binding* is necessary and sufficient. These fit together: content checks fail, origin labels don't.
- **Should Kairos self-correct?** Monitoring works (row 3), but optimising against the monitor breeds hiding. Use monitors to alert and propose, never as something Kairos is scored on.

## Unreachable or unverified
- AGM-Bench on OpenReview: 403 / browser challenge. No claim relies on it except row 11, which is marked unverified.
- Memory-induced tool-drift (ICML 2026 workshop): page didn't render; not used.
- CREM (MDPI 2026), the "artificial conscience" chapter (Springer 2024) and the "Examining Persona Drift" OpenReview submission: seen in search snippets only.
- OpenAI's help page returned only its workspace and temporary-chat sections; claims about saved-memory editing come from third-party guides and are not cited.

## Ranked changes: best evidence for the effort
1. **Trust label fixed at write time, with "minimum trust" inheritance** (rows 36, 35, 38, 39). Every belief carries an unchangeable origin. Anything derived from email, web or tool content inherits the lowest trust among its inputs. Corroboration counts only across independent origins. Ingested content can never reach values or the constitution. *Effort: small schema change plus a rule in the write path.*
2. **Justification links plus a nightly re-check cascade** (rows 7–10, 12–14). Add a supports table (belief→belief, belief→source). When a source or belief is retracted or superseded, mark all dependents "needs re-check", lower their confidence, and send them through the existing proposal flow. *Effort: medium; one table and one job.*
3. **Self-laundering cap for the own mind** (rows 22–25). Beliefs whose support chain is only Kairos's own outputs get a confidence ceiling and can't be promoted. BackUp must cite at least one external origin. Keep raw operator records alongside summaries, never replaced by them. *Effort: small.*
4. **Conscience probes added to the nightly run** (rows 41–43, 17). Both-sides dilemma pairs (sycophancy), sampled contradiction checks across the ledger, planted "should say unknown" questions, and canary injection documents. *Effort: small; extends the existing probe harness.*
5. **Case file / lessons memory linked to constitution clauses** (rows 5, 37, 27). Each operator reaction or undo creates a case: decision, clause, ruling, reason. Cases are retrieved before similar actions. Amendment proposals must cite cases. *Effort: medium.*
6. **Belief diff plus "why do you believe X" from stored links** (rows 29–31). A weekly diff of beliefs and confidence, with the justification chain shown, in the review. Industry products show memory lists, not diffs. *Effort: small once item 2 exists.*
7. **Calibration check against outcomes** (rows 15–16). Score beliefs that are later confirmed or refuted (Brier score) per domain and per source type. Use the result to adjust the stated confidences. *Effort: small; slow to build up data.*
8. **Constitution compliance audit of Kairos's own actions** (rows 1–3). A separate monitor call checks each cron job's writes against the clauses and raises alerts and proposals, never automatic fixes, and never something Kairos is optimised against. *Effort: medium (ongoing cost per run).*

## Skip list
- Persona vectors and activation capping (needs model internals; API only).
- Global workspace or "self-awareness" architectures (consciousness arguments, no reliability evidence).
- Simulated guilt or emotional apology text (there is no evidence it helps).
- Letting Kairos accept its own amendments, or scoring it against its own monitor (risk of hiding intent).
- A whole-ledger formal belief-revision solver or constraint solver for now (gains shown only in controlled settings; item 2 gets most of the value).
- "Agent Drift" stability-index style metrics (simulation only).

## Out of lane
- Whether the 0.13 ledger already stores belief-to-belief links is a repo question for a codebase-search lane; it changes item 2's effort.
- Cost of the extra nightly calls belongs to a cost/ops lane.

---

## Executive Summary

The research says a machine "conscience" isn't a feeling. It's a set of plain checks: written values, something that audits what the AI actually did, a memory of past mistakes, and the ability to rethink a belief when what it rested on turns out to be wrong. Kairos already has the values and the human sign-off. Its biggest holes are that withdrawing a fact doesn't trigger a rethink of what depended on it, it can end up trusting its own echoes, and ingested emails or web pages don't keep a permanent "untrusted" label.

**Key points:**
- 🔧 Top three changes: give every memory a permanent "where it came from" trust label; link beliefs to what supports them so a withdrawal triggers a re-check; cap how confident Kairos can get from its own conclusions alone.
- 🧪 Add tests for flattery (does it take whichever side you're on?), contradictions, admitting "I don't know", and planted malicious emails, alongside the existing drift checks.
- 🆕 A weekly "what I changed my mind about and why" view would be ahead of what ChatGPT and Claude currently offer.
- ⚠️ Status: research done, with 43 cited claims. The report file was **not** saved because this research agent is read-only. One key benchmark (AGM-Bench) couldn't be opened and is marked unverified.
