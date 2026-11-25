# Personal history

The Profile page's **My history** section shows the signed-in person's appointments and consultations across role changes, their account events, and schedule data linked to their same User ID. It also offers a CSV export of that same personal data.

`GET /api/history/me` and `GET /api/history/me/export.csv` do not accept a user ID; both derive the owner from the authenticated token. The event collection is append-only through the Mongoose model and API. Appointment and schedule history events are snapshots of changes; the existing schedule-import records remain the source for imported schedule snapshots.

New accounts receive `activatedAt` when created ACTIVE. Approval from `PENDING_APPROVAL` sets it once. Disable/enable and role changes are recorded as dated events without resetting the original activation time. Legacy records do not contain a trustworthy first-active date. `node backend/scripts/backfillActivatedAt.js` is dry-run only; after reviewing the printed limitation, an operator may explicitly opt into `--apply --created-at-is-activation` to use `createdAt` as a fallback. That fallback is an approximation, not a recovered activation time. The migration is not run automatically.

The personal history API is owner-only. Existing consultation endpoints still follow the application's participant and staff access rules; this feature does not revoke those separate operational permissions.
