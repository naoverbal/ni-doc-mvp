# Product

**ni-doc** is a server-side web application for issuing, versioning, sending, and tracking commercial quotes (orçamentos).

## What it does

- Operators from multiple companies (tenants) create and edit quotes.
- Quotes are rendered to PDF using a configurable template (background PDF + placeholders).
- Proposals are sent to end clients, who approve or reject them through a public link / QR Code.
- Every issued quote keeps immutable version snapshots, a document hash (SHA-256) for integrity, and a full audit trail.

## Core domain concepts

- **Tenant** — company/group using the system; data is logically isolated per tenant.
- **Usuário** — a person with role `admin` (manages users, template, settings) or `operador` (creates/sends quotes).
- **Cliente final** — quote recipient; approves via a non-guessable public token.
- **Orçamento** — aggregate root; moves from editable `rascunho` to versioned, sent proposals.
- **Versão** — immutable snapshot of a quote at send time.
- **Template** — visual definition (one global template per tenant in the MVP).

## Scope notes (MVP)

Out of scope for now: fiscal note emission (NFe/NFSe), payment gateways, ICP-Brasil digital signature, native mobile app, multiple templates per tenant, and multi-language (pt-BR only).

## Language

The product domain and codebase use Portuguese (pt-BR) for domain terms, identifiers, comments, and user-facing text. Preserve this convention when writing new code.
