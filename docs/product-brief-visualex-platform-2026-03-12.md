# Product Brief: Visualex Platform

**Date:** 2026-03-12
**Author:** gpuzio
**Version:** 1.0
**Project Type:** web-app
**Project Level:** 3

---

## Executive Summary

Visualex Platform is a web portal for legal professionals that centralizes normative text research and analysis — currently fragmented across outdated government sites, annotation platforms, and scattered jurisprudence sources. By operationalizing legal research workflows, the platform enables both daily efficiency for practitioners and the advancement of computational legal research, with the ultimate goal of creating a "social training" ecosystem — the only scalable approach for an interpretive discipline like law.

---

## Problem Statement

### The Problem

Legal professionals today face a fragmented and friction-heavy research experience. To analyze a single norm, a jurist must:
1. Navigate to **Normattiva** — a slow, static, outdated government portal — to find the normative text
2. Move to **Brocardi** (also dated) for supplementary annotations and commentary
3. Search across blogs, databases, and scattered sources for relevant jurisprudence
4. Manually cross-reference and follow normative links across these disparate sources

There is no unified platform supporting the **analytical phase** of legal work (as opposed to office management tools). Practitioners often don't know where to start, and the complexity of modern legislation makes unaided research increasingly untenable.

### Why Now?

- **Technological maturity**: AI-assisted development tools (Claude Max + BMAD Method) enable a domain expert (lawyer-programmer) to build production-quality software that truly serves legal professionals
- **Growing legislative complexity**: The volume and interconnectedness of norms continues to accelerate, making manual research increasingly unsustainable
- **Digital readiness**: Even the legal profession is gradually embracing digital tools, creating a window for well-designed solutions

### Impact if Unsolved

Practitioners will continue drowning in bureaucratic overhead as legislative complexity grows unchecked. This fuels **legal uncertainty** — slow research leads to incomplete analysis, missed precedents, and ultimately lower quality legal work. Fast-moving times demand fast tools.

---

## Target Audience

### Primary Users

- **Lawyers (avvocati)** — Daily research for case preparation, filings, and opinions
- **Magistrates** — Normative analysis for rulings and decisions
- **Notaries** — Legislative verification for contracts and deeds
- **Tax consultants (commercialisti)** — Tax law and regulatory research
- **Legal consultants** — Cross-domain regulatory analysis
- **Citizens** — Anyone needing to understand the law (the law belongs to everyone)

Tech-savviness varies widely: from senior practitioners with minimal digital skills to digital-native junior associates and law students. The platform must serve all levels.

### Secondary Users

- **Universities and academia** — Legal research and teaching
- **Public Administration (PA)** — Regulatory compliance and analysis
- **Law firms (as organizations)** — Team-wide research standardization

### User Needs

1. **Follow normative cross-references** — Navigate the web of legal citations efficiently, without manually jumping between sites
2. **Find relevant jurisprudence** — Discover court decisions and precedents connected to specific norms
3. **Save and organize legal knowledge** — Personal collections (bookmarks, dossiers, notes) that persist and structure ongoing research

---

## Solution Overview

### Proposed Solution

A unified web platform that aggregates Italian and EU legal sources (Normattiva, EUR-Lex, Brocardi) into a single, modern interface with personal knowledge management and collaborative features. The platform has two dimensions:
- **Personal**: Search, bookmarks, dossiers, workspace, annotations — individual research efficiency
- **Collaborative**: Shared environments, discussion, knowledge sharing — toward a "legal social network" reviving the *disputatio fori*

### Key Features

**Current (MVP):**
- Multi-source normative search (Normattiva, EUR-Lex, Brocardi)
- Article text visualization with Brocardi annotations (position, ratio, explanation, maxims)
- Article tree navigation for complete legal acts
- Bookmarks for quick-access saved articles
- Dossiers for organized research collections (multi-article, status tracking, drag & drop)
- Workspace with tabbed content management
- PDF export via Playwright
- Search history
- Shared environments (in development)
- Version support (current vs. original text, date-specific versions)

**To Refine for Launch:**
- Collaborative dimension (shared environments, communication, sharing workflows)
- UI/UX polish for a seamless experience
- Social dynamics (to be explored in PRD/architecture phase)

### Value Proposition

- **Superior UX**: Modern, clean interface vs. the outdated, clunky experience of Normattiva, Brocardi, and existing legal tools (DeJure, Pluris, One LEGALE)
- **Personal knowledge management**: Unprecedented ability to save, annotate, organize, and revisit legal research — no competitor offers this integrated experience
- **Centralization**: One platform replaces multiple sites, eliminating context-switching and click fatigue

---

## Business Objectives

### Goals

- Launch a stable, polished beta to an existing community of enthusiastic testers
- Establish Visualex as the reference platform for digital legal research in Italy
- Build a sustainable freemium model (free research + paid premium features)
- Grow an engaged community of legal professionals who actively use and recommend the platform
- Maintain open-source ethos while covering infrastructure costs

