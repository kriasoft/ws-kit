/**
 * Type shim for redis package
 * Allows importing from 'redis' without requiring @types/redis
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "redis" {
  const anything: any;
  export = anything;
}
