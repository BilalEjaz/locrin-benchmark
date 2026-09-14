"""Negative tests for the Browser Agent Standard gate.

BAS-9 says a rule without a gate is not a rule. That makes this gate itself the thing most
likely to fail open: if `standard_violations` silently returned nothing when the shipped texts
drift, every rule would read as adopted while nothing enforced it. These tests break each
input on purpose and assert the gate says so.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def load_validator():
    path = ROOT / "scripts" / "validate-skill.py"
    spec = importlib.util.spec_from_file_location("validate_skill", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class StandardGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = load_validator()
        self.skill_text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.standard_text = (ROOT / "docs" / "BROWSER-AGENT-STANDARD.md").read_text(
            encoding="utf-8"
        )

    def violations(self, skill_text: str | None = None, standard_text: str | None = None):
        return self.validator.standard_violations(
            self.skill_text if skill_text is None else skill_text,
            self.standard_text if standard_text is None else standard_text,
        )

    def test_shipped_texts_pass(self) -> None:
        self.assertEqual([], self.violations())

    def test_missing_page_content_invariant_fails(self) -> None:
        broken = self.skill_text.replace(self.validator.PAGE_CONTENT_INVARIANT, "")
        self.assertIn("page-content invariant", " ".join(self.violations(skill_text=broken)))

    def test_missing_evidence_class_fails(self) -> None:
        broken = self.skill_text.replace("`inferred`", "inferred")
        self.assertIn("evidence classes", " ".join(self.violations(skill_text=broken)))

    def test_missing_conformance_level_fails(self) -> None:
        broken = self.skill_text.replace("`L2`", "L2")
        self.assertIn("conformance levels", " ".join(self.violations(skill_text=broken)))

    def test_dropping_proposal_status_fails(self) -> None:
        broken = self.standard_text.replace(self.validator.PROPOSAL_STATUS, "สถานะ: บังคับใช้แล้ว")
        self.assertIn("proposal status", " ".join(self.violations(standard_text=broken)))

    def test_rule_without_gate_fails(self) -> None:
        rules = self.validator.BAS_SPLIT_RE.split(self.standard_text)
        self.assertGreater(len(rules), 1, "fixture assumption: the standard defines BAS rules")
        rules[1] = rules[1].replace("**Gate.**", "**หมายเหตุ.**", 1)
        broken = "### ".join([rules[0]] + rules[1:])
        message = " ".join(self.violations(standard_text=broken))
        self.assertIn("has no Gate line", message)

    def test_dropping_a_rule_fails(self) -> None:
        head, _, tail = self.standard_text.partition("### BAS-9")
        self.assertTrue(tail, "fixture assumption: the standard defines BAS-9")
        message = " ".join(self.violations(standard_text=head))
        self.assertIn(
            f"must define {self.validator.EXPECTED_BAS_RULES} BAS rules, found", message
        )


class SemanticTargetingGateTests(unittest.TestCase):
    """BAS-1: refs first, pixels are a second-class verdict."""

    def setUp(self) -> None:
        self.validator = load_validator()
        self.texts = {"SKILL.md": (ROOT / "SKILL.md").read_text(encoding="utf-8")}
        for path in sorted((ROOT / "references").glob("*.md")):
            self.texts[f"references/{path.name}"] = path.read_text(encoding="utf-8")

    def violations(self, texts):
        return self.validator.targeting_violations(texts)

    def test_shipped_docs_pass(self) -> None:
        self.assertEqual([], self.violations(self.texts))

    def test_missing_targeting_order_fails(self) -> None:
        texts = dict(self.texts)
        texts["SKILL.md"] = texts["SKILL.md"].replace(
            self.validator.TARGETING_ORDER_MARKER, "Pick whatever works"
        )
        self.assertIn("targeting order", " ".join(self.violations(texts)))

    def test_missing_targeting_tier_fails(self) -> None:
        texts = dict(self.texts)
        texts["SKILL.md"] = texts["SKILL.md"].replace("data-test", "whatever")
        self.assertIn("omits: data-test", " ".join(self.violations(texts)))

    def test_missing_visual_verdict_definition_fails(self) -> None:
        texts = dict(self.texts)
        texts["references/cdp-limits.md"] = texts["references/cdp-limits.md"].replace(
            self.validator.VISUAL_VERDICT, "`PASS`"
        )
        self.assertIn("does not define PASS(visual)", " ".join(self.violations(texts)))

    def test_coordinate_click_recipe_fails(self) -> None:
        texts = dict(self.texts)
        texts["references/commands.md"] += '\n```bash\nAB click 412 233\n```\n'
        message = " ".join(self.violations(texts))
        self.assertIn("teaches a coordinate click", message)
        self.assertIn("references/commands.md:", message)

    def test_documented_limit_is_not_a_recipe(self) -> None:
        """gotchas.md documents that elementFromPoint returns BODY inside the PDF viewer.

        Prose describing a limit must not trip the gate, or the honest documentation this repo
        depends on becomes the thing that fails CI.
        """
        texts = dict(self.texts)
        texts["references/gotchas.md"] += "\n`elementFromPoint` คืน BODY และคลิกที่พิกัดไม่ทำงาน\n"
        self.assertEqual([], self.violations(texts))


if __name__ == "__main__":
    unittest.main()
