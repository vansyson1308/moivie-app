import { cp, mkdir, readFile, realpath, rm, access } from "@toonflow/file";
import { dirname, join, resolve } from "node:path";

/**
 * Chuẩn bị bộ dựng phim cho bản desktop: bộ dựng chạy như tiến trình bun riêng (canvas gốc, luồng phụ, Python VieNeu)
 * nên không gói vào server mà chép nguyên mã nguồn cùng đúng các gói phụ thuộc đang cài, kể cả bản nhị phân của nền tảng hiện tại.
 */
const projectDir = resolve(import.meta.dir, "../../..");
const target = resolve(projectDir, "build/cinema");
const source = resolve(projectDir, "packages/cinema");
const exists = (path: string) => access(path).then(() => true, () => false);

async function locate(name: string, from: string) {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name);
    if (await exists(join(candidate, "package.json"))) return realpath(candidate);
    if (dirname(directory) === directory) throw new Error(`Không tìm thấy gói ${name} (từ ${from})`);
  }
}

const copied = new Set<string>();
async function copyPackage(name: string, from: string) {
  if (copied.has(name)) return;
  copied.add(name);
  const directory = await locate(name, from);
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  await cp(directory, join(target, "node_modules", name), { recursive: true, dereference: true, filter: path => !path.slice(directory.length).split(/[\\/]/).includes("node_modules") });
  for (const dependency of Object.keys(manifest.dependencies ?? {})) await copyPackage(dependency, directory);
  // Phụ thuộc tuỳ chọn là các bản nhị phân theo nền tảng: chỉ bản của máy đang build được cài, bỏ qua phần còn lại.
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) await copyPackage(dependency, directory).catch(() => copied.delete(dependency));
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const entry of ["cli.ts", "package.json", "src", "voice", "studio", "assets"]) await cp(join(source, entry), join(target, entry), { recursive: true });
const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8")) as { dependencies: Record<string, string> };
for (const dependency of Object.keys(manifest.dependencies)) await copyPackage(dependency, source);
console.log(`Đã chuẩn bị bộ dựng phim: ${target} (${copied.size} gói)`);
