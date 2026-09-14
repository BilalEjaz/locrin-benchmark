"""Step 48 - Skills on TrueForge.

Stage 4 read `SKILL.md` from a folder on disk. TrueForge accepts a skill
only from a GitHub or GitLab HTTPS URL: the server clones the repository
into the sandbox when a turn starts, and the model reads `SKILL.md` there.
This module parses the front matter the same way stage 4 did and builds
the manifest the settings API wants.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from trueforge_sdk import GitSkill, TrueForge

REPO_URL = "https://github.com/dlmastery/simple-coding-harness"
SKILL_NAME = "s48-explain-code"
SKILL_PATH = "step_04_skills/.agents/skills/explain-code"
LOCAL_COPY = Path(__file__).resolve().parent.parent / "skills" / "explain-code" / "SKILL.md"


def front_matter(text: str) -> dict:
    """The YAML between the two `---` lines of a SKILL.md, as stage 4 read it."""
    if not text.startswith("---"):
        return {}
    _, meta, _ = text.split("---", 2)
    data = yaml.safe_load(meta) or {}
    data["description"] = " ".join(str(data.get("description", "")).split())
    return data


def skill_manifest(name: str = SKILL_NAME, ref: str = "main", skill_md: Path = LOCAL_COPY) -> GitSkill:
    """A `GitSkill` for the stage 4 skill, its description taken from the local copy of SKILL.md."""
    meta = front_matter(skill_md.read_text(encoding="utf-8"))
    return GitSkill(name=name, url=REPO_URL, ref=ref, path=SKILL_PATH, description=meta["description"])


def register(client: TrueForge, manifest: GitSkill) -> list[str]:
    """PUT the manifest (create or replace) and return the names of every configured skill."""
    client.settings.skills.create_or_update(manifest=manifest)
    return [skill.name for skill in client.settings.skills.list().data]
