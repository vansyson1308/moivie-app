import { access, mkdir } from "@toonflow/file";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { envelope, readWav, resample, sampleRate, writeWav } from "./audio";

export type VoiceEngine = "vieneu" | "silent";
export interface VoiceRequest { text: string; voice?: string }
export interface VoiceResult { path: string; duration: number; samples: Float32Array; envelope: Float32Array }
export interface VoiceOptions { engine: VoiceEngine; cacheDirectory: string; python?: string; serverUrl?: string; log?: (message: string) => void }

export const envelopeRate = 50;
const helper = resolve(import.meta.dirname, "../voice/vieneuBatch.py");

/** Bỏ dấu điều khiển nhịp đọc khỏi lời hiển thị/đọc. */
export function spokenText(text: string) {
  return text.replace(/\[[^\]]*\]/g, "").replace(/[|*]/g, "").replace(/\s+/g, " ").trim();
}

function key(engine: VoiceEngine, request: VoiceRequest) {
  return createHash("sha256").update(JSON.stringify([engine, request.voice ?? "", spokenText(request.text)])).digest("hex").slice(0, 16);
}

// Bản nháp không cần TTS: thời lượng ước theo âm tiết, đường bao giả theo nhịp âm tiết để miệng vẫn nhép.
function silentVoice(text: string): Float32Array {
  const syllables = Math.max(1, spokenText(text).split(/\s+/).length);
  const seconds = syllables / 4.2 + 0.3;
  return new Float32Array(Math.ceil(seconds * sampleRate));
}

function silentEnvelope(text: string, seconds: number) {
  const values = new Float32Array(Math.ceil(seconds * envelopeRate));
  const syllables = Math.max(1, spokenText(text).split(/\s+/).length);
  for (let index = 0; index < values.length; index++) {
    const position = index / values.length * syllables;
    values[index] = index / values.length > 0.95 ? 0 : 0.35 + 0.55 * Math.abs(Math.sin(Math.PI * position));
  }
  return values;
}

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}

async function viaServer(url: string, items: { request: VoiceRequest; path: string }[]) {
  for (const { request, path } of items) {
    const response = await fetch(`${url.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "vieneu-v3-turbo", input: spokenText(request.text), voice: request.voice, response_format: "pcm", sample_rate: sampleRate }),
    });
    if (!response.ok) throw new Error(`VieNeu trả lỗi HTTP ${response.status}: ${await response.text()}`);
    const pcm = new Int16Array(await response.arrayBuffer());
    await writeWav(path, [Float32Array.from(pcm, value => value / 32768)]);
  }
}

async function viaPython(python: string, items: { request: VoiceRequest; path: string }[], log?: (message: string) => void) {
  const process = Bun.spawn([python, helper], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  process.stdin.write(JSON.stringify({ items: items.map(({ request, path }) => ({ text: spokenText(request.text), voice: request.voice, out: path })) }));
  await process.stdin.end();
  const errors: string[] = [];
  const reader = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of process.stderr) {
      for (const line of decoder.decode(chunk).split("\n")) {
        if (line.startsWith("{\"written\"")) log?.(`  🎙  ${JSON.parse(line).written.split(/[\\/]/).pop()}`);
        else if (line.trim()) errors.push(line);
      }
    }
  })();
  const code = await process.exited;
  await reader;
  if (code) throw new Error(`VieNeu-TTS lỗi (mã ${code}). Chạy "bun run cinema setup" để cài giọng đọc, hoặc dùng --voice silent để dựng nháp.\n${errors.slice(-12).join("\n")}`);
}

/** Đọc toàn bộ lời thoại một lần, có bộ nhớ đệm theo nội dung: sửa một câu chỉ đọc lại câu đó. */
export async function synthesize(requests: VoiceRequest[], options: VoiceOptions): Promise<VoiceResult[]> {
  await mkdir(options.cacheDirectory, { recursive: true });
  const paths = requests.map(request => join(options.cacheDirectory, `${options.engine}-${key(options.engine, request)}.wav`));
  const missing: { request: VoiceRequest; path: string }[] = [];
  for (const [index, request] of requests.entries()) {
    if (!await exists(paths[index]!) && !missing.some(item => item.path === paths[index])) missing.push({ request, path: paths[index]! });
  }
  if (missing.length) {
    options.log?.(`Đọc ${missing.length} câu bằng ${options.engine === "vieneu" ? "VieNeu-TTS" : "giọng câm (nháp)"}…`);
    if (options.engine === "silent") {
      for (const { request, path } of missing) await writeWav(path, [silentVoice(request.text)]);
    } else if (options.serverUrl) {
      await viaServer(options.serverUrl, missing);
    } else {
      await viaPython(options.python ?? "python3", missing, options.log);
    }
  }
  return Promise.all(requests.map(async (request, index) => {
    const pcm = await readWav(paths[index]!);
    const samples = resample(pcm);
    const duration = samples.length / sampleRate;
    return {
      path: paths[index]!, duration, samples,
      envelope: options.engine === "silent" ? silentEnvelope(request.text, duration) : envelope(samples, sampleRate, envelopeRate),
    };
  }));
}

