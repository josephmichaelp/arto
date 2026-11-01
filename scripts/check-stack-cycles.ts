/**
 * Pemeriksa dependensi sirkular antar nested stack, dijalankan lokal tanpa AWS.
 *
 * Mereplikasi pemeriksaan yang dilakukan `ampx` saat deploy: setiap nested
 * stack muncul sebagai resource `AWS::CloudFormation::Stack` di template root,
 * dan nilai `Parameters`-nya mereferensikan output nested stack lain lewat
 * `Fn::GetAtt`. Referensi itulah sisi (edge) grafnya.
 *
 * Pakai: npx tsx scripts/check-stack-cycles.ts
 */
import { App, Stack } from "aws-cdk-lib";

import { backend } from "../amplify/backend";

const anyStack = Stack.of(backend.ledger.resources.lambda);
const app = anyStack.node.root as App;

const asm = app.synth({ force: true });

// Stack root Amplify adalah satu-satunya artifact stack tingkat atas.
const rootArtifact = asm.stacks.find((s) => !s.nestedStackParent) ?? asm.stacks[0]!;
const template: any = rootArtifact.template;
const resources: Record<string, any> = template.Resources ?? {};

const nestedIds = Object.keys(resources).filter(
  (id) => resources[id]?.Type === "AWS::CloudFormation::Stack",
);

function collectRefs(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "Fn::GetAtt" && Array.isArray(v) && typeof v[0] === "string") {
        out.add(v[0] as string);
      } else if (k === "Fn::GetAtt" && typeof v === "string") {
        out.add((v as string).split(".")[0]!);
      } else if (k === "Ref" && typeof v === "string") {
        out.add(v);
      }
      collectRefs(v, out);
    }
  }
}

// edges: A -> B berarti A butuh nilai dari B, jadi B harus dibuat lebih dulu.
const edges = new Map<string, Set<string>>();
for (const id of nestedIds) edges.set(id, new Set());

for (const id of nestedIds) {
  const refs = new Set<string>();
  collectRefs(resources[id]?.Properties?.Parameters, refs);
  const dependsOn = resources[id]?.DependsOn;
  if (typeof dependsOn === "string") refs.add(dependsOn);
  if (Array.isArray(dependsOn)) for (const d of dependsOn) refs.add(String(d));
  for (const r of refs) {
    if (r !== id && nestedIds.includes(r)) edges.get(id)!.add(r);
  }
}

console.log(`Nested stack terdeteksi (${nestedIds.length}):`);
for (const id of nestedIds) {
  const deps = [...edges.get(id)!];
  console.log(`  ${id} -> ${deps.length ? deps.join(", ") : "(tidak bergantung pada nested stack lain)"}`);
}

// Cari semua siklus lewat DFS dengan pelacakan jalur.
const cycles: string[][] = [];
const state = new Map<string, number>();
const pathStack: string[] = [];

function dfs(n: string): void {
  state.set(n, 1);
  pathStack.push(n);
  for (const m of edges.get(n) ?? []) {
    if (state.get(m) === 1) {
      const i = pathStack.indexOf(m);
      cycles.push([...pathStack.slice(i), m]);
    } else if (!state.get(m)) {
      dfs(m);
    }
  }
  pathStack.pop();
  state.set(n, 2);
}

for (const id of nestedIds) if (!state.get(id)) dfs(id);

console.log("");
if (cycles.length === 0) {
  console.log("HASIL: tidak ada dependensi sirkular antar nested stack.");
  process.exit(0);
}

const unik = [...new Set(cycles.map((c) => c.join(" -> ")))];
console.log(`HASIL: ${unik.length} siklus ditemukan:`);
for (const c of unik) console.log(`  ${c}`);
process.exit(1);