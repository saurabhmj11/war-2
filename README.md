# LegalLens

> Built for the "AI for Legal Assistance & Access" challenge.
> Every person who signs something understands what they're signing.

LegalLens is a privacy-first legal document understanding web app. Drop in any legal document (PDF, DOCX, TXT, photo, or scan) and get a plain-language summary, risk flags with clickable source citations on the original page, grounded Q&A with abstention, side-by-side version comparison, and a per-clause impact analysis showing what a balanced version typically looks like, what could go wrong, and an estimated financial exposure range.

**No existing consumer legal tool offers this combination** of: clickable source citations + plain language + trust score + pre-signing action plan + per-clause fair-version examples + per-clause financial exposure estimates + multi-document Q&A + image/camera support + Spanish/English + Simpler/Standard reading levels + 24h auto-deletion + enforced advice boundary.

---

## Problem Statement Alignment

The civil justice gap is a mass-market failure: the Legal Services Corporation estimates ~92% of low-income Americans' civil legal problems receive inadequate or no professional help. Meanwhile, the average adult reads well below the level at which legal documents are drafted. People don't fail to understand their leases, NDAs, and severance letters because they're careless — the documents are structurally illegible to them, and professional review costs $200–500/hr.

**LegalLens closes this gap** with three principles:
1. **Trust is the product** — every claim is a clickable chip that highlights the exact source region on the original page.
2. **Plain language or it didn't happen** — output is Flesch-Kincaid ≤8.0 (Standard) or ≤6.0 (Simpler), with one-line jargon definitions.
3. **Never advice, always understanding** — we explain what's there. We never tell the user what to do. We surface considerations, never directives.

---

## Features (PRD Coverage)

| # | User Story | Status | Implementation |
|---|---|---|---|
| US-1 | Upload → plain-language summary | ✅ Shipped | 5–7 cited bullets, Flesch-Kincaid ≤8.0, photo/scan input OK |
| US-2 | Compare two versions | ✅ Shipped | Topic-anchored diff (payment, liability, termination, IP, renewal, law) + missing-clause check |
| US-3 | Grounded Q&A | ✅ Shipped | Every answer cites source; "not in document" is a valid abstention; "should I sign?" → considerations, never directive |
| US-4 | Escalation | ✅ Shipped | Eviction/immigration/criminal/custody/deadline/fraud triggers → warm referral card with legal-aid links |
| US-5 | Table Q&A | ✅ Shipped | VLM extracts tables; citations render as `[Table · p.N]` with bbox highlight |
| US-6 | Image awareness | ✅ Shipped | Camera-scan via VLM (glm-4.5v); text + visual context extraction; ImageViewer with bbox overlay |
| US-7 | Export | ✅ Shipped | Branded PDF (cover + summary + risk flags + jargon) via pdfkit; honors language param |

### Should-tier features
- **FR-12**: PDF export (server-side, vector text)
- **FR-13**: Reading-level toggle (Standard ⇄ Simpler) + Spanish output (auto-translated citation chips, severity labels, intro, footer)

### Killer features (differentiators)
- **Trust Score (0–100)** — per-document balance score derived from flag severities
- **Pre-Signing Checklist** — interactive action plan with localStorage persistence
- **Multi-Document Q&A** — ask across all uploaded docs; per-doc coverage badges
- **Document Dashboard** — home view showing all docs with scores + 24h countdown
- **Impact Analysis** — per-flag fair-version example + breach scenario + financial exposure estimate + mitigation options

---

## Tech Stack

