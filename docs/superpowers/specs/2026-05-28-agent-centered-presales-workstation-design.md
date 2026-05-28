# Agent-Centered Presales Workstation Design

Date: 2026-05-28  
Status: Draft for review  
Scope: End-state product and architecture design for the data center presales AI agent

## 1. Purpose

This document defines the preferred end-state design for the product beyond the current local-first MVP. The chosen direction is not a project form with a chat assistant attached, and not a generic knowledge bot. It is an agent-centered presales workstation for data center and machine-room construction teams.

The system should serve multiple roles inside an integration company, with presales engineers as the professional core, while also supporting sales, small-business owners, managers, and other internal collaborators.

## 2. Current-State Review

The current codebase already proves several important product ideas:

- Chat-style intake for messy WeChat-like project descriptions.
- A structured dashboard that can override extracted values.
- Local knowledge retrieval with visible citations.
- Early BOQ and quotation ingestion.
- Backend API boundaries for chat, override, export, and admin knowledge upload.
- A first-pass Word export payload and `.docx` rendering path.

The current implementation is still an MVP skeleton rather than an end-state system:

- Agent behavior is mostly mock extraction plus deterministic heuristics.
- Session authority is in-memory and single-node.
- Knowledge is local-file-based, not a governed shared service.
- There is no personal memory model.
- There is no team collaboration, approval, or audit workflow.
- The current architecture is still chat-driven rather than domain-driven.

This means the next long-term architecture should not merely add features to the existing UI. It should promote projects, knowledge, rules, exports, and governance into first-class domains behind an agent-centered entry point.

## 3. Chosen Direction

### 3.1 Selected Product Route

The selected end-state route is:

`B. Agent-centered workstation with dual workstreams`

This route keeps the agent as the main entry point while avoiding an early jump into a heavy enterprise process platform.

### 3.2 Core Design Choices

The following decisions were confirmed during brainstorming:

- System center: `agent-centered`
- User model: `multi-role`
- Role entry model: `same foundation, different role-specific entry views`
- Collaboration model: `dual workstreams`
- Agent autonomy: `semi-autonomous`
- Integration model: `light integrations`
- Memory model: `enterprise shared memory + personal memory`

### 3.3 What The Product Is

The product is an enterprise presales intelligence workstation that:

- helps teams move customer opportunities forward,
- helps presales engineers learn and improve continuously,
- captures project experience as reusable knowledge,
- and provides controllable, auditable AI-assisted output generation.

## 4. Top-Level Product Definition

### 4.1 Primary Entry Point

The primary entry point is the `Agent Workstation`.

Users should first interact with the agent, not with a raw project table or raw knowledge library. The agent is responsible for:

- understanding user intent,
- identifying whether the user is working on a project or on knowledge growth,
- assembling the right context,
- proposing next actions,
- calling downstream domain capabilities,
- and explaining why it made a recommendation.

### 4.2 Dual Workstreams

The system runs on two parallel workstreams:

1. `Project Collaboration Workstream`
   - From messy lead intake to structured project understanding, risk evaluation, solution drafting, quote support, and formal export.

2. `Knowledge Growth Workstream`
   - From daily learning and experience accumulation to personal notes, reusable patterns, review, and eventual promotion into enterprise-shared knowledge.

These two workstreams should reinforce each other. Project work creates candidate knowledge. Knowledge growth improves future project work.

### 4.3 Dual Memory Model

The agent uses two memory layers:

1. `Enterprise Shared Memory`
   - standard solutions
   - proposal patterns
   - vendor documents
   - rules and calculation guidance
   - approved historical cases
   - terminology and style references

2. `Personal Memory`
   - private notes
   - personal learning records
   - drafting preferences
   - provisional experience summaries
   - candidate insights not yet promoted to shared knowledge

The agent should reason from `project context + enterprise memory + personal memory`, not from a single flat knowledge store.

## 5. Functional Capability Blueprint

The end-state product should be organized into six capability packages.

### 5.1 Agent Interaction Package

- multi-turn chat
- context switching between project work and learning work
- proactive clarification prompts
- explainability for citations, rules, and recommendations
- action proposal with explicit user confirmation for sensitive operations

### 5.2 Project Operations Package

