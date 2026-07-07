// @orbetra/db — DB layer (E01-3): Prisma relational + raw SQL positions side.
// Scoped repositories (the only DB API) arrive in E03-2; auth.ts is their seed.
export { createPool } from './pool.js'
export {
  createAuthDb,
  UNSCOPED_AUTH_METHODS,
  type AuthDb,
  type AuthUserRow,
  type RefreshTokenRow,
} from './auth.js'