- **Framework**: Next.js 16 with App Router (TypeScript 5)
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York)
- **Database**: Prisma ORM (SQLite)
- **LLM/VLM**: `z-ai-web-dev-sdk` (server-side only) — glm-4.5v for vision, chat completions for analysis/Q&A/compare/impact
- **PDF rendering**: `pdfjs-dist` (client-side, lazy-loaded) + `pdf-parse` (server-side text extraction)
- **DOCX parsing**: `jszip` (unzip word/document.xml)
- **PDF export**: `pdfkit` (server-side vector PDF)
- **Icons**: `lucide-react`
- **Toasts**: `sonner`

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Browser (single route /)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │  Dashboard   │  │   Results    │  │   PDF/Image Viewer       │ │
│  │  (all docs)  │  │   (1 doc)    │  │   (pdf.js / <img>)       │ │
│  │              │  │              │  │   + bbox highlight       │ │
│  │  + MultiAsk  │  │  + Settings  │  │   overlay (orange)       │ │
│  │              │  │  + Trust     │  │                           │ │
│  │              │  │  + Checklist │  │                           │ │
│  │              │  │  + Impact    │  │                           │ │
│  │              │  │  + Compare   │  │                           │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘ │
└─────────┼─────────────────┼──────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Next.js API routes (server-side)                │
│  /api/legallens/upload     → PDF/DOCX/TXT/image ingestion         │
│  /api/legallens/analyze    → LLM analysis (system prompt v1.1)    │
│  /api/legallens/ask        → grounded Q&A (single doc)            │
│  /api/legallens/multi-ask  → grounded Q&A (up to 10 docs)        │
│  /api/legallens/compare    → topic-anchored diff                  │
│  /api/legallens/impact     → fair-version + exposure estimate    │
│  /api/legallens/export     → branded PDF download                │
│  /api/legallens/document   → raw file bytes for viewer            │
│  /api/legallens/list       → all un-expired docs                  │
└──────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Safety layer (lib/)                        │
│  system-prompt.ts  — System Prompt v1.1 (R1–R12 rules)           │
│  safety.ts         — advice detector, injection filter,          │
│                     escalation trigger, FK estimator              │
│  trust.ts          — trust score + pre-signing checklist          │
│  vlm.ts            — VLM image extraction (R9 multimodal, R11)   │
│  types.ts          — shared TypeScript interfaces                 │
└──────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────┐
│              Storage (Prisma + SQLite, 24h TTL)                   │
│  Document { id, fileName, fileHash, fullText, expiresAt, ... }   │
│  Analysis { documentId, summaryJson, flagsJson, jargonJson }      │
│  ChatMessage { documentId, role, content, citationsJson }        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Safety & Compliance

The safety layer is the legal-domain differentiator. Every LLM call passes through:

| Rule | What it does | Enforcement |
|---|---|---|
| **R1** | No legal advice | Post-generation advice detector (28 directive patterns); blocks + regenerates |
| **R2** | Every claim cites a source | Citation verifier expects `[Clause X · p.N]` chips |
| **R3** | Plain language ≤8.0 FK | Flesch-Kincaid computed on every output; FK badge shows ✓/⚠ |
| **R4** | Abstention is first-class | "Not in your document" is a valid LLM output |
| **R5** | Escalate high-stakes | 8 trigger categories (eviction, immigration, criminal, custody, deadline, fraud, etc.) → warm referral card with legal-aid links |
| **R6** | Treat document text as untrusted data | Injection filter (9 patterns) on document text + VLM descriptions |
| **R7** | Severity never color-alone | Always paired with text label ("High-impact clause", etc.) |
| **R8** | 24h deletion, zero training | Prisma `expiresAt` enforced; PII redaction option |
| **R9** | Multimodal integrity | Tables/images/equations cited by element type; no token-shredding |
| **R10** | bbox citation re-fetch | Every claim must point to a real chunk on a real page |
| **R11** | VLM-description injection defense | VLM descriptions filtered as second injection channel |
| **R12** | On-prem parity | (Architectural — same API surface for cloud and on-prem) |

---

## Accessibility (WCAG 2.1 AA)