- lead intake from chat, files, and imported external signals
- structured requirement sheet generation
- project cards with status, assumptions, constraints, and open items
- risk tracking
- solution draft preparation
- quote-support material preparation
- export-ready asset preparation

### 5.3 Knowledge Growth Package

- daily technical Q&A
- terminology and equipment learning
- case review
- personal note capture
- reusable pattern detection
- candidate knowledge promotion workflow
- enterprise knowledge enrichment after approval

### 5.4 Professional Judgment Package

- deterministic calculation engines
- risk triggers
- field precedence enforcement
- constraint validation
- rule-backed explanations

This package must remain separate from model-only reasoning.

### 5.5 Organizational Collaboration Package

- comments and mentions
- role-aware review flows
- export confirmation
- knowledge-entry review
- cross-role visibility for project outcomes and important decisions

### 5.6 Embedded Workflow Package

- CRM synchronization
- enterprise chat synchronization
- email and file-reference flow
- document storage integration
- light workflow handoff to other business systems

This package should emphasize synchronization and handoff before attempting deep workflow automation.

## 6. Domain Module Architecture

The recommended end-state architecture has eight first-class domains.

### 6.1 Agent Workstation Domain

Responsibilities:

- unified interaction layer
- intent routing
- context assembly
- next-step planning
- tool and domain orchestration
- explanation and confirmation UX

### 6.2 Project Collaboration Domain

Responsibilities:

- project container and lifecycle
- structured project fields
- constraints, assumptions, and open questions
- risk list for each project
- project-linked source materials
- project-linked output preparation state

This domain is the source of truth for project state.

### 6.3 Knowledge Growth Domain

Responsibilities:

- enterprise knowledge base
- personal note base
- review queues for promotion into shared knowledge
- taxonomy, source tracking, and lifecycle management

This domain is the source of truth for managed knowledge assets and personal memory records.

### 6.4 Rules And Calculation Domain

Responsibilities:

- deterministic engineering calculations
- hard risk triggers
- export-blocking validation
- field-precedence enforcement

This domain is the source of truth for rule outputs and deterministic evaluation results.

### 6.5 Deliverables Domain

Responsibilities:

- requirement-sheet versions
- proposal versions
- export payload snapshots
- downloadable assets
- release and approval history

This domain is the source of truth for formal deliverables.

### 6.6 Collaboration And Approval Domain

Responsibilities:

- task handoff
- comments and mentions
- review and approval checkpoints
- knowledge promotion review
- formal output approval

### 6.7 Light Integration Domain

Responsibilities:

- CRM connectors
- enterprise messaging connectors
- email/file sync connectors
- event ingestion and outbound notification adapters

### 6.8 Identity And Governance Domain

Responsibilities:

- tenant isolation
- organization and team structure
- roles and permissions
- audit trails
- policy enforcement
- model access controls

## 7. Responsibility Boundaries

The system must enforce the following boundary:

`The agent is the entry point and coordinator, not the final source of truth for all state.`

Truth ownership should be separated as follows:

- `Project Collaboration Domain`: project state and structured field truth
- `Knowledge Growth Domain`: enterprise knowledge and personal memory truth
- `Rules And Calculation Domain`: deterministic logic truth
- `Deliverables Domain`: formal output truth

This prevents the following long-term problems:

- chat transcripts accidentally becoming the business system of record
- model output silently overwriting reviewed state
- mixed storage of project facts and reusable knowledge
- untraceable exports with unclear source provenance

## 8. Core Runtime Flows

### 8.1 Project Collaboration Flow

1. User provides chat text, files, or synced opportunity signals.
2. Agent identifies project intent and assembles project context.
3. Project domain receives extracted fields, assumptions, and open items.
4. Knowledge domain returns evidence from enterprise memory and personal memory.
5. Rules domain evaluates calculations, constraints, and risk triggers.
6. Agent explains findings and proposes next actions.
7. User confirms changes when needed.
8. Deliverables domain creates draft artifacts or formal export snapshots.
9. Collaboration domain routes approvals.
10. Integration domain syncs approved outcomes outward when required.

### 8.2 Knowledge Growth Flow

