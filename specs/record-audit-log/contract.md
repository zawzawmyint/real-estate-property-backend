# Record audit log API contract

Status: Locally verified — 2026-11-26. Backend-owned narrative contract for delivered endpoints; no production deployment is claimed.

## Access and errors

All routes require current Admin/Manager authorization before parsing query input or returning data. Admin and Manager have the same full-agency visibility. No event mutation routes exist.

Use existing structured AppError responses: 401 UNAUTHENTICATED for absent/invalid live staff access; 403 FORBIDDEN for an authenticated Agent; 400 INVALID_INPUT for invalid query input; generic existing 500 handling for unexpected failures. Return `Cache-Control: no-store`; never include records/queries in client-visible errors. Revalidate current role/session in each read transaction.

## GET /api/v1/staff/audit-log

- Required `from`, `to`: ISO 8601 instants with explicit Z/offset, from < to, maximum interval 93 * 24 hours, from inclusive/to exclusive. No implicit server date defaults.
- Optional `actorId`: nonempty staff identifier, max 128 characters; not assumed UUID because auth owns its identifier format. Mutually exclusive with `actorKind` (`staff`, `website`, `system`). Missing means all sources.
- Optional `entityType`: `property`, `lead`, `viewing`, `task`, `import`; `entityId`: UUID, requires entityType. Entity type alone is allowed. Match retained audit identifiers independently of current target existence: deleted targets still return their matching historical events with entity.available=false. An identifier with no recorded events yields zero matching items, not a resource existence error.
- Optional `action`: one of the exact events in spec.md. Reject action/entityType mismatches. Optional `importId`: UUID, combines with other predicates using AND.
- Optional `page`: integer >=1, default 1; `pageSize`: integer 1–100, default 20. Reject duplicate/unknown query keys, fractional values and unsafe-integer page offsets.
- Sort `occurredAt DESC, id DESC`. Page/count read in one transaction. Above-last page returns empty items with the correct total. Concurrent commits can shift pages between requests; Refresh returns current results, and no frozen cross-request snapshot is promised.

Response shape:

```json
{
  "items": [
    {
      "id": "<event UUID>",
      "schemaVersion": 1,
      "occurredAt": "2026-11-26T08:30:00.000Z",
      "actor": {
        "kind": "staff",
        "id": "<staff ID>",
        "name": "Sara",
        "role": "manager"
      },
      "entity": {
        "type": "property",
        "id": "<property UUID>",
        "label": "Marina Apartment",
        "available": true
      },
      "action": "property.updated",
      "changes": [
        {
          "field": "priceFils",
          "redacted": false,
          "before": "180000000",
          "after": "175000000"
        },
        { "field": "ownerPhone", "redacted": true }
      ],
      "import": null
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "coverage": {
    "startedAt": "<UTC migration instant>",
    "version": 1,
    "historicalBackfill": false
  }
}
```

- `actor`: kind plus nullable id/name/role. Staff snapshots have all staff fields; Website/System have null id/name/role and display by kind. Historical deleted staff retains stored snapshots.
- `entity.available`: current existence for business records, batch-resolved by type without N+1 lookups. False after deletion; always false for import summaries, which have no detail page. The UI constructs allowlisted local links, never trusts stored URLs. Labels are event-time snapshots under spec.md's safe-label policy.
- `changes`: array of `{field, redacted:false, before, after}` or `{field, redacted:true}`. Values are null, boolean, number, string or string arrays; timestamps ISO UTC, money integer fils strings, photo ordering arrays of UUIDs. Redacted variants omit before/after entirely. Never return a stored raw payload. Empty changes allowed for an import summary.
- `import`: null or `{id: <import UUID>, kind: "lead" | "property", createdCount: number | null}`. Summary contains count; per-record events contain null count. The UI can filter by this id; no new import-detail endpoint is implied.
- `coverage` always returned, including empty results. It describes activation for this declared coverage version; the UI also states excluded paths. A pre-coverage filter is valid and returns no invented events.

## GET /api/v1/staff/audit-log/actors

- `q`: optional trimmed literal name substring, max 100 characters; escape SQL wildcard characters. `page` default 1; `pageSize` default 20, max 100, same integer/unknown/duplicate-key validation as the list.
- Return `{items:[{id,name,role}], page,pageSize,total}` for distinct historical staff actorIds in audit rows. Select latest event snapshot per identity using occurredAt/id descending; order choices by name then id ascending. Role is the latest recorded role, not proof of current access. Retain disabled/deleted identities. Name search applies to this selected latest snapshot; full history still shows each event's original name/role.
- Website/System choices are static UI source options and do not appear here. No staff emails, session IDs, current account state or directory users without audit history.

## Ownership and compatibility

`docs/api/record-audit-log.openapi.yaml` is registered in `docs/api/openapi.yaml`, with backend contract tests. The OpenAPI and this narrative are copied verbatim to frontend `docs/contracts/`; frontend API generation and drift checks cover the snapshot. No cross-repository imports are used. These are additive read APIs; existing lead activities and business mutation contracts remain compatible.