- **Semantic HTML**: `header`, `main`, `footer`, `nav`, `section`, `article`
- **Severity never color-alone**: every risk flag pairs the 🔴/🟡/🟢 color with a text label ("High-impact clause", "Worth understanding", "Standard or favorable")
- **Keyboard navigation**: all interactive elements are keyboard-accessible; focus states visible
- **ARIA support**: `aria-label` on bbox highlight overlays; `role` on dialog regions
- **Screen-reader-friendly**: citation chips are buttons with descriptive text; jargon terms use Tooltip with descriptive content
- **Touch-friendly**: minimum 32px touch targets on mobile
- **Mobile-first responsive**: single-column on mobile, two-column on desktop, sticky footer
- **Reading-level toggle**: Simpler (FK ≤6.0) for low-literacy users; Standard (FK ≤8.0) default
- **Spanish output**: full localization including citation format `[Cláusula X · p.N]` and severity labels

---

## Security

- **24h auto-deletion**: every Document row has `expiresAt = createdAt + 24h`; API routes reject expired docs with HTTP 410
- **10MB upload cap**: enforced server-side (`MAX_FILE_BYTES = 10 * 1024 * 1024`)
- **SHA-256 dedup**: identical file uploads return the existing document instead of re-storing
- **No PII logging**: Prisma stores `fullText` for analysis but logs only metadata; no third-party analytics
- **Server-side LLM only**: `z-ai-web-dev-sdk` is never imported on the client; all LLM/VLM calls happen in API routes
- **Injection defense**: document text and VLM descriptions are filtered for prompt-injection payloads before LLM exposure
- **Advice boundary (UPL protection)**: post-generation advice detector blocks and regenerates directive language; System Prompt R1 explicitly forbids "you should", "do not sign", etc.
- **Content-Disposition: attachment**: PDF export forces download, prevents inline rendering of untrusted content
- **Cache-Control: private, no-store**: document bytes and exported PDFs are never cached

---

## Setup

### Prerequisites
- Node.js 18+ or Bun
- The Z.ai SDK configuration (auto-discovered from `./.z-ai-config`, `~/.z-ai-config`, or `/etc/.z-ai-config`)

### Install
```bash
# Clone the repo
git clone https://github.com/<your-username>/legallens.git
cd legallens

# Install dependencies
bun install  # or npm install

# Set up the database
mkdir -p db
bun run db:push

# (Optional) Copy env example
cp .env.example .env

# Start the dev server
bun run dev
```

Visit `http://localhost:3000`.

### Available scripts
```bash
bun run dev        # Start dev server (port 3000)
bun run lint       # ESLint
bun run test       # Run unit tests
bun run db:push    # Push Prisma schema to SQLite
bun run db:generate # Regenerate Prisma client
```

---

## Testing

Unit tests cover the safety-critical modules:

```bash
bun run test
```

| Test file | What it covers |
|---|---|
| `tests/safety.test.ts` | Advice detector (R1), injection filter (R6), escalation trigger (R5), Flesch-Kincaid estimator (R3) |
| `tests/trust.test.ts` | Trust score computation, pre-signing checklist generation |

Tests are deterministic and do not call the LLM — they verify the rule-based guardrails that wrap every LLM call.

---

## File Structure

