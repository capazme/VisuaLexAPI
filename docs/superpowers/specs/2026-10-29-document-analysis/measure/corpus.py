"""Reads the annotated corpus: [[span|act_type|number|year|articles|flag]] -> plain text + expected items."""
import json, re, sys
from pathlib import Path

ANN = re.compile(r"\[\[(.+?)\]\]")


def load(path: Path):
    src = path.read_text(encoding="utf-8")
    out, items, pos, last = [], [], 0, 0
    for m in ANN.finditer(src):
        out.append(src[last:m.start()])
        pos += m.start() - last
        parts = m.group(1).split("|")
        span, act, num, year, arts = parts[:5]
        flag = parts[5] if len(parts) > 5 else ""
        start = pos
        out.append(span)
        pos += len(span)
        items.append({"start": start, "end": pos, "text": span, "act_type": act, "act_number": num,
                      "date": year, "articles": [a for a in arts.split(",") if a], "flag": flag})
        last = m.end()
    out.append(src[last:])
    return "".join(out), items


if __name__ == "__main__":
    corpus, dest = Path(sys.argv[1]), Path(sys.argv[2])
    dest.mkdir(parents=True, exist_ok=True)
    for f in sorted(corpus.glob("*.txt")):
        text, items = load(f)
        (dest / f.name).write_text(text, encoding="utf-8")
        (dest / (f.stem + ".expected.json")).write_text(json.dumps(items, ensure_ascii=False, indent=1))
        print(f.name, len(items))
