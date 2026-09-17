# Problem Statement Alignment: AI for Legal Assistance & Access

## The Challenge
The civil justice gap is a mass-market failure. The Legal Services Corporation estimates that approximately 92% of low-income Americans' civil legal problems receive inadequate or no professional help. Furthermore, the average adult reads well below the level at which legal documents (leases, NDAs, contracts) are drafted. People don't fail to understand their documents because they are careless; they fail because the documents are structurally illegible to them, and professional legal review costs $200–$500/hr.

## The Solution: LegalLens
LegalLens directly targets the **"AI for Legal Assistance & Access"** challenge by democratizing legal document understanding through Generative AI. 

We address the core issues of access and comprehension via three foundational principles:

### 1. Trust is the Product
The biggest barrier to adopting AI in legal scenarios is hallucination. LegalLens solves this by making every AI-generated claim a clickable citation that visually highlights the exact source region (bounding box) on the original uploaded document. Users don't have to blindly trust the AI; the AI proves its work instantly.

### 2. Plain Language or It Didn't Happen
Legal documents are notorious for dense legalese. LegalLens enforces a Flesch-Kincaid readability score of ≤8.0 (Standard) or ≤6.0 (Simpler) on all its outputs. It replaces complex jargon with simple, one-line definitions and surfaces hidden risks into clear, color-coded flags. It also supports seamless translation into Spanish, further breaking down language barriers.

### 3. Never Advice, Always Understanding (UPL Protection)
Providing unauthorized practice of law (UPL) is a massive risk for AI legal tools. LegalLens employs a strict safety layer and post-generation advice detector. It is designed to explain what is in the document (understanding) but never tells the user what they should do (advice). For high-stakes situations (e.g., evictions, criminal issues, domestic disputes), LegalLens automatically triggers an escalation protocol, surfacing a warm referral card with links to verified legal-aid resources like LSC and LawHelp.

## Core Hackathon Requirements Met
- **Generative AI Usage:** Deeply integrated utilizing Z-AI SDK (`glm-4.5v` for vision and Chat Completions for text analysis, Q&A, impact analysis, and simplification).
- **Public Access & Size Constraint:** Open-source GitHub repository properly configured to remain under the 10MB limit (e.g., `node_modules` ignored).
- **Demonstrable Impact:** The app is functional, safe, and immediately applicable to real-world scenarios (as documented in our 100 Use Cases).
