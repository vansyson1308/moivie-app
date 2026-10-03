"""Xưởng dựng 3D: đọc bản take (JSON do bộ máy TypeScript xuất), dựng cảnh trong Blender, render từng khung ra PNG.

Chạy: python main.py <take.json> <thư mục ra>   (Python có cài module bpy, xem `bun run cinema setup --3d`).
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
import addon_utils  # chỉ có sau khi đã nạp bpy

import actor as actors
import look
import stage


def configure(scene, take: dict):
    width, height = take["size"]
    final = take["quality"] == "final"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    # ACT: hình cách điệu ít chi tiết vi mô nên 24 mẫu + khử nhiễu OIDN đã sạch; tăng mẫu khi có lông, tóc sợi, kính.
    scene.cycles.samples = 24 if final else 10
    scene.cycles.adaptive_threshold = 0.03 if final else 0.08
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 2
    scene.cycles.transmission_bounces = 2
    scene.cycles.transparent_max_bounces = 4
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.use_persistent_data = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    # Khung trung gian chỉ để ghép rồi nén x264: JPEG chất lượng cao nhẹ hơn PNG ~5 lần (đáng kể khi chuyển giữa các máy dựng).
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 94
    scene.render.film_transparent = False
    scene.render.fps = take.get("fps", 24)
    # Nhoè chuyển động thật: khung liền nhau là khoá hình liền nhau, Cycles nội suy giữa chúng (màn trập 180°).
    scene.render.use_motion_blur = final
    scene.render.motion_blur_shutter = 0.5


def freeze(scene):
    """Áp sẵn modifier (bo tròn, độ dày) cho mọi khối cứng: các bộ phận chỉ dời/xoay theo khung nên không cần tính lại lưới mỗi khung.

    Khối có shape key (miệng, váy) vẫn giữ modifier vì lưới đổi theo khung.
    """
    scene.frame_set(1)
    depsgraph = scene.view_layers[0].depsgraph
    for obj in scene.objects:
        if obj.type != "MESH" or not obj.modifiers or obj.data.shape_keys:
            continue
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
        obj.modifiers.clear()
        obj.data = mesh


def atmosphere(scene, palette: dict, night: bool):
    """Phối cảnh không khí: trộn màu sương theo độ xa (pass mist) — xa thì nhạt và ngả màu trời, tạo chiều sâu."""
    scene.view_layers[0].use_pass_mist = True
    scene.world.mist_settings.start = 3.0
    scene.world.mist_settings.depth = 80.0
    scene.world.mist_settings.falloff = "QUADRATIC"
    scene.use_nodes = True
    tree = scene.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    layers = tree.nodes.new("CompositorNodeRLayers")
    layers.scene = scene
    strength = tree.nodes.new("CompositorNodeMath")
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = 0.5 if night else 0.38
    mix = tree.nodes.new("CompositorNodeMixRGB")
    mix.inputs[2].default_value = look.linear(palette["haze"])
    output = tree.nodes.new("CompositorNodeComposite")
    # Bầu trời (mist = 1) giữ nguyên màu đã vẽ: chỉ phủ sương lên vật thể.
    solid = tree.nodes.new("CompositorNodeMath")
    solid.operation = "LESS_THAN"
    solid.inputs[1].default_value = 0.999
    hazed = tree.nodes.new("CompositorNodeMath")
    hazed.operation = "MULTIPLY"
    tree.links.new(layers.outputs["Mist"], strength.inputs[0])
    tree.links.new(layers.outputs["Mist"], solid.inputs[0])
    tree.links.new(strength.outputs["Value"], hazed.inputs[0])
    tree.links.new(solid.outputs["Value"], hazed.inputs[1])
    tree.links.new(hazed.outputs["Value"], mix.inputs["Fac"])
    tree.links.new(layers.outputs["Image"], mix.inputs[1])
    tree.links.new(mix.outputs["Image"], output.inputs["Image"])


def main():
    takePath, output = sys.argv[-2], sys.argv[-1]
    with open(takePath, encoding="utf-8") as handle:
        take = json.load(handle)
    os.makedirs(output, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable("cycles", default_set=True)
    # Mỗi góc máy một scene riêng: khung trong scene là các khoảnh khắc liền nhau của cùng góc máy (đúng cho nhoè chuyển động);
    # đoạn hòa hình cần thêm khung của góc máy trước nên có hai scene.
    groups: dict = {}
    for index, frame in enumerate(take["frames"]):
        groups.setdefault((frame["setId"], frame.get("shotIndex", 0)), []).append((index, frame))
    for (setId, shotIndex), frames in groups.items():
        scene = bpy.data.scenes.new(f"{setId}{shotIndex}")
        configure(scene, take)
        collection = bpy.data.collections.new(f"{setId}{shotIndex}")
        scene.collection.children.link(collection)
        spec = take["sets"][setId]
        moving = stage.build(scene, collection, spec, frames[0][1].get("offsets", {}))
        atmosphere(scene, spec["palette"], spec.get("time") == "night")
        cam = stage.camera(scene, collection)
        # Diễn viên ở collection riêng để nhận đèn nhân vật (light linking) mà bối cảnh không bị ảnh hưởng.
        troupe = bpy.data.collections.new(f"{setId}{shotIndex}Cast")
        collection.children.link(troupe)
        stage.faceLight(collection, troupe, spec.get("time", "morning"))
        cast = {}
        for _, frame in frames:
            for item in frame["actors"]:
                if item["id"] not in cast:
                    cast[item["id"]] = actors.Actor(take["characters"][item["id"]], take["faces"], take["props"], troupe)
        # Đặt khoá hình cho mọi khung trước, rồi render lần lượt (dữ liệu cảnh được giữ lại giữa các khung).
        for number, (_, frame) in enumerate(frames, start=1):
            stage.frameCamera(cam, frame["camera"], frame["shot"], number)
            present = {item["id"] for item in frame["actors"]}
            for item in frame["actors"]:
                cast[item["id"]].pose(item, number)
            for actorId, performer in cast.items():
                if actorId not in present:
                    performer.hide(number)
            for elementId, (obj, element) in moving.items():
                offset = frame["offsets"].get(elementId, 0)
                if element.get("card"):
                    obj.location.x = offset * stage.S
                else:
                    stage.place(obj, element, offset, 0.0, spec.get("width", 1920))
                obj.keyframe_insert("location", frame=number)
        freeze(scene)
        for number, (_, frame) in enumerate(frames, start=1):
            if not frame["file"]:
                continue  # khung ngữ cảnh: chỉ có khoá hình cho nhoè chuyển động
            started = time.time()
            scene.frame_set(number)
            scene.render.filepath = os.path.join(output, frame["file"])
            bpy.ops.render.render(write_still=True, scene=scene.name)
            print(json.dumps({"rendered": frame["file"], "seconds": round(time.time() - started, 2)}), flush=True)


if __name__ == "__main__":
    main()
