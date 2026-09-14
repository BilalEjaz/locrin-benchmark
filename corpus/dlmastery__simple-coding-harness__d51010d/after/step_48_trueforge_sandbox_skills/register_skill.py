"""Step 48 - Register the stage 4 skill with the TrueForge server.

    python register_skill.py            # PUT /api/v1/settings/skills, then list

The skill body is read from GitHub at turn time, so it must be pushed
before the server can load it. The local copy under skills/ only supplies
the description for the manifest.
"""

from client.sandbox import connect
from client.skills import register, skill_manifest


def main() -> None:
    manifest = skill_manifest()
    print(f"registering {manifest.name}: {manifest.url} @ {manifest.ref} / {manifest.path}")
    names = register(connect(), manifest)
    print("configured skills:", ", ".join(names))


if __name__ == "__main__":
    main()
