# Documentation Index & Registry

All project documentation is indexed here with its current validity status.

## 1. Root Developer Guides

| Path | Status | Purpose | Notes |
| :--- | :---: | :--- | :--- |
| `AGENTS.md` | `Current` | Workstation harness, invariants, drift-prevention business rules. | Single source of truth for AI agents. |
| `CLAUDE.md` | `Current` | Developer command reference, test rules, and financial invariants. | Quick developer pointer. |
| `README.md` | `Current` | Human-facing project overview and Windows local-primary intro. | Entry point for repository. |
| `PRODUCT.md` | `Current` | High-level product summary and business goals. | Kept brief. |
| `DATABASE-RUNBOOK.md` | `Current` | PocketBase SQLite backup, restore, and WAL maintenance guide. | Essential runbook. |
| `TROUBLESHOOTING.md` | `Current` | Common error resolution for PocketBase, ports, and Caddy. | Operational guide. |
| `WINDOWS-SETUP.md` | `Current` | Windows production PC setup and dependency bootstrap guide. | Production host setup. |
| `WINDOWS-LOCAL-HANDOFF.md`| `Current` | Production handoff instructions for running on the Windows PC. | Deployment guide. |

## 2. Architecture (`docs/architecture/`)

| Path | Status | Purpose | Notes |
| :--- | :---: | :--- | :--- |
| `CURRENT-STATE.md` | `Current` | Live routes, verified collections, data-flows, and settings architecture. | Updated 2026-11-09. |
| `DECISIONS.md` | `Current` | Durable one-line rationale for every major architectural decision. | Core architectural record (22 decisions). |
| `project-architecture-and-data-flow.md` | `Current` | System architecture, frontend-backend flow, and subsystem map. | Visual diagrams and dataflow. |

## 3. UI Design System (`docs/ui/`)

| Path | Status | Purpose | Notes |
| :--- | :---: | :--- | :--- |
| `CONVENTIONS.md` | `Current` | Design tokens, canonical component kit, colour/status map, cookbook. | Single UI standard. |

## 4. Active Restructure Plans (`docs/features/`)

| Path | Status | Purpose | Notes |
| :--- | :---: | :--- | :--- |
| `kapil-declutter-reorg-plan.md` | `Current` | Master decluttering & repository reorganization plan (Steps 1–7). | Active guide for current declutter. |
| `kapil-restructure-build-plan.md`| `Current` | Master 8-phase implementation plan for 3-module system architecture. | Active reference for ongoing restructure. |
| `restructure-plan.md` | `Current` | High-level requirements for unified items and party ledger hubs. | Initial scope brief. |
| `restructure-progress.md` | `Current` | Active tracking checklist of completed restructuring phases. | Live progress tracker. |
| `keyboard-first-new-bill-and-payment.md` | `Current` | Keyboard-first entry specifications for rapid billing. | Active UX feature spec. |

## 5. Operations & Diagnostics (`docs/operations/`)

| Path | Status | Purpose | Notes |
| :--- | :---: | :--- | :--- |
| `declutter-inventory.md` | `Current` | Step 1 inventory verifying file references, scanner rules, and DB state. | Generated 2026-11-09. |
| `pocketbase-disaster-recovery.md` | `Current` | Disaster recovery runbook for SQLite data loss or corrupted WAL. | Emergency operational manual. |
| `security-auth-setup.md` | `Current` | PocketBase admin credentials and network security policies. | Security reference. |
| `doppler-secrets.md` | `Current` | Environment secrets management documentation. | Reference. |
| `incident-notes.md` | `Current` | Production postmortems and incident resolution history. | Historical incident record. |

## 6. Historical Archive (`docs/archive/`)
*Ignored by agents during coding tasks. Maintained for git audit history only.*

| Path | Status | Original Subject | Archival Reason |
| :--- | :---: | :--- | :--- |
| `archive/notes/AI-CONTEXT.md` | `Archived` | Early AI agent briefing. | Superseded by canonical `AGENTS.md` and `CURRENT-STATE.md`. |
| `archive/notes/cursor_project_scope_and_organization_d.md` | `Archived` | Early Cursor project handoff dump (125 KB). | Superseded by current architecture docs. |
| `archive/notes/billing-system-explained.md` | `Archived` | Early explanation of billing formulas. | Replaced by `CURRENT-STATE.md`. |
| `archive/notes/procurement-casting-sales-workflow.md` | `Archived` | Old Scrap Buying workflow notes. | Replaced by new Purchase/Procurement specs. |
| `archive/muse/` | `Archived` | Muse prompt iterations (`MUSE_PROMPT.md`, etc.). | Preserved for prompt engineering history. |
| `archive/specs/` | `Archived` | Superpowers plans (`superpowers/specs/`). | Completed redesign cycles. |
| `archive/audits/` | `Archived` | Historic RAM audits and performance postmortems. | Diagnostic history. |
| `archive/agent-work/` | `Archived` | AgentRouterWork directory and session notes. | Archival record of previous agent tasks. |
