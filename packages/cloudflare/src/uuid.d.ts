/**
 * Type shim for uuid package
 * Allows importing from 'uuid' without requiring @types/uuid
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "uuid" {
  const anything: any;
  export = anything;
}
