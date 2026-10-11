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

## Emergency recovery

A trusted operator can configure `OWNER_RECOVERY_CODE` in `Backend/.env` to enable the Admin Settings recovery form. Use a randomly generated secret of at least 32 characters; for example, generate one with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Never commit the recovery code or share it with ordinary Admins. Give it only to the person authorized to perform the recovery, then restart the backend so it loads the setting.

Any signed-in Admin can use the recovery form by selecting an existing Admin, entering their own account password and the recovery code, and confirming the transfer. Recovery can replace a valid but unavailable owner as well as repair a missing or invalid owner record. The current owner immediately loses owner-only privileges unless selected as the recovery target.

Each recovery code can be used only once. The hash of each consumed code is retained in `system_settings`; the raw code is never stored. Before another recovery, a trusted operator must replace `OWNER_RECOVERY_CODE` with a new random value in `Backend/.env` and restart the backend. Do not reuse a previously consumed code.

Do not run `npm run migrate:owner` to change a valid owner; it deliberately leaves a valid owner unchanged.