### Success Metrics

- **Retention rate** — Users returning after first week (primary metric)
- **Dossiers created per user** — Deep engagement with personal knowledge management
- Weekly Active Users (WAU) as growth indicator
- Free-to-paid conversion rate

### Business Value

The goal is **authority over profit**. Success is measured in becoming the trusted, go-to platform for legal research — earning recognition from the legal community, academic citations, and word-of-mouth recommendations. Revenue should cover costs and sustain development, not maximize extraction.

---

## Scope

### In Scope

- Multi-source normative text search and retrieval (Normattiva, EUR-Lex, Brocardi)
- Article visualization with annotations and cross-references
- Personal knowledge management (bookmarks, dossiers, workspace, notes)
- Collaborative/shared environments
- Social dynamics (exploration phase — to be defined in PRD)
- PDF export
- User authentication and profiles (Node.js backend)
- Freemium model implementation
- UI/UX refinement for launch quality
- Responsive web application

### Out of Scope

- Law firm/office management (gestionale)
- Billing and invoicing
- PEC (certified email) integration
- Integration with legal practice management software
- AI-powered generative features (document drafting, automated legal writing)
- Workflow/redaction tools for legal document creation
- Mobile native apps

### Future Considerations

- Complete social network features (*disputatio fori*)
- Public API for third-party integrations
- AI-assisted research suggestions and analysis
- Mobile application

---

## Key Stakeholders

- **gpuzio (Founder / Developer / Domain Expert)** — Influence: High. Sole developer and product owner. Lawyer-programmer with deep domain expertise and full technical control. Drives all product, technical, and business decisions.

---

## Constraints and Assumptions

### Constraints

- **Budget**: Personal time + Claude Max subscription only — no external funding
- **Resources**: Single developer (one-man team)
- **Infrastructure**: Single AWS EC2 instance for initial deployment
- **External dependencies**: Scraping relies on HTML structure of Normattiva, EUR-Lex, and Brocardi
- **Tech stack**: Existing codebase (Python/Quart + Node.js/Express + React/TypeScript) — evolution, not rewrite

### Assumptions

- Legal professionals will adopt a new tool if the UX provides clear, immediate time savings
- Normattiva/Brocardi HTML structures will remain stable (recent government restyle suggests ~10 years before next change)
- A single EC2 instance is sufficient for beta phase and initial growth
- The freemium model can sustain infrastructure costs in the medium term
- Legal data is public domain — no regulatory barriers to scraping and displaying normative texts
- An existing community of enthusiasts is ready for beta testing

---

## Success Criteria

- **Active community**: Beta testers become regular users who provide feedback and evangelize
- **Academic recognition**: Citations in legal research or computational law publications
- **Peer recommendation**: Lawyers recommending Visualex to colleagues as their primary research tool
- **Financial sustainability**: Revenue covers infrastructure and operational costs
- **Authority**: Visualex becomes recognized as the reference platform for digital legal research in Italy

---

## Timeline and Milestones

### Target Launch

No hard deadline — quality over speed. The core product is largely built; focus is on refinement and polish before beta release.

### Key Milestones

1. **UI/UX refinement** — Polish the interface for a seamless first experience
2. **Collaborative features completion** — Shared environments and social dynamics ready
3. **Beta release** — Deploy to existing community of enthusiastic testers
4. **Iterate on feedback** — Rapid cycles based on beta user input
5. **Public launch** — Open registration after beta validation

---

## Risks and Mitigation

- **Risk:** User adoption — senior practitioners may not immediately perceive the time-saving value
  - **Likelihood:** Medium-High
  - **Mitigation:** Design for "quick wins" in the first 5 minutes of use. Onboarding flow that demonstrates time savings concretely. Leverage beta community as early ambassadors.

- **Risk:** Scraping fragility — external site HTML changes break data retrieval
  - **Likelihood:** Low (recent government restyle, next expected in ~10 years)
  - **Mitigation:** Modular scraper architecture allows targeted fixes. Monitoring for breakage. Multiple source fallbacks.

- **Risk:** Single developer bottleneck — all development depends on one person
  - **Likelihood:** Medium
  - **Mitigation:** AI-assisted development (Claude Max + BMAD) multiplies productivity. Open-source model can attract contributors over time. Clean codebase with good documentation.

- **Risk:** Infrastructure scaling under load
  - **Likelihood:** Low (small initial user base)
  - **Mitigation:** AWS EC2 can be vertically scaled. Architecture supports horizontal scaling when needed. Beta phase will stress-test limits.

---

## Next Steps

1. Create Product Requirements Document (PRD) - `/prd`
2. Conduct user research (optional) - `/research`
3. Create UX design (if UI-heavy) - `/create-ux-design`

---

**This document was created using BMAD Method v6 - Phase 1 (Analysis)**

*To continue: Run `/workflow-status` to see your progress and next recommended workflow.*
