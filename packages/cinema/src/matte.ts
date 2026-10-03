import { access, mkdir, writeFile } from "@toonflow/file";
import { join } from "node:path";
import type { FilmSpec } from "./film";
import type { SetSpec } from "./set";

const skies: Record<string, string> = {
  dawn: "dawn sky, soft pink and peach clouds, pale lavender above",
  morning: "clear morning sky, soft white cumulus clouds, gentle blue",
  noon: "bright midday sky, few high clouds, saturated blue",
  golden: "golden hour sky, warm orange and amber clouds, long soft light",
  dusk: "dusk sky, magenta and violet clouds fading into deep blue",
  night: "deep blue night sky full of soft glowing stars, faint wispy clouds",
  overcast: "overcast sky, layered soft grey clouds, diffuse light",
};

/** Mô tả phông trời cho một bối cảnh: chỉ bầu trời và đường chân trời mờ, không người, không trăng (trăng/mặt trời là vật thể 3D). */
export function mattePrompt(set: SetSpec) {
  const sky = skies[set.time ?? "morning"];
  return `${sky}, faint distant tree line on the low horizon, Vietnamese countryside, painterly matte painting background for a stylized 3D animated feature film, soft brush strokes, cinematic, no people, no moon, no sun, no text`;
}

/**
 * Vẽ phông trời (matte painting) cho từng bối cảnh ngoài trời bằng Cloudflare Workers AI, lưu vào `<thư mục phim>/matte/<bối cảnh>.jpg`.
 * Chạy một lần như thuê hoạ sĩ phông: tệp ảnh là tài sản của phim (commit cùng film.ts), dựng phim về sau không cần mạng hay khoá.
 * Cần CLOUDFLARE_ACCOUNT_ID và CLOUDFLARE_API_TOKEN (quyền Workers AI). Phông đã có thì giữ nguyên; xoá tệp để vẽ lại.
 */
export async function paintMattes(spec: FilmSpec, directory: string, log: (message: string) => void) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("Cần đặt CLOUDFLARE_ACCOUNT_ID và CLOUDFLARE_API_TOKEN (token có quyền Workers AI) để vẽ phông trời.");
  const folder = join(directory, "matte");
  await mkdir(folder, { recursive: true });
  const painted: string[] = [];
  for (const [id, set] of Object.entries(spec.sets)) {
    if (set.interior) continue;
    const file = join(folder, `${id}.jpg`);
    if (await access(file).then(() => true, () => false)) continue;
    const form = new FormData();
    form.append("prompt", mattePrompt(set));
    // Khổ ngang rộng như phông sân khấu; mô hình nhận bội số 16.
    form.append("width", "1920");
    form.append("height", "816");
    log(`🎨 Vẽ phông trời "${id}"…`);
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-2-klein-9b`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const result = await response.json() as { success?: boolean; result?: { image?: string }; errors?: { message: string }[] };
    if (!response.ok || !result.result?.image) throw new Error(`Workers AI lỗi (${response.status}): ${result.errors?.map(error => error.message).join("; ") ?? "không có ảnh"}`);
    await writeFile(file, Buffer.from(result.result.image, "base64"));
    painted.push(file);
  }
  return painted;
}
