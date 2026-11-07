<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep the overview cockpit in its leaf route, with dashboard-scoped semantic CSS tokens and existing shared controls, to prevent presentation changes from altering delivery logic.
- Keep campaign creation in its existing leaf route with shared form controls and one persistent draft state across steps, so presentation changes do not change delivery services.
- Access control: roles live in `user_roles` (superadmin|worker); workers see only dashboard paths listed in their active `worker_tasks`, enforced by `canOpen` in `src/lib/access.ts` and the dashboard layout; why: one source for menu filtering and redirects.
- Provider credentials live in `provider_accounts` (service-role only, multi-account per provider); all provider HTTP calls go through `src/lib/providers.server.ts` adapters behind superadmin-checked server functions; why: keys never reach the browser and new providers plug in one place.
- Infrastructure pages share a task-gated read model and admin-only writes; provider inventory preserves assignments and marks missing resources rather than deleting them, so synchronization cannot silently discard configuration.
- Server-domain bindings track requested DKIM installation separately from confirmed installation; private signing keys are never exported through browser RPCs, so phase-3 agents can receive configuration without exposing keys in the UI.
- KumoMTA agents pull their server's config and DKIM keys from `/api/public/agent/*` with a per-server bearer token stored only as a SHA-256 hash; config is generated in `src/lib/kumo.server.ts`; why: servers converge without inbound access and keys never pass through browser RPCs.
