const rules = [
  {
    type: "input",
    field: "baseUrl" as const,
    title: "Địa chỉ máy chủ VieNeu",
    value: "http://127.0.0.1:8000",
    props: { placeholder: "http://127.0.0.1:8000" },
  },
  {
    type: "input",
    field: "token" as const,
    title: "VIENEU_API_KEY (để trống nếu máy chủ không đặt khóa)",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
] as const;

const version = "1.0.0";
const sampleRates = [48000, 24000, 16000, 8000];

// Máy chủ trả WAV với độ dài "không xác định" để phát trực tuyến, nên nhận PCM s16le mono rồi tự ghi header đúng độ dài.
function wav(pcm: Uint8Array, sampleRate: number) {
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, value: string) => [...value].forEach((char, index) => header.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  const output = new Uint8Array(44 + pcm.byteLength);
  output.set(new Uint8Array(header.buffer));
  output.set(pcm, 44);
  return output;
}

export default {
  id: "vieNeu",
  label: "VieNeu-TTS (tiếng Việt)",
  version,
  readme: `Đọc lời thoại và lời dẫn tiếng Việt bằng [VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) chạy trên máy của bạn (Apache-2.0, chạy được bằng CPU).

1. Cài gói: \`pip install vieneu\` (lần đầu tự tải khoảng 1 GB mô hình).
2. Bật máy chủ chuẩn OpenAI: \`python -m apps.openai_speech\` (mặc định \`http://127.0.0.1:8000\`; đổi cổng bằng biến \`PORT\`, đặt khóa bằng \`VIENEU_API_KEY\`).
   Nếu máy chủ báo \`External data path escapes model directory\`, cài \`pip install "onnxruntime<1.23"\`.
3. Điền địa chỉ máy chủ ở đây rồi chọn giọng có sẵn, hoặc giọng đã đăng ký qua \`POST /v1/voices\` (chỉ nhân bản giọng khi người nói đã đồng ý).

Máy chủ bỏ qua tốc độ đọc; điều chỉnh nhịp bằng dấu câu trong lời thoại.`,
  rules,
  models: [
    {
      id: "vieneu-v3-turbo",
      label: "VieNeu-TTS v3 Turbo",
      type: "audio",
      // Giọng có sẵn của v3 Turbo (vieneu/assets/voices_v3_turbo.json): giới tính · vùng miền · phong cách.
      voices: [
        { title: "Hải Đăng · Nam · Bắc · tự nhiên", voice: "Hải Đăng" },
        { title: "Thiện Minh · Nam · Bắc · kể chuyện", voice: "Thiện Minh" },
        { title: "Minh Đức · Nam · Bắc · tin tức", voice: "Minh Đức" },
        { title: "Thanh Bình · Nam · Bắc · kể chuyện", voice: "Thanh Bình" },
        { title: "Quốc Tuấn · Nam · Bắc · tự nhiên", voice: "Quốc Tuấn" },
        { title: "Phạm Tuyên · Nam · Bắc · tự nhiên", voice: "Phạm Tuyên" },
        { title: "Xuân Vĩnh · Nam · Bắc · tự nhiên", voice: "Xuân Vĩnh" },
        { title: "Thiền Tâm Đức · Nam · Bắc · kể chuyện", voice: "Thiền Tâm Đức" },
        { title: "Adam bựa · Nam · Bắc · tự nhiên", voice: "Adam bựa" },
        { title: "Quang Sơn · Nam · Trung · tự nhiên", voice: "Quang Sơn" },
        { title: "Thái Sơn · Nam · Nam · kể chuyện", voice: "Thái Sơn" },
        { title: "Minh Triết · Nam · Nam · tin tức", voice: "Minh Triết" },
        { title: "Đức Trí · Nam · Nam · đọc truyện", voice: "Đức Trí" },
        { title: "Adam · Nam · Nam · tự nhiên", voice: "Adam" },
        { title: "Mai Anh · Nữ · Bắc · tin tức", voice: "Mai Anh" },
        { title: "Trúc Ly · Nữ · Bắc · tự nhiên", voice: "Trúc Ly" },
        { title: "Ngọc Linh · Nữ · Bắc · kể chuyện", voice: "Ngọc Linh" },
        { title: "Đoan Trang · Nữ · Bắc · tự nhiên", voice: "Đoan Trang" },
        { title: "Ngọc Huyền · Nữ · Bắc · tự nhiên", voice: "Ngọc Huyền" },
        { title: "Quỳnh Anh · Nữ · Bắc · đọc truyện", voice: "Quỳnh Anh" },
        { title: "Ngọc Trân · Nữ · Trung · tự nhiên", voice: "Ngọc Trân" },
        { title: "Thùy Dung · Nữ · Nam · tin tức", voice: "Thùy Dung" },
        { title: "Thục Đoan · Nữ · Nam · kể chuyện", voice: "Thục Đoan" },
        { title: "Mỹ Duyên · Nữ · Nam · đọc truyện", voice: "Mỹ Duyên" },
        { title: "Kim Thanh · Nữ · Nam · đọc truyện", voice: "Kim Thanh" },
      ],
    },
  ] satisfies ProviderModel[],
  async generateAudio(request: AudioRequest): Promise<MediaAsset[]> {
    if (request.audios?.length) throw new Error("VieNeu không nhận âm thanh tham chiếu trực tiếp; hãy đăng ký giọng qua POST /v1/voices rồi chọn theo tên");
    const baseUrl = (this.config.baseUrl?.trim() || "http://127.0.0.1:8000").replace(/\/+$/, "").replace(/\/v1$/, "");
    const token = this.config.token?.trim();
    const sampleRate = sampleRates.includes(request.sampleRate ?? 0) ? request.sampleRate! : 48000;
    // ACT: CPU chỉ phục vụ 1–2 luồng; mỗi câu chờ tối đa 10 phút, lỗi 429 do người gọi quyết định thử lại.
    const signal = AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const response = await this.tool.fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ model: request.model, input: request.text, voice: request.voice || undefined, response_format: "pcm", sample_rate: sampleRate }),
      signal,
    });
    if (!response.ok) throw new Error(this.tool.errorMessage(await response.text()) || `VieNeu trả lỗi HTTP ${response.status}`);
    const pcm = new Uint8Array(await response.arrayBuffer());
    if (!pcm.byteLength) throw new Error("VieNeu không trả về âm thanh");
    const data = wav(pcm, sampleRate);
    if (request.format === "mp3") return [{ mediaType: "audio", type: "binary", ...(await this.tool.audio.convert(data, { format: "mp3" })) }];
    return [{ mediaType: "audio", type: "binary", data, mimeType: "audio/wav" }];
  },
} satisfies ProviderDefinition<typeof rules>;
