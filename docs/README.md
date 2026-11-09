# Documentation Index & Registry

All project documentation is indexed here with its current validity status.

## 1. Root Developer Guides

| Path | Status | Purpose | Notes |
| :--- | :---: | :--- | :--- |
| `AGENTS.md` | `Current` | Workstation harness and global operating environment rules. | Single source of truth for AI agents. |
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
| `AI-CONTEXT.md` | `Current` | Master architecture & invariants briefing for new coding agents. | Covers isolation, money, and data layers. |
| `project-architecture-and-data-flow.md` | `Current` | System architecture, frontend-backend flow, and subsystem map. | Visual diagrams and dataflow. |

## 3. Active Restructure Plans (`docs/features/`)

| Path | Status | Purpose | Notes |
| :--- | :---: | :--- | :--- |
| `kapil-declutter-reorg-plan.md` | `Current` | Master decluttering & repository reorganization plan (Steps 1–7). | Active guide for current declutter. |
| `kapil-restructure-build-plan.md`| `Current` | Master 8-phase implementation plan for 3-module system architecture. | Active reference for ongoing restructure. |
| `restructure-plan.md` | `Current` | High-level requirements for unified items and party ledger hubs. | Initial scope brief. |
| `restructure-progress.md` | `Current` | Active tracking checklist of completed restructuring phases. | Live progress tracker. |
| `keyboard-first-new-bill-and-payment.md` | `Current` | Keyboard-first entry specifications for `Alt+B` rapid billing. | Active UX feature spec. |

## 4. Operations & Diagnostics (`docs/operations/`)

| Path | Status | Purpose | Notes |
| :--- | :---: | :--- | :--- |
| `declutter-inventory.md` | `Current` | Step 1 inventory verifying file references, scanner rules, and DB state. | Generated 2026-11-09. |
| `pocketbase-disaster-recovery.md` | `Current` | Disaster recovery runbook for SQLite data loss or corrupted WAL. | Emergency operational manual. |
| `security-auth-setup.md` | `Current` | PocketBase admin credentials and network security policies. | Security reference. |
| `doppler-secrets.md` | `Current` | Environment secrets management documentation. | Reference. |
| `incident-notes.md` | `Current` | Production postmortems and incident resolution history. | Historical incident record. |
| `deploy/` | `Current` | Nginx reverse-proxy and deployment configurations. | Deployment reference. |

## 5. Historical Archive (`docs/archive/`)
*Ignored by agents during coding tasks. Maintained for git audit history only.*

| Path | Status | Original Subject | Archival Reason |
| :--- | :---: | :--- | :--- |
| `archive/notes/cursor_project_scope_and_organization_d.md` | `Archived` | Early Cursor project handoff dump (125 KB). | Superseded by current architecture docs. |
| `archive/notes/billing-system-explained.md` | `Archived` | Early explanation of billing formulas. | Replaced by `AI-CONTEXT.md`. |
| `archive/notes/procurement-casting-sales-workflow.md` | `Archived` | Early scrap buying workflow proposal. | Describes dropped Scrap Buying designs. |
| `archive/notes/*-page-notes.md` | `Archived` | Individual page notes (new-bill, new-payment, customers, etc.). | Superseded by unified 3-module hub layout. |
| `archive/audits/` | `Archived` | Point-in-time audits (`PURCHASE-MODULE-AUDIT...`, `update-*.md`, `system-map.md`, `ui-system-audit.md`). | Pre-restructure point-in-time snapshots. |
| `archive/muse/` | `Archived` | `MUSE_*.md` (5 files): Prompting & business rules for external Muse sessions. | Retired from root per owner confirmation. |
| `archive/specs/` | `Archived` | `docs/superpowers/` plans and specs from May–Aug 2026. | Historical feature iterations. |
| `archive/agent-work/` | `Archived` | `AgentRouterWork/` scratch worklogs and browser verification artifacts. | Historical AI session artifacts. |