```
.
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Main UI: dashboard, results, settings, multi-ask
│   │   ├── layout.tsx                # Root layout with metadata
│   │   ├── globals.css
│   │   └── api/legallens/
│   │       ├── upload/route.ts       # File ingestion + text extraction
│   │       ├── analyze/route.ts      # LLM analysis with system prompt
│   │       ├── ask/route.ts          # Single-doc grounded Q&A
│   │       ├── multi-ask/route.ts    # Cross-doc grounded Q&A
│   │       ├── compare/route.ts      # Topic-anchored diff
│   │       ├── impact/route.ts       # Fair-version + exposure estimate
│   │       ├── export/route.ts       # PDF generation (pdfkit)
│   │       ├── document/route.ts     # Raw file bytes for viewer
│   │       └── list/route.ts         # All un-expired docs
│   ├── components/
│   │   ├── ui/                       # shadcn/ui components (48 files)
│   │   └── legallens/
│   │       ├── PdfViewer.tsx         # pdfjs + bbox overlay; ImageViewer variant
│   │       ├── CompareDialog.tsx     # Two-doc comparison modal
│   │       └── Dashboard.tsx         # TrustScore, PreSigningChecklist,
│   │                                 # MultiAsk, Dashboard, ImpactAnalysis
│   └── lib/
│       ├── db.ts                     # Prisma client
│       ├── utils.ts                  # cn() helper
│       └── legallens/
│           ├── types.ts              # Shared TypeScript interfaces
│           ├── system-prompt.ts      # System Prompt v1.1 (R1–R12)
│           ├── safety.ts             # Advice detector + injection filter
│           │                         # + escalation trigger + FK estimator
│           ├── trust.ts              # Trust score + pre-signing checklist
│           └── vlm.ts                # VLM image extraction (R9, R11)
├── prisma/schema.prisma              # Document, Analysis, ChatMessage models
├── tests/                            # Unit tests (bun test)
├── package.json
├── README.md
├── LICENSE
├── .gitignore
└── .env.example
```

---

## Personas Served

| Persona | Context | LegalLens use case |
|---|---|---|
| Maya, 24 — Renter | Mobile-only, 48h to sign a lease | Photograph the lease → get a summary + 3 risk flags + impact analysis → ask "should I sign?" → considerations, not directives |
| Dev, 38 — SMB owner | 10 contracts/quarter, no counsel | Upload NDA v1 + v2 → compare → see which version favors which party + missing-clause check |
| Carmen, 31 — Employee | Offer + severance + non-compete, pressured | Upload all 3 → multi-ask "what am I agreeing to across these?" → answer citing all 3 docs |
| Priya — Legal-aid paralegal | 40 client docs/week, on-prem requirement | Batch upload → multi-ask → export PDFs for attorney review |

# 100 Use Cases for LegalLens

LegalLens is designed to democratize legal access. Here are 100 real-world scenarios where LegalLens empowers individuals by translating complex legal jargon into plain language.

## 🏠 Housing & Real Estate
1. **Residential Lease Agreements:** Reviewing a new apartment lease for hidden fees or unusual terms.
2. **Eviction Notices:** Understanding the exact timeline, rights, and required actions upon receiving an eviction notice.
3. **Security Deposit Disputes:** Analyzing move-out terms to understand conditions for getting a deposit back.
4. **HOA Guidelines:** Translating complex Homeowner Association rules and potential fines.
5. **Mortgage Agreements:** Breaking down the terms, interest rate clauses, and penalties of a home loan.
6. **Subletting Contracts:** Reviewing the legality and restrictions of subleasing an apartment.
7. **Property Deed Transfers:** Understanding the implications of signing over property rights.
8. **Rent Increase Notices:** Checking if a rent increase complies with local rent control laws mentioned in the lease.
9. **Maintenance Addendums:** Clarifying who is responsible for specific property repairs.
10. **Short-Term Rental Agreements:** Reviewing Airbnb or VRBO host contracts for liability clauses.
11. **Commercial Leases:** Helping small business owners understand triple net lease obligations.
12. **Roommate Agreements:** Formalizing and understanding shared financial responsibilities.
13. **Brokerage Agreements:** Clarifying exclusivity and commission structures when hiring a real estate agent.

## 💼 Employment & Labor
14. **Job Offer Letters:** Summarizing compensation, benefits, and at-will employment clauses.
15. **Non-Disclosure Agreements (NDAs):** Understanding what information can and cannot be shared after leaving a job.
16. **Non-Compete Clauses:** Analyzing geographical and time-based restrictions for future employment.
17. **Severance Agreements:** Reviewing what rights are being waived in exchange for severance pay.
18. **Independent Contractor Agreements:** Clarifying tax liabilities and intellectual property ownership.
19. **Employee Handbooks:** Summarizing company policies on PTO, harassment, and termination.
20. **Union Contracts:** Breaking down collective bargaining agreements for individual workers.
21. **Arbitration Agreements:** Understanding the waiver of the right to sue in court.
22. **Background Check Consents:** Clarifying what information employers are legally allowed to access.
23. **Commission Structures:** Decoding complex sales commission payout rules.
24. **Telecommuting Agreements:** Understanding liability and expense reimbursement for remote work.
25. **FMLA Requests:** Summarizing the rights and requirements for taking family medical leave.
26. **Intellectual Property Assignments:** Checking if side projects are claimed by the employer.

