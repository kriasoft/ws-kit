/**
 * Type shim for valibot package
 * Allows importing from 'valibot' without requiring @types/valibot
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
declare module "valibot" {
  export type GenericSchema = any;
  export type LiteralSchema<T = any, TDefault = any> = any;
  export type NumberSchema<TDefault = any> = any;
  export interface ObjectSchema<TEntries = any, TDefault = any> {
    entries: any;
    [key: string]: any;
  }
  export type OptionalSchema<TSchema = any, TDefault = any> = any;
  export type StringSchema<TDefault = any> = any;
  export type InferOutput<T = any> = any;
  export function safeParse(schema: any, data: unknown): any;
  export function strictObject(schema: any): any;
  export function object(schema: any): any;
  export function literal(value: any): any;
  export function string(): any;
  export function number(): any;
  export function boolean(): any;
  export function optional(schema: any): any;
  export function pipe(...schemas: any[]): any;
  export function integer(): any;
  export function minValue(value: any): any;
  export function union(schemas: any[]): any;
  export function record(schema: any): any;
  export function any(): any;
  export function picklist(values: any[]): any;
}
