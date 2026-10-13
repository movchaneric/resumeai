# Prisma owns the `app` schema; the LangGraph checkpointer gets its own

We use Prisma and Prisma Migrate for our own tables (`runs`, and later users), in the Postgres schema `app`. The LangGraph Postgres checkpointer (slice 4) creates and manages its own tables, so it is configured with a separate `checkpoints` schema in the same database. Each tool then only sees its own tables. Without this, `prisma migrate dev` reports the checkpointer's tables as drift and can offer to reset the database, which would wipe checkpoints. A separate database was rejected because it adds a second connection and splits the privacy deletion across two databases; one instance still holds everything, as ADR 0002 says.

The link between a Run and its checkpoints is only the value we pass as `thread_id` (the Run ID). There is no foreign key, so deleting a Run (on request or by the TTL sweep) must delete the `runs` row and the checkpoints for that `thread_id` explicitly.

Hand-written SQL with `pg` and Kysely were considered and rejected in favour of Prisma, which the project owner knows. Prisma stays out of the shapes of run data: Zod in `shared/` remains their only definition (ADR 0003).
