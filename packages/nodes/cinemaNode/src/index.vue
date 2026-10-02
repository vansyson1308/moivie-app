<template>
  <nodeSkeleton
    v-bind="nodeProps"
    :topVisible="node.selected"
    topWidth="max-content"
    :downloadUrl="videoUrl || imageUrl"
    :downloadName="(videoFile ?? imageFile)?.url.split(/[\\/]/).at(-1)"
    :style="{ width: '360px' }"
    @fullscreen="player?.enterFullscreen()">
    <div class="cinemaContent nopan nodrag">
      <el-input v-model="film" size="small" placeholder="phimCuaToi/film.ts" aria-label="Đường dẫn film.ts trong workspace" :disabled="running" />
      <div class="cinemaActions">
        <el-button size="small" :disabled="running || !film" @click="run('sheet')">Storyboard</el-button>
        <el-button size="small" :disabled="running || !film" @click="run('render', true)">Nháp</el-button>
        <el-button size="small" type="primary" :disabled="running || !film" @click="run('render')">Bản cuối</el-button>
        <el-button v-if="running" size="small" type="danger" text @click="cancel">Dừng</el-button>
      </div>
      <pre v-if="log.length" class="cinemaLog" role="log" aria-live="polite">{{ log.join("\n") }}</pre>
      <videoPlayer v-if="videoUrl" ref="player" :src="videoUrl" />
      <img v-else-if="imageUrl" class="cinemaSheet" :src="imageUrl" draggable="false" alt="Storyboard" />
    </div>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, watch } from "vue";
import { IconMovie } from "@tabler/icons-vue";
import { ElButton, ElInput, ElMessage } from "element-plus";
import { nodeSkeleton, useNode, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import videoPlayer from "@toonflow/nodes-scaffold/videoPlayer";

defineOptions({
  inheritAttrs: false,
  icon: IconMovie,
  handles: [
    { id: "video", type: "source", dataType: "VIDEO", label: "Phim" },
    { id: "image", type: "source", dataType: "IMAGE", label: "Storyboard" },
  ] satisfies NodeHandle[],
});
const { node, nodeProps, outputs, files } = useNode({ label: "Phim" });
const getDirectory = inject<(() => string) | undefined>("workspaceDirectory", undefined);
const data = computed(() => node.data as typeof node.data & { film?: string });
const film = ref(data.value.film ?? "");
watch(film, value => { data.value.film = value.trim(); });
const running = ref(false);
const log = ref<string[]>([]);
const player = ref<InstanceType<typeof videoPlayer>>();
let requestId = "";
const lifetime = new AbortController();
onScopeDispose(() => lifetime.abort());

const videoFile = computed(() => outputs.value.video?.dataType === "VIDEO" ? outputs.value.video.value : undefined);
const imageFile = computed(() => outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined);
const videoUrl = files.useFileUrl(videoFile, error => showError(error, "Không đọc được video"));
const imageUrl = files.useFileUrl(imageFile, error => showError(error, "Không đọc được storyboard"));

function post(body: Record<string, unknown>, signal?: AbortSignal) {
  if (!getDirectory) throw new Error("Canvas chưa có thư mục workspace");
  return fetch("/api/cinema/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
    body: JSON.stringify({ requestId, directory: getDirectory(), ...body }),
    signal,
  });
}

async function run(command: "sheet" | "render", draft = false) {
  running.value = true;
  log.value = [];
  requestId = crypto.randomUUID();
  try {
    const response = await post({ command, film: film.value.trim(), draft }, lifetime.signal);
    if (!response.ok || !response.body) throw new Error((await response.json().catch(() => undefined))?.message ?? `HTTP ${response.status}`);
    // Luồng SSE: mỗi sự kiện là một dòng "data: {...}", các sự kiện cách nhau một dòng trống.
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffer += chunk.value;
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop()!;
      for (const block of blocks) {
        const line = block.split("\n").find(item => item.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6)) as { type: string; line?: string; outputs?: string[]; message?: string };
        if (event.type === "log" && event.line?.trim()) log.value = [...log.value.slice(-7), event.line];
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") {
          const video = event.outputs?.find(path => path.endsWith(".mp4"));
          const sheet = event.outputs?.find(path => path.endsWith(".png"));
          if (video) outputs.value.video = { dataType: "VIDEO", value: { url: video, mimeType: "video/mp4" } };
          if (sheet) outputs.value.image = { dataType: "IMAGE", value: { url: sheet, mimeType: "image/png" } };
          if (command === "sheet") outputs.value.video = undefined;
        }
      }
    }
  } catch (error) {
    if (!lifetime.signal.aborted) showError(error, "Dựng phim thất bại");
  } finally {
    running.value = false;
  }
}

async function cancel() {
  await post({ command: "cancel" }).catch(error => showError(error, "Không dừng được"));
}

function showError(error: unknown, fallback: string) {
  ElMessage.error(error instanceof Error ? error.message : fallback);
}
</script>

<style scoped lang="scss">
.cinemaContent {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;

  .cinemaActions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;

    .el-button + .el-button {
      margin-left: 0;
    }
  }

  .cinemaLog {
    max-height: 120px;
    margin: 0;
    overflow: auto;
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--el-text-color-secondary);
  }

  .cinemaSheet {
    width: 100%;
    border-radius: var(--el-border-radius-base);
  }
}
</style>