## 💳 Consumer & Finance
27. **Credit Card Terms & Conditions:** Highlighting hidden fees, penalty APRs, and arbitration clauses.
28. **Personal Loan Agreements:** Summarizing interest rates, repayment schedules, and default consequences.
29. **Auto Loan Contracts:** Understanding repossession terms and insurance requirements.
30. **Payday Loan Terms:** Exposing exorbitant interest rates and predatory clauses.
31. **Student Loan Promissory Notes:** Clarifying deferment options and capitalization rules.
32. **Debt Collection Letters:** Verifying the legitimacy of the debt and understanding consumer rights under the FDCPA.
33. **Bank Account Agreements:** Highlighting overdraft fees and minimum balance requirements.
34. **Gym Memberships:** Finding the exact procedure and penalties for canceling a membership.
35. **Software Terms of Service (ToS):** Summarizing data privacy and account termination clauses.
36. **Product Warranties:** Understanding what damages are actually covered and what voids the warranty.
37. **Subscription Agreements:** Highlighting auto-renewal clauses and cancellation windows.
38. **Car Lease Agreements:** Clarifying mileage limits and wear-and-tear penalties.
39. **Crowdfunding Terms:** Understanding backer rights if a project fails to deliver.

## 🏥 Healthcare & Insurance
40. **Health Insurance Policies:** Summarizing deductibles, copays, and out-of-network coverage.
41. **Medical Bills:** Cross-referencing itemized bills with standard medical coding descriptions.
42. **Explanation of Benefits (EOB):** Translating insurance jargon to understand what is owed.
43. **HIPAA Consent Forms:** Clarifying who exactly can access patient medical records.
44. **Advanced Directives:** Understanding the scope of living wills and medical power of attorney.
45. **Life Insurance Policies:** Summarizing payout conditions and exclusions.
46. **Disability Insurance:** Clarifying the definition of "disability" required to receive benefits.
47. **Nursing Home Contracts:** Reviewing liability waivers and arbitration clauses for elderly care.
48. **Dental Plan Agreements:** Highlighting waiting periods and maximum annual benefits.
49. **Surgical Consent Forms:** Translating the risks and procedures being agreed to.
50. **Workers' Compensation Forms:** Understanding the rights and limitations of filing a workplace injury claim.

## 🌍 Immigration & Travel
51. **Visa Applications:** Clarifying the legal requirements and restrictions of specific visa types.
52. **Sponsorship Affidavits (I-864):** Understanding the financial liabilities of sponsoring an immigrant.
53. **Asylum Applications:** Summarizing the legal definitions and requirements for seeking asylum.
54. **Travel Insurance Policies:** Highlighting exclusions for pre-existing conditions or specific activities.
55. **Airline Conditions of Carriage:** Understanding passenger rights for canceled flights or lost luggage.
56. **Study Abroad Contracts:** Clarifying liability and refund policies for international programs.
57. **Citizenship Forms:** Breaking down the legal requirements for naturalization.
58. **Customs Declarations:** Understanding the legal implications of what is being declared.

## 👨‍👩‍👧‍👦 Family & Personal Law
59. **Prenuptial Agreements:** Summarizing how assets will be divided and what rights are waived.
60. **Divorce Decrees:** Clarifying child custody schedules and alimony obligations.
61. **Child Support Agreements:** Understanding modification rules and enforcement mechanisms.
62. **Last Will and Testament:** Translating the distribution of assets and executor duties.
63. **Power of Attorney (Financial):** Clarifying the specific powers granted to an agent.
64. **Adoption Papers:** Understanding the legal transfer of parental rights.
65. **Restraining Orders:** Clarifying the exact boundaries, communication rules, and durations.
66. **Name Change Petitions:** Summarizing the legal steps and requirements.
67. **Guardianship Documents:** Understanding the legal responsibilities of caring for a minor or incapacitated adult.