1. User asks a learning question or records an insight.
2. Agent identifies knowledge-growth intent.
3. Knowledge domain retrieves enterprise references and personal memory.
4. Agent answers, summarizes, or structures the insight.
5. Personal memory stores the learning artifact.
6. System detects whether it is a candidate for enterprise reuse.
7. Collaboration domain sends the candidate into review.
8. Approved content becomes enterprise shared memory and can assist future projects.

## 9. Role Model

The foundation is shared, but entry experiences differ by role.

### 9.1 Presales Engineer

- deepest interaction with agent
- strongest access to structured project reasoning
- strongest use of personal memory and technical learning

### 9.2 Sales

- opportunity intake
- project visibility
- requirement clarification support
- progress tracking and customer-facing preparation support

### 9.3 Owner / Manager

- visibility into project health, risks, and output quality
- review and approval rights
- organizational knowledge visibility and operational oversight

### 9.4 Other Internal Roles

- scoped access according to need
- result-oriented interaction rather than full engineering control

## 10. Governance And Platform Boundaries

The end-state product must explicitly define six governance boundaries.

### 10.1 Organization And Tenant Boundary

All projects, knowledge assets, exports, and memory records belong to an organization by default. Team-level and user-level scoping must be available from the beginning of the SaaS architecture.

### 10.2 Permission And Visibility Boundary

Permissions must control more than page visibility. They must control:

- which projects are visible,
- which agent capabilities can be used,
- which enterprise knowledge is readable,
- whether personal memory is private or shareable,
- and who can promote content into enterprise-shared memory.

### 10.3 Memory Governance Boundary

- Enterprise memory requires review, source tracking, tags, and versioning.
- Personal memory can be flexible, but it must not silently contaminate enterprise memory.
- Project memory should be treated as project context assets, not as generic knowledge entries.

### 10.4 Audit And Traceability Boundary

Critical outputs must always be traceable back to:

- referenced knowledge,
- triggered rules,
- manual overrides,
- and the versioned project state used for final export.

### 10.5 Execution And Approval Boundary

Semi-autonomous behavior must be action-tiered:

- Auto-allowed: extraction, suggestions, draft generation, candidate knowledge creation
- Human-confirmed: external sync, formal export release, shared knowledge promotion, final customer-facing output

### 10.6 Reliability And Evaluation Boundary

The product should be measured through operational quality, not only chat quality:

- field extraction accuracy
- risk miss rate
- citation hit rate
- deliverable usability
- approval pass rate
- manual rewrite rate

## 11. Gap Assessment Against The Current Codebase

### 11.1 Strong Existing Foundations

- `src/App.tsx` already demonstrates the workstation interaction pattern.
- `src/sessionApi.ts` and `server/` already establish the future backend boundary.
- `server/exportPayload.ts` already points toward a formal deliverables domain.
- `knowledge_base.md`, `rules.md`, and `templates.md` already give the product a domain-rich backbone.

### 11.2 Major Missing End-State Domains

- personal memory
- knowledge-growth workflow
- collaboration and approval
- identity and governance
- persistent project authority
- auditable retrieval and reasoning records

### 11.3 Architectural Risks In The Current MVP

- UI and orchestration responsibilities remain too concentrated in `src/App.tsx`
- mock behavior still carries product meaning that should move behind backend domains
- chat is still too close to being the implicit system of record
- retrieval is still a local-index implementation detail instead of a governed knowledge service

## 12. Recommended End-State Principle

The most important principle for the product is:

`Make the agent the front door, but never let it become the only container for truth.`

That principle keeps the experience intelligent without sacrificing enterprise control, cross-role collaboration, or long-term SaaS maintainability.

## 13. What This Design Explicitly Rejects

- A project-management-first product with a thin chatbot add-on
- A pure enterprise knowledge bot with weak project closure
- A strong-autonomy agent that can publish outputs or modify shared knowledge without human checkpoints
- A flat knowledge system with no distinction between project memory, personal memory, and enterprise memory
- A front-end-heavy architecture where future governance must be retrofitted after feature growth

## 14. Design Outcome

The preferred end-state is an agent-centered presales workstation with:

- multi-role role-specific entry experiences,
- dual project and knowledge workstreams,
- dual enterprise and personal memory layers,
- deterministic professional judgment domains,
- formal deliverable ownership,
- light external integrations,
- and explicit governance, audit, and approval boundaries.

This is the recommended north star for future planning and implementation sequencing.
