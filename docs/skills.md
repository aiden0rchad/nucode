# Skills

A **skill** is a folder with a `SKILL.md` file that teaches an agent one task: how to review a diff, run a checklist, or use a tool. nucode uses the same format as Claude Code and Codex (`SKILL.md` with `name` and `description` in its frontmatter, plus optional `scripts/`, `references/` and `assets/` folders), so skills you already have work as they are.

Open **Settings → Skills**. Enabled skills reach every Code engine (pi, omp and Codex), and an agent can use them once it starts. Changes apply the next time an agent starts, which for a conversation is its next message. Chat uses no skills, and Work uses only the document skills it ships with.

## Where skills come from

| Source | Where | Default |
| --- | --- | --- |
| nucode's library | Copies kept by nucode, listed with a **nucode** badge | On |
| Claude Code | `~/.claude/skills` | Off |
| Codex | `~/.codex/skills` (Codex's bundled `.system` folder is skipped) | Off |
| Agents | `~/.agents/skills` | Off |

Turn a folder on to use its skills in place. nucode reads these folders live and never changes them. If two sources have a skill with the same name, the library wins, then Claude Code, Codex and Agents. Each skill has its own switch, so you can keep one installed without offering it to agents.

A skill that has no description in its frontmatter is skipped, and the page says why.

## Install a skill pack

Under **Install a skill pack**, paste a GitHub address, or choose a folder on this computer, and select **Install**.

- A repository: `https://github.com/owner/repo`. nucode downloads it with `git`, finds every folder that holds a `SKILL.md` (a skill at the top, or under `skills/`), and copies those into its library. To install part of a repository, use the address of that folder on GitHub: `https://github.com/owner/repo/tree/main/skills`. Branch names with a slash are not supported.
- A folder: a single skill, or a folder of skills.

If a skill with the same name is already installed, nothing is installed and nucode offers **Replace**. Installing copies files only (never links), skips `.git`, and refuses more than 20 MB or 2,000 files. Remove a library skill with **Remove**; skills from the folders above are removed where they live.

A skill can contain scripts that an agent may run. Install packs from authors you trust, and read what a skill does first.

## Using a skill

Type `$` in the composer and pick a skill. For pi and omp this writes `/skill:name`; ask for the task by name and the agent loads the skill. Codex shows its own skill list.
