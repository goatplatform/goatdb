// Ambient type declaration for the untyped postject optional dependency.
// Primary consumer: tsup DTS generation via tsconfig.node.json.
declare module 'postject' {
  export function inject(
    filename: string,
    resourceName: string,
    resourceData: Buffer | Uint8Array,
    options?: {
      machoSegmentName?: string;
      sentinelFuse: string;
    },
  ): Promise<void>;
}
