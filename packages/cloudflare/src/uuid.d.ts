/**
 * Type shim for uuid package
 * Allows importing from 'uuid' without requiring @types/uuid
 */
declare module "uuid" {
  const anything: any;
  export = anything;
}
