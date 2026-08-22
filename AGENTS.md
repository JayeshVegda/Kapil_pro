# Kapil Pro Agent Workflow

## Windows Local-Primary Authority

This `kapil-windows` branch is the Windows-PC-only edition. Read `WINDOWS-SETUP.md`,
`DATABASE-RUNBOOK.md`, and `TROUBLESHOOTING.md` before changing runtime or database
behavior.

- The sole writable database is `runtime/data/data.db` on the Windows PC.
- PocketBase listens only on `127.0.0.1:8090`; Caddy listens only on `127.0.0.1:4174`.
- Never change either listener to `0.0.0.0` or a LAN address unless the owner explicitly requests a new security design.
- Never commit anything under `runtime/`, any `.env`, database, backup, executable, log, or credential.
- Before database-affecting work, run `windows/health-check.ps1` and `windows/backup-kapil.ps1`.
- Never copy, replace, compress, or edit an active SQLite database. Use the supplied stop/backup/restore scripts.
- Never create bidirectional synchronization or a second writable database.
- Do not use VPS deployment scripts on this branch. Windows operations belong in `windows/`.
- Run `npm run verify` after application changes and inspect `git status --ignored` before committing.

The safe operator commands are:

```powershell
.\windows\start-kapil.ps1
.\windows\stop-kapil.ps1
.\windows\health-check.ps1
.\windows\backup-kapil.ps1
.\windows\restore-kapil.ps1 -Archive <verified-zip>
```

Use the installed skills as part of normal work in this project. Pick the smallest relevant set for the task, read each selected skill before acting, and mention which skills are being used.

## Project Direction

Kapil Pro should move toward a modern, practical, simple business interface:

- clear hierarchy before decoration
- data visualizations that explain decisions, not just charts
- compact operational screens for fast entry
- readable financial numbers with consistent labels and drill-down paths
- mobile layouts that prioritize the most common actions

## Theme Preference

Prefer a modern, practical, simple Kapil Pro theme over dramatic redesigns:

- use the existing slate/blue business-tool identity as the default
- keep surfaces calm: white panels, slate dividers, soft blue highlights, restrained green/red/amber status colors
- avoid black feature blocks, heavy gradients, loud shadows, decorative cards, or finance-terminal styling unless explicitly requested
- make improvements feel integrated with the current app, not like a separate dashboard template
- optimize for fast operator scanning: compact spacing, aligned numbers, tabular figures, clear labels, and minimal visual noise

## Skill Routing

- `using-superpowers`: general skill-discovery discipline at the start of work.
- `brainstorming`: required before creative product work, new features, behavior changes, or page redesigns.
- `frontend-design`: visual direction, typography, layout personality, and avoiding generic dashboard UI.
- `vercel-react-best-practices`: React, TanStack-style UI state, component structure, performance, or frontend architecture changes.
- `webapp-testing`: browser testing, screenshots, responsive checks, accessibility smoke tests, and end-to-end user flows.
- `tdd`: financial math, ledger logic, parser behavior, allocation, status engines, and risky domain changes.
- `qa`: release checks, regression sweeps, acceptance criteria, and manual verification plans.
- `improve-codebase-architecture`: larger refactors, page decomposition, shared domain/data boundaries, and preparing new modules.
- `architecture-review`: evaluating stack additions such as chart libraries, reporting tools, backend services, or deployment changes.
- `shadcn`: shared UI primitives, Tailwind component patterns, forms, dialogs, tables, buttons, tabs, and design-system consistency.
- `xlsx`: Excel import/export, workbook generation, CSV/XLSX report work, and spreadsheet compatibility.
- `pdf`: report PDFs, bill PDFs, statement PDFs, print/export formatting, and PDF inspection.
- `docx`: Word document generation or parsing when business documents are involved.
- `handoff`: long-running work, major redesigns, or sessions that need continuity for another agent.
- `web-design-guidelines`: UI/UX review, accessibility, responsive design, and visual quality audits.
- `kibana-dashboards`: dashboard thinking for observability-style panels, filtering, drill-down, and operational data views.
- `data-visualizer`: chart and visualization planning when turning raw business data into understandable views.
- `chart-designer`: chart selection, dashboard layout, chart configuration, and visual encoding for business metrics.

## Skills Not Used By Default

The following installed skills are available globally but should not be part of the normal Kapil Pro workflow unless a task explicitly needs them:

- `homelab-network-setup`, `homelab-network-readiness`: only for network/router/VPN/DNS work.
- `azure-enterprise-infra-planner`: only for Azure infrastructure planning.
- `crm-builder`: only if building a separate CRM-style domain from a domain brief.
- `trading-analysis`, `trading-signal`: only for market/trading requests, not Kapil billing UI.
- `find-skills`: only when discovering or installing more skills.

## Kapil-Specific Guardrails

- Keep calculations in `src/domain`, PocketBase reads/writes in `src/data`, and page orchestration in `src/routes`.
- Do not duplicate outstanding balance, bill status, or payment allocation logic inside route components.
- Preserve financial ordering: business date, then created timestamp, then record id.
- Prefer incremental redesigns of high-value pages first: Dashboard, Party Ledger, Company Report, Calendar, and Casting.
- For visualization work, keep audit tables available but lead with summary, trend, risk, ranking, and drill-down views.