## 🚀 Small Business & Freelance
68. **Client Service Agreements:** Clarifying project scope, payment terms, and revision limits.
69. **Partnership Agreements:** Summarizing profit distribution, decision-making, and dissolution terms.
70. **Website Privacy Policies:** Ensuring compliance with standard data collection practices.
71. **Vendor Contracts:** Reviewing delivery timelines, quality standards, and termination clauses.
72. **Copyright Assignments:** Understanding the transfer of ownership for creative works.
73. **Cease and Desist Letters:** Translating the demands and assessing the legal threat level.
74. **Franchise Agreements:** Clarifying royalty fees, marketing obligations, and territorial rights.
75. **Event Contracts:** Reviewing cancellation policies and force majeure clauses for venues.
76. **Affiliate Marketing Agreements:** Understanding payout thresholds and prohibited promotional methods.
77. **Model Release Forms:** Clarifying how an individual's likeness can be used commercially.
78. **Non-Profit Bylaws:** Summarizing board member duties and conflict of interest policies.

## 🔒 Privacy, Rights & Miscellaneous
79. **Social Media Privacy Settings:** Translating what data is sold to third parties.
80. **Data Breach Notifications:** Understanding personal risk and offered identity theft protection.
81. **Police Reports:** Clarifying the documented details of an incident for insurance claims.
82. **Settlement Agreements:** Summarizing the terms and confidentiality requirements of dropping a lawsuit.
83. **Class Action Notices:** Understanding the right to opt-out and potential compensation.
84. **Traffic Tickets/Citations:** Clarifying deadlines, points on a license, and options to contest.
85. **School IEPs (Individualized Education Programs):** Translating the legally mandated accommodations for a student.
86. **Photo Release Consents:** Understanding where and how personal images can be published.
87. **Volunteer Liability Waivers:** Clarifying what injuries or damages the organization is not responsible for.
88. **Cookie Consents:** Summarizing what tracking technologies are being accepted.
89. **End User License Agreements (EULA):** Highlighting restrictions on reverse engineering or resale.
90. **Smart Contracts (Text Translation):** Translating the written intent behind blockchain agreements.
91. **Plea Bargain Offers:** Understanding the exact charges, sentencing, and waived rights.
92. **Parole/Probation Conditions:** Clarifying travel restrictions, reporting duties, and violations.
93. **Tax Audit Notices:** Translating the IRS demands and deadlines for providing documentation.
94. **Mechanic's Liens:** Understanding the legal claim a contractor has placed on a property.
95. **Defamation Threats:** Analyzing the legal basis and demands of a libel/slander warning.
96. **Utility Service Agreements:** Highlighting deposit requirements and shut-off conditions.
97. **Vehicle Title Transfers:** Clarifying the "as-is" clauses and liability release.
98. **Pet Adoption Contracts:** Understanding return policies and required veterinary care clauses.
99. **Contest/Sweepstakes Rules:** Translating eligibility requirements and tax liabilities on winnings.
100. **Right to Repair Agreements:** Understanding how unauthorized repairs impact legal ownership and warranties.


---

## What LegalLens Is Not

- ❌ A lawyer. We do not give legal advice.
- ❌ A contract drafter. We do not write or redline contracts.
- ❌ A court-filing tool.
- ❌ An e-signature platform.
- ❌ An attorney marketplace.

For high-stakes situations (eviction, criminal, custody, deadline, fraud), we surface a warm referral card with legal-aid directory links (LSC, LawHelp, ABA).

---

## License

[MIT](./LICENSE) — © 2026 LegalLens

