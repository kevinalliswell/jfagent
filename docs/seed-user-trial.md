# Seed User Trial Guide

## Purpose

This seed trial validates whether data center pre-sales users value the workflow enough to keep using it and pay for polished Word export. It is not a production SaaS launch.

## Who Should Try It

- 3-10 trusted sales or pre-sales users.
- Users who handle real machine-room, data center, UPS, cooling, cabling, or BOQ conversations.
- Users who can give direct feedback on whether the generated requirement sheet saves time.

## What Users Should Do

Ask users to run one real or realistic opportunity through the app:

1. Paste a messy WeChat-style project description.
2. Check whether dashboard fields are extracted correctly.
3. Edit wrong fields manually.
4. Review risk prompts and local knowledge citations.
5. Trigger the 99 RMB Word export willingness flow.
6. Download the generated Word file if they choose the formal version.

Suggested prompt:

```text
某医院老机房改造，50平，3楼，10个机柜，UPS后备2小时，国产优先，预算先按60万以内。
```

## Admin Knowledge Upload

The admin can open:

```text
https://DOMAIN/?admin=1
```

Upload only cleaned internal materials:

- successful proposal snippets
- equipment selection notes
- UPS and battery sizing notes
- precision AC notes
- BOQ or quotation examples
- Word requirement-sheet templates

Avoid uploading:

- customer contacts and phone numbers
- contract numbers
- supplier private terms
- unapproved bottom prices
- highly confidential customer names
- outdated or disputed technical claims

## Feedback Questions

Ask each seed user:

- Did the first answer feel like a senior pre-sales colleague?
- Which extracted fields were useful or wrong?
- Did the knowledge citations increase trust?
- Which risk reminder felt commercially useful?
- Did the BOQ or quotation clues help?
- Would you pay 99 RMB for the Word output in this scenario?
- What is the one thing that must improve before you use it in real work?

## Known Trial Limits

- No formal login system; access is controlled by Caddy Basic Auth in the seed Docker Compose deployment.
- No multi-tenant isolation.
- Session state is in memory and can reset when the backend restarts.
- The current agent is rule/mock driven, not a real LLM.
- `local-hash-v1` is a lightweight retrieval baseline, not true semantic embeddings.
- Word export is first-pass and may need manual formatting review.
- The 99 RMB step records willingness only; it is not real payment.

## Success Criteria

The trial is successful if at least two users say:

- the workflow saves pre-sales整理 time,
- uploaded internal knowledge improves answer usefulness,
- they would consider paying for formal export or using it in a paid pilot.
