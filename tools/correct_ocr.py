#!/usr/bin/env python3
"""The OCR correction pass, as reproducible code -> static/data/page_corrected.json.

    pip install anthropic
    python3 tools/correct_ocr.py --dry-run     # print the exact prompt, call nothing
    python3 tools/correct_ocr.py               # submit a batch (costs money, asks first)

Raised in review: the page text in this post went through an LLM that resolved garbled OCR runs
to their nearest sensible reading, and that pass had no shipped code -- so a second generative
model sat between the reader and the evidence, unauditable. The original pass cannot be recovered.
This is a stated, runnable replacement for it, which is the part that actually matters: the prompt
below is the whole method, and anyone can read it, change it, or run it against their own pages.

Two deliberate differences from the original pass, both aimed at the same problem:

  1. It is asked to be CONSERVATIVE. Where a run is too destroyed to recover, it must leave a
     marker rather than invent a plausible sentence. The original pass produced uniformly fluent
     text, which is exactly what makes it hard to see where it was guessing.
  2. It reports its own uncertainty per page (`confidence`, `unrecoverable`), so the output
     carries a record of where the model was working blind.

It writes to page_corrected.json and never touches the `abstract`/`refs` fields the post
currently displays. That is on purpose: those came from the original pass, section 8 measures
against them, and silently replacing them would erase the very gap the section is about. Run this,
then diff the two -- the disagreement between two correction passes over the same pixels is a
better measure of how much either one is inventing than either one is on its own.

Input is static/data/page_ocr.json (tools/page_ocr.py), so the whole chain runs from this repo.
"""
import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = "claude-opus-5"
MAX_TOKENS = 16000

SYSTEM = """\
You are transcribing text that was OCR'd off a low-resolution rendering of a scientific paper. \
The page was not typed by anyone -- it was drawn by an image generation model -- so the glyphs \
frequently do not spell anything, and the OCR output is correspondingly damaged.

Your job is to recover what the page was most likely trying to say, and to be honest about where \
you cannot.

Rules, in priority order:

1. NEVER invent content. If a run of text is too damaged to recover with confidence, replace it \
with the marker [unrecoverable] and list the raw fragment in `unrecoverable`. A marker is always \
better than a fluent guess. This is the single most important rule.

2. Fix only what OCR plausibly got wrong: character confusions (rn/m, cl/d, 0/O), split or joined \
words, dropped diacritics, and obvious scanning noise. "acrial imegery" -> "aerial imagery" is a \
correction. Rewriting a broken clause into a grammatical sentence is not.

3. Do not improve the writing. Do not complete sentences the page left unfinished, fix grammar, \
reorder clauses, or make the argument cohere. If the underlying page is nonsense, the \
transcription should read as nonsense.

4. Preserve structure: keep section headings, reference numbering and line ordering as they appear.

5. Do not add citations, numbers, results or any factual content that is not in the input.

Set `confidence` to how much of the page you recovered without guessing: "high" if nearly all of \
it, "medium" if you left a few markers, "low" if the page is mostly unrecoverable."""

SCHEMA = {
    "type": "object",
    "properties": {
        "corrected": {
            "type": "string",
            "description": "The recovered text, with [unrecoverable] markers where recovery failed.",
        },
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "unrecoverable": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Raw fragments that could not be recovered, verbatim from the input.",
        },
    },
    "required": ["corrected", "confidence", "unrecoverable"],
    "additionalProperties": False,
}


def load_pages():
    path = f"{ROOT}/static/data/page_ocr.json"
    if not os.path.exists(path):
        sys.exit(f"missing {path} -- run tools/page_ocr.py first")
    pages = json.load(open(path))["pages"]
    return {k: v["raw"] for k, v in sorted(pages.items()) if v.get("raw")}


def build_params(raw):
    """One request's params. Kept separate so --dry-run shows exactly what would be sent."""
    return dict(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM,
        messages=[{"role": "user", "content": f"Raw OCR output:\n\n{raw}"}],
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="print the prompt and one example request, call nothing")
    ap.add_argument("--limit", type=int, help="only process the first N pages")
    ap.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    args = ap.parse_args()

    pages = load_pages()
    if args.limit:
        pages = dict(list(pages.items())[: args.limit])

    if args.dry_run:
        first = next(iter(pages.items()))
        print("=" * 70, "\nSYSTEM PROMPT\n", "=" * 70, sep="")
        print(SYSTEM)
        print("\n" + "=" * 70, "\nEXAMPLE REQUEST (", first[0], ")\n", "=" * 70, sep="")
        print(json.dumps(build_params(first[1][:600] + " ..."), indent=2)[:2600])
        print(f"\n{len(pages)} pages would be submitted as one batch.")
        return

    import anthropic
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    # The Batches API runs asynchronously at half price, which is the right trade for 100 pages
    # nobody is waiting on.
    approx_in = sum(len(r) for r in pages.values()) // 4 + len(pages) * len(SYSTEM) // 4
    print(f"{len(pages)} pages, roughly {approx_in:,} input tokens, batch pricing (50% off).")
    if not args.yes and input("submit? [y/N] ").strip().lower() != "y":
        sys.exit("cancelled")

    client = anthropic.Anthropic()
    batch = client.messages.batches.create(requests=[
        Request(custom_id=key.replace(".png", ""),
                params=MessageCreateParamsNonStreaming(**build_params(raw)))
        for key, raw in pages.items()
    ])
    print("batch", batch.id, batch.processing_status)

    while True:
        batch = client.messages.batches.retrieve(batch.id)
        if batch.processing_status == "ended":
            break
        print("  ", batch.processing_status, batch.request_counts, flush=True)
        time.sleep(30)

    out, failed = {}, {}
    for result in client.messages.batches.results(batch.id):
        key = result.custom_id + ".png"
        if result.result.type != "succeeded":
            failed[key] = result.result.type
            continue
        msg = result.result.message
        if msg.stop_reason == "refusal":                      # HTTP 200, no usable content
            failed[key] = "refusal"
            continue
        # output_config.format guarantees the first text block is valid JSON against SCHEMA
        text = next(b.text for b in msg.content if b.type == "text")
        data = json.loads(text)
        out[key] = dict(
            corrected=data["corrected"],
            confidence=data["confidence"],
            unrecoverable=data["unrecoverable"],
            n_unrecoverable=len(data["unrecoverable"]),
        )

    levels = [v["confidence"] for v in out.values()]
    payload = dict(
        model=MODEL, batch_id=batch.id, system=SYSTEM, schema=SCHEMA,
        n=len(out), failed=failed,
        summary=dict(
            high=levels.count("high"), medium=levels.count("medium"), low=levels.count("low"),
            marked=sum(1 for v in out.values() if v["n_unrecoverable"]),
            total_unrecoverable=sum(v["n_unrecoverable"] for v in out.values()),
        ),
        pages=out,
    )
    dest = f"{ROOT}/static/data/page_corrected.json"
    json.dump(payload, open(dest, "w"), separators=(",", ":"))
    print(json.dumps(payload["summary"], indent=2))
    if failed:
        print("failed:", failed)
    print("wrote", dest)


if __name__ == "__main__":
    main()
