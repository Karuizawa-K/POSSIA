# System ownership

The system owner is stored in the `system_settings` collection, separately from Admin roles. Admins can manage accounts, but only the current owner can delete or demote another Admin. Only the owner can edit the owner account, and the owner account cannot be deleted or demoted.

## Existing installations

After deploying this version, run this one-time migration from the `Backend` directory:

```powershell
npm run migrate:owner
```

The migration assigns ownership to the oldest existing Admin by creation date. It is safe to run again: an existing valid owner is kept and is never replaced. If the owner setting is missing, Admin Settings will explain that owner-only actions are unavailable until the migration is run.

## New installations

When `npm run seed:admin` creates the first Admin, that account is also designated as the owner.

## Transferring ownership

The owner can transfer ownership in Admin Settings to another existing Admin. The owner must re-enter their current password and confirm the transfer. The ownership record changes immediately; the previous owner remains an Admin but loses owner-only privileges.

Ownership is not reassigned automatically if the owner is unavailable or the stored owner is missing or invalid. Recovery must be performed by a trusted system operator using the database and an approved recovery procedure. Do not rerun the migration to change a valid owner.
