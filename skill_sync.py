#!/usr/bin/env python3
"""
skill_sync.py — Escanea .claude/commands/ y actualiza la sección
'## Skills' en CLAUDE.md con las skills disponibles y cómo invocarlas.

Uso: python skill_sync.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

COMMANDS_DIR = Path(".claude/commands")
CLAUDE_MD = Path("CLAUDE.md")
SECTION_START = "## Skills disponibles"
SECTION_END_MARKER = "\n## "  # siguiente sección H2


def parse_frontmatter(text: str) -> dict[str, str]:
    """Extrae claves YAML del bloque frontmatter (entre ---) de forma simple."""
    match = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not match:
        return {}
    result: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            result[key.strip()] = val.strip()
    return result


def collect_skills() -> list[dict[str, str]]:
    """Devuelve lista de skills con name, description e invocación."""
    skills: list[dict[str, str]] = []
    if not COMMANDS_DIR.exists():
        return skills

    for skill_dir in sorted(COMMANDS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        fm = parse_frontmatter(skill_md.read_text(encoding="utf-8"))
        name = fm.get("name") or skill_dir.name
        description = fm.get("description", "Sin descripción")
        skills.append({"name": name, "description": description, "invoke": f"/{name}"})

    return skills


def build_section(skills: list[dict[str, str]]) -> str:
    if not skills:
        return f"{SECTION_START}\n_No hay skills instaladas en `.claude/commands/`._\n"

    rows = "\n".join(
        f"| `{s['invoke']}` | `{s['name']}` | {s['description']} |"
        for s in skills
    )
    return (
        f"{SECTION_START}\n"
        f"Skills en `.claude/commands/` — invocar con `/nombre`:\n\n"
        f"| Invocación | Nombre | Descripción |\n"
        f"|-----------|--------|-------------|\n"
        f"{rows}\n"
    )


def update_claude_md(new_section: str) -> None:
    content = CLAUDE_MD.read_text(encoding="utf-8")

    # Reemplazar sección existente si ya existe
    pattern = re.compile(
        rf"^{re.escape(SECTION_START)}.*?(?=\n## |\Z)", re.MULTILINE | re.DOTALL
    )
    if pattern.search(content):
        updated = pattern.sub(new_section.rstrip(), content)
    else:
        # Insertar antes de ## Notas, o al final
        if "\n## Notas" in content:
            updated = content.replace("\n## Notas", f"\n{new_section}\n## Notas")
        else:
            updated = content.rstrip() + f"\n\n{new_section}"

    CLAUDE_MD.write_text(updated, encoding="utf-8")


def main() -> None:
    if not CLAUDE_MD.exists():
        print(f"ERROR: {CLAUDE_MD} no encontrado", file=sys.stderr)
        sys.exit(1)

    skills = collect_skills()
    section = build_section(skills)
    update_claude_md(section)

    count = len(skills)
    print(f"OK: CLAUDE.md actualizado - {count} skill(s) encontrada(s)")
    for s in skills:
        print(f"  {s['invoke']:20} {s['description']}")

    if count == 0:
        print(
            "\nNota: Crea subcarpetas en .claude/commands/<nombre>/SKILL.md "
            "con frontmatter 'name' y 'description' para registrarlas."
        )


if __name__ == "__main__":
    main()
