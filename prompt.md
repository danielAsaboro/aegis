You are working in this repo:

`/Users/cartel/development/solana/hackathon/frontier`

The project you should work on is:

`/Users/cartel/development/solana/hackathon/frontier/zerion-magicblock-aegis`

The main code areas are:
- `/Users/cartel/development/solana/hackathon/frontier/zerion-magicblock-aegis/aegis`
- `/Users/cartel/development/solana/hackathon/frontier/zerion-magicblock-aegis/cli`

Track context:
- This is a merged submission for:
  1. Zerion
  2. MagicBlock
- Read these first:
  - `/Users/cartel/development/solana/hackathon/frontier/zerion-magicblock-aegis/TRACKS.md`
  - `/Users/cartel/development/solana/hackathon/frontier/zerion-magicblock-aegis/resources/track_description.md`
  - `/Users/cartel/development/solana/hackathon/frontier/zerion-magicblock-aegis/resources/track_description_1.md`
  - `/Users/cartel/development/solana/hackathon/frontier/zerion-magicblock-aegis/resources/track_description_2.md`

Important project rule:
- Any external repo, docs, or reference material you need must be pulled into this project's `resources/` directory.
- `resources/` is read-only for learning/context only.
- Do not build in `resources/`.
- Keep all product code in the working codebase, not in `resources/`.

Goal:
Turn AEGIS into a first-prize-grade privacy-first autonomous onchain agent built on the Zerion CLI fork and meaningfully upgraded with MagicBlock.

Core constraints:
- Zerion remains the wallet and execution backbone.
- The agent must execute real onchain actions.
- Any swap path must respect Zerion’s routing requirement.
- MagicBlock must be visible in the actual product experience, not bolted on as an afterthought.

Product direction:
- AEGIS should feel like a serious agent for private agentic commerce or private automated finance.
- Strong directions include:
  - private policy-scoped execution flows
  - private payment / settlement workflows
  - agent-to-agent or merchant-facing private actions

What I want you to do:
1. Audit the current codebase and understand what AEGIS already does.
2. Identify the most leverage-heavy path to make the MagicBlock side substantive.
3. Implement the next meaningful slice directly in the codebase.
4. Preserve current functionality and tests where possible.
5. Update docs only if it sharpens the merged submission story.
6. Run the most relevant tests/checks you can run locally.

Execution preferences:
- Be proactive. Implement, don’t just describe.
- Keep the project coherent as one product, not two sponsor demos stapled together.
- Favor concrete user-facing workflows over abstract architecture work.
- Make it obvious, in code and in demo shape, why this belongs in both the Zerion and MagicBlock tracks.

Concrete deliverables:
- real code changes in `aegis/` and/or `cli/`
- a short explanation of what you changed
- any commands/tests you ran
- blockers, assumptions, or next integration risks
- if useful, a small doc update that sharpens the private-agent narrative

Do not work on the other merged projects unless absolutely necessary.

Start by auditing AEGIS and then move directly into the highest-leverage implementation work that makes the MagicBlock integration real.
