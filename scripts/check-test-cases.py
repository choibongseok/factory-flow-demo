#!/usr/bin/env python3
"""docs/TEST_CASES.md 의 행과 실제 테스트 함수가 1:1 인지 확인한다 (행 수 = 테스트 수)."""
import re
import sys
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parent.parent
rows = []
for line in (root / "docs/TEST_CASES.md").read_text().splitlines():
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if len(cells) == 7 and re.match(r"^[A-Z0-9]+-\d{3}$", cells[0]):
        rows.append((cells[0], cells[5].strip("`")))

errors = []
ids = [r[0] for r in rows]
errors += [f"ID 중복: {i}" for i, n in Counter(ids).items() if n > 1]
refs = Counter(r[1] for r in rows)
errors += [f"같은 테스트를 가리키는 행이 여러 개: {r}" for r, n in refs.items() if n > 1]

actual: set[str] = set()
for pattern in ("api/tests/test_*.py", "simulator/tests/test_*.py", "gateway/tests/test_*.py", "integration/test_*.py"):
    for f in sorted(root.glob(pattern)):
        for name in re.findall(r"^(?:async )?def (test_\w+)\(", f.read_text(), re.M):
            actual.add(f"{f.relative_to(root)}::{name}")
for pattern in ("web/src/lib/*.test.ts", "web/e2e/*.spec.ts"):
    for f in sorted(root.glob(pattern)):
        for name in re.findall(r'^test\("(.+?)",', f.read_text(), re.M):
            actual.add(f"{f.relative_to(root)}::{name}")

documented = set(refs)
errors += [f"문서에 없는 테스트: {t}" for t in sorted(actual - documented)]
errors += [f"테스트가 없는 문서 행: {t}" for t in sorted(documented - actual)]
if errors:
    print("\n".join(errors))
    print(f"TEST_CASES 불일치: 문서 {len(rows)}행, 테스트 {len(actual)}건")
    sys.exit(1)
print(f"TEST_CASES 일치: {len(rows)}행 = 테스트 {len(actual)}건")
