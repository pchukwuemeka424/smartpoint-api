# Database Migrations

This folder contains database migration scripts for the SmartPoint API.

## Available Migrations

### update-paid-amounts.js

Updates existing sales records to ensure `paidAmount` is correctly set for revenue calculations.

**What it does:**
- Sets `paidAmount = total` for all completed transactions that don't have `paidAmount` set
- Keeps existing `paidAmount` for partial payments
- Sets `paidAmount = 0` for pending transactions

**When to run:**
- After deploying the revenue calculation updates
- If you have existing sales data that needs to be migrated

**How to run:**

```bash
# Using default MongoDB connection
node migrations/update-paid-amounts.js

# Using custom MongoDB connection string
MONGODB_URI="mongodb://your-connection-string" node migrations/update-paid-amounts.js
```

**Note:** This migration is safe to run multiple times. It will only update records that need updating.

## Migration Best Practices

1. **Backup your database** before running migrations
2. Run migrations during low-traffic periods
3. Test migrations on a staging environment first
4. Monitor the migration output for any errors
5. Verify the results after migration completes

