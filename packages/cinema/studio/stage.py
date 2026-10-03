"""Bối cảnh 3D: bầu trời, mặt đất, vật thể sân khấu dựng thủ tục, ánh sáng điện ảnh và máy quay.

Ánh sáng theo lối phim hoạt hình 3D: đèn chính (key) chiếu xiên từ phía trước theo hướng sáng của cảnh,
mặt trời/trăng thật đặt phía sau làm viền sáng (rim), bầu trời toả sáng dịu (fill), và đèn thực trong cảnh
(đèn lồng, cửa sổ, lửa trại) là nguồn sáng thật chiếu lên nhân vật.
"""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

import actor as actors
import look

S = actors.S

# Ống kính theo cỡ cảnh: cận dùng tiêu cự dài (nén hậu cảnh, mặt không méo), toàn cảnh dùng ống rộng.
lenses = {"establishing": 24, "wide": 28, "full": 35, "twoShot": 40, "medium": 50, "overShoulder": 60, "mediumClose": 65, "closeUp": 85, "extremeCloseUp": 100, "auto": 35}

groundColors = {"grass": "#6f9a4f", "dirt": "#9a7752", "sand": "#d8c194", "wood": "#8c6646", "tile": "#c4b296", "stone": "#8f8b84", "none": "#000000"}


# Khoảng cách máy quay toàn cảnh tới sân khấu: khung cao 1080 đơn vị, ống 24 mm (xem frameCamera).
wideDistance = 1080 * S / 2 * 24 / 12


def depthY(depth: float) -> float:
    """Độ sâu thị sai 2D (1 = sân khấu, nhỏ hơn = xa hơn) sang khoảng cách thật phía sau sân khấu (mét).

    Bản 2D: lớp ở độ sâu d trượt d lần so với sân khấu khi máy lia. Máy quay thật cách sân khấu D thì vật ở sau thêm Y
    trượt D/(D+Y) lần, nên Y = D(1/d − 1) với D là khoảng cách của khung toàn cảnh.
    """
    return (1 / max(depth, 0.02) - 1) * wideDistance


def world(scene, palette: dict, night: bool, matte=None):
    sky = bpy.data.worlds.new(scene.name + "Sky")
    scene.world = sky
    sky.use_nodes = True
    nodes = sky.node_tree.nodes
    links = sky.node_tree.links
    background = nodes["Background"]
    coords = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    top, middle, horizon = palette["sky"]
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = look.linear(horizon)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = look.linear(top)
    mid = ramp.color_ramp.elements.new(0.18)
    mid.color = look.linear(middle)
    links.new(coords.outputs["Generated"], separate.inputs["Vector"])
    links.new(separate.outputs["Z"], ramp.inputs["Fac"])
    color = ramp.outputs["Color"]
    if night:
        # Sao: điểm Voronoi rất nhỏ, chỉ hiện với tia của máy quay.
        stars = nodes.new("ShaderNodeTexVoronoi")
        stars.inputs["Scale"].default_value = 420.0
        threshold = nodes.new("ShaderNodeMath")
        threshold.operation = "LESS_THAN"
        threshold.inputs[1].default_value = 0.035
        links.new(coords.outputs["Generated"], stars.inputs["Vector"])
        links.new(stars.outputs["Distance"], threshold.inputs[0])
        add = nodes.new("ShaderNodeMix")
        add.data_type = "RGBA"
        add.blend_type = "ADD"
        links.new(threshold.outputs["Value"], add.inputs["Factor"])
        links.new(color, add.inputs["A"])
        add.inputs["B"].default_value = (0.9, 0.9, 1.0, 1)
        color = add.outputs["Result"]
    if matte:
        # Phông trời vẽ tay: tia của máy quay thấy tranh (dán theo khung hình như phông sân khấu ở vô cực),
        # còn ánh sáng bầu trời chiếu lên cảnh vẫn là dải màu theo giờ.
        painting = nodes.new("ShaderNodeTexImage")
        painting.image = bpy.data.images.load(matte)
        painting.extension = "EXTEND"
        links.new(coords.outputs["Window"], painting.inputs["Vector"])
        path = nodes.new("ShaderNodeLightPath")
        pick = nodes.new("ShaderNodeMix")
        pick.data_type = "RGBA"
        links.new(path.outputs["Is Camera Ray"], pick.inputs["Factor"])
        links.new(color, pick.inputs["A"])
        links.new(painting.outputs["Color"], pick.inputs["B"])
        color = pick.outputs["Result"]
    links.new(color, background.inputs["Color"])
    background.inputs["Strength"].default_value = 0.6 if night else 0.9


def lights(scene, collection, lighting: dict, palette: dict, time: str):
    night = time == "night"
    low = time in ("dawn", "golden", "dusk")
    dx, dy = lighting["dir"]
    sunColor = palette.get("sun", [0.5, -600, "#fff6e0"])[2] if palette.get("sun") else "#dfe6f0"
    # Đèn chính: chiếu từ phía trước-bên theo hướng sáng 2D của cảnh (dx: trái/phải màn hình, dy: cao/thấp).
    key = bpy.data.lights.new("key", "SUN")
    # Kịch bản màu đêm kiểu phim hoạt hình: trăng xanh lạnh làm đèn chính, đèn trong cảnh vàng ấm — tương phản nóng/lạnh.
    key.energy = {"night": 0.9, "dusk": 1.6, "golden": 2.6, "dawn": 2.0}.get(time, 3.4)
    key.color = look.linear("#8fa8ff" if night else look.mix(sunColor, "#ffffff", 0.2))[:3]
    key.angle = math.radians(4 if not night else 8)
    keyObject = bpy.data.objects.new("key", key)
    collection.objects.link(keyObject)
    direction = Vector((-dx, 1.4, dy * (0.6 if low else 1.2) - 0.25)).normalized()
    keyObject.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    # Viền sáng phía sau: tách nhân vật khỏi nền (mạnh khi nắng thấp hoặc đêm trăng).
    rim = bpy.data.lights.new("rim", "SUN")
    rim.energy = 1.2 if low else 0.5 if night else 0.6
    rim.color = look.linear(look.mix(sunColor, "#ffffff", 0.1) if not night else "#cfd8ff")[:3]
    rim.angle = math.radians(6)
    rimObject = bpy.data.objects.new("rim", rim)
    collection.objects.link(rimObject)
    rimObject.rotation_euler = Vector((dx * 0.8, -1.0, -0.35)).normalized().to_track_quat("-Z", "Y").to_euler()


def faceLight(collection, troupe, time: str):
    """Đèn nhân vật kiểu xưởng hoạt hình: nguồn sáng mềm từ trước-trên-trái chỉ chiếu lên diễn viên (light linking),
    giữ mặt luôn đọc được kể cả khi ngược sáng, như đèn lồng/ánh trăng hắt vào; bối cảnh vẫn theo ánh sáng thật."""
    night = time == "night"
    light = bpy.data.lights.new("faceKey", "SUN")
    light.energy = 1.1 if night else 0.8
    light.angle = math.radians(25)
    light.color = look.linear("#ffd9b0" if night else "#fff4e6")[:3]
    obj = bpy.data.objects.new("faceKey", light)
    collection.objects.link(obj)
    obj.rotation_euler = Vector((0.45, 1.0, -0.55)).normalized().to_track_quat("-Z", "Y").to_euler()
    obj.light_linking.receiver_collection = troupe


def ground(collection, spec: dict):
    kind = spec.get("ground") or ("wood" if spec.get("interior") else "grass")
    if kind == "none":
        return
    color = spec.get("groundColor") or (spec.get("interior") or {}).get("floor") or groundColors[kind]
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.object
    for user in list(plane.users_collection):
        user.objects.unlink(plane)
    collection.objects.link(plane)
    plane.scale = (90, 60, 1)
    plane.location = (spec.get("width", 1920) * S / 2, 22, 0)
    plane.data.materials.append(look.principled("ground", color, roughness=0.92, noise=0.22))


def place(obj, element: dict, offset: float, z: float = 0.0, width: float = 1920):
    depth = element.get("depth", 1.0)
    # Khối dựng ở độ sâu ≤ 1 lùi thêm sau vạch diễn để không chắn lối đi của diễn viên (bản 2D vẽ chúng như phông).
    back = 1.2 if depth <= 1 else 0.0
    obj.location = ((element.get("x", width / 2) + offset) * S, depthY(depth) + back, z)
    scale = element.get("scale", 1.0)
    obj.scale = (scale, scale, scale)
    if element.get("flip"):
        obj.scale.x *= -1


def solid(name, size, location, material, collection, bevel=0.02):
    """Khối hộp bo cạnh đặt theo tâm (tường, sàn hiên, cửa)."""
    bpy.ops.mesh.primitive_cube_add()
    obj = bpy.context.object
    for user in list(obj.users_collection):
        user.objects.unlink(obj)
    collection.objects.link(obj)
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    obj.location = location
    obj.data.materials.append(material)
    obj.modifiers.new("bevel", "BEVEL").width = bevel
    return obj


def slab(name, corners, material, collection, thickness=0.1):
    """Mái: tấm bốn góc có độ dày."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(corner) for corner in corners])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.modifiers.new("thick", "SOLIDIFY").thickness = thickness
    obj.data.materials.append(material)
    return obj


def house(collection, element, night):
    """Nhà mái ngói có hiên: sàn gỗ, cột gỗ, mái hiên; gốc toạ độ ở mép trước của hiên (nhà lùi hết về sau vạch đặt)."""
    root = bpy.data.objects.new("house", None)
    collection.objects.link(root)
    width, depth, height, porch = 3.4, 2.6, 2.0, 1.25
    wall = look.principled("plaster", element.get("color", "#e6d9c2"), roughness=0.9, noise=0.08)
    wood = look.principled("timber", "#6b4a32", roughness=0.65, noise=0.3)
    tiles = look.principled("tiles", "#a14a3c", roughness=0.7, noise=0.25)
    front = porch
    parts = [solid("walls", (width, depth, height), (0, front + depth / 2, height / 2), wall, collection, 0.03)]
    over, rise = 0.35, 1.25
    w, d = width / 2 + over, depth / 2 + over
    y0 = front + depth / 2
    parts.append(slab("roof", [(-w, y0 - d, height - 0.05), (w, y0 - d, height - 0.05), (w, y0, height + rise), (-w, y0, height + rise)], tiles, collection, 0.12))
    parts.append(slab("roofBack", [(-w, y0, height + rise), (w, y0, height + rise), (w, y0 + d, height - 0.05), (-w, y0 + d, height - 0.05)], tiles, collection, 0.12))
    # Hiên: sàn gỗ thấp, bốn cột, mái hiên dốc từ tường ra.
    parts.append(solid("porchFloor", (width + 0.3, porch + 0.1, 0.18), (0, porch / 2, 0.09), wood, collection))
    for x in (-width / 2, -width / 6, width / 6, width / 2):
        post = actors.capsule("post", 2.05, 0.055, 0.05, collection)
        post.location = (x, 0.08, 0.15)
        parts.append(actors.finish(post, wood, levels=1))
    parts.append(slab("porchRoof", [(-w, -0.25, 2.05), (w, -0.25, 2.05), (w, front, height - 0.1), (-w, front, height - 0.1)], tiles, collection, 0.08))
    parts.append(solid("beam", (width + 0.2, 0.1, 0.1), (0, 0.08, 2.12), wood, collection))
    glow = look.principled("window", "#ffcf7a", emission=3.0, roughness=0.4) if night else look.principled("glass", "#3d4a52", roughness=0.08, coat=1.0)
    for x in (-1.0, 1.0):
        parts.append(solid("window", (0.64, 0.06, 0.6), (x, front - 0.01, 1.15), glow, collection, 0.01))
        parts.append(solid("frame", (0.74, 0.08, 0.06), (x, front - 0.02, 1.48), wood, collection, 0.01))
        parts.append(solid("sill", (0.74, 0.12, 0.06), (x, front - 0.04, 0.83), wood, collection, 0.01))
    parts.append(solid("door", (0.8, 0.08, 1.5), (0, front - 0.01, 0.9), look.principled("door", "#5b3a26", roughness=0.6, noise=0.2), collection))
    for part in parts:
        part.parent = root
    if night:
        # Ánh đèn trong nhà hắt qua cửa sổ ra sân: nguồn sáng ấm chiếu ra phía trước (ngược hướng máy quay nhìn vào).
        for x in (-1.0, 1.0):
            light = bpy.data.lights.new("windowLight", "AREA")
            light.energy = 45
            light.size = 0.6
            light.color = look.linear("#ffb35c")[:3]
            lamp = bpy.data.objects.new("windowLight", light)
            collection.objects.link(lamp)
            lamp.parent = root
            lamp.location = (x, front - 0.12, 1.15)
            lamp.rotation_euler = (-math.pi / 2, 0, 0)
    return root


def tree(collection, element, seed):
    rand = random.Random(seed)
    root = bpy.data.objects.new("tree", None)
    collection.objects.link(root)
    trunk = actors.capsule("trunk", 2.0, 0.16, 0.09, collection)
    actors.finish(trunk, look.principled("bark", "#5a3d28", roughness=0.85, noise=0.3), levels=1)
    trunk.parent = root
    leaf = look.principled("leaves", element.get("color", "#4f8a3c"), roughness=0.7, subsurface=0.1, noise=0.25, sheen=0.3)
    # Tán cây: nhiều cụm lá tròn lớn nhỏ chồng nhau (hình khối đọc được như tranh, mặt lá lổn nhổn bắt sáng).
    for index in range(11):
        blob = actors.ellipsoid("foliage", (0.75, 0.68, 0.62), collection, segments=16)
        blob.location = (rand.uniform(-0.9, 0.9), rand.uniform(-0.6, 0.6), 2.2 + rand.uniform(-0.35, 0.8))
        blob.scale = [rand.uniform(0.55, 1.05)] * 3
        displace = blob.modifiers.new("lumps", "DISPLACE")
        texture = bpy.data.textures.new("lumps", "CLOUDS")
        texture.noise_scale = 0.22
        displace.texture = texture
        displace.strength = 0.18
        actors.finish(blob, leaf, levels=1)
        blob.parent = root
    return root


def lantern(collection, element, night, hang):
    """Đèn lồng giấy: thân bầu có nan, chóp và đáy gỗ, tua rua; treo bằng dây lên tới mái hiên (độ cao hang, mét)."""
    root = bpy.data.objects.new("lantern", None)
    collection.objects.link(root)
    color = element.get("color", "#e74c3c")
    paper = look.principled("lanternPaper", color, roughness=0.6, sheen=0.3, emission=2.2 if night else 0.4, emissionColor=look.mix(color, "#ffd27a", 0.35), transmission=0.1)
    gold = look.principled("lanternCap", "#c9a14a", roughness=0.35, metallic=0.6)
    body = actors.ellipsoid("lanternBody", (0.14, 0.14, 0.17), collection, segments=24)
    for vertex in body.data.vertices:
        # Nan tre: thân hơi lõm giữa các nan.
        angle = math.atan2(vertex.co.y, vertex.co.x)
        dent = 1 - 0.05 * abs(math.sin(angle * 6)) ** 0.5 * (1 - abs(vertex.co.z) / 0.17)
        vertex.co.x *= dent
        vertex.co.y *= dent
    actors.finish(body, paper, levels=1).parent = root
    for z in (0.16, -0.16):
        cap = actors.ellipsoid("lanternCapRing", (0.075, 0.075, 0.025), collection, segments=16)
        cap.location = (0, 0, z)
        actors.finish(cap, gold, levels=1).parent = root
    tassel = actors.capsule("lanternTassel", 0.16, 0.012, 0.03, collection)
    tassel.location = (0, 0, -0.18)
    tassel.rotation_euler = (math.pi, 0, 0)
    actors.finish(tassel, look.principled("tassel", look.mix(color, "#000000", 0.2), roughness=0.7, sheen=0.5), levels=1).parent = root
    string = actors.capsule("lanternString", max(0.1, hang), 0.004, 0.004, collection)
    actors.finish(string, look.principled("string", "#2b2522"), levels=0)
    string.parent = root
    string.location = (0, 0, 0.17)
    light = bpy.data.lights.new("lanternLight", "POINT")
    light.energy = 35 if night else 4
    light.color = look.linear(look.mix(color, "#ffcf8a", 0.5))[:3]
    light.shadow_soft_size = 0.12
    lamp = bpy.data.objects.new("lanternLight", light)
    collection.objects.link(lamp)
    lamp.parent = root
    # Nguồn sáng ngay dưới đáy đèn: không bị thân giấy che, soi lên mặt người đứng gần.
    lamp.location = (0, -0.05, -0.24)
    return root


def hills(collection, element, palette, seed, far):
    """Đồi núi xa: khối thấp trải rộng, màu hoà vào sương theo khoảng cách (phối cảnh không khí)."""
    rand = random.Random(seed)
    root = bpy.data.objects.new("hills", None)
    collection.objects.link(root)
    color = look.mix(element.get("color", "#5d7a5a"), palette["haze"], 0.45 if far else 0.25)
    material = look.principled("hill", color, roughness=0.95, noise=0.1)
    for index in range(7):
        hill = actors.ellipsoid("hill", (rand.uniform(6, 12), rand.uniform(4, 7), rand.uniform(1.5, 3.5) * (2.2 if far else 1.0)), collection, segments=20)
        hill.location = (rand.uniform(-20, 32), rand.uniform(-2, 4), -0.5)
        actors.finish(hill, material, levels=1)
        hill.parent = root
    return root


def bamboo(collection, element, seed):
    """Bụi tre: thân đốt thẳng hơi nghiêng, lá thành chùm thuôn ở ngọn."""
    rand = random.Random(seed)
    root = bpy.data.objects.new("bamboo", None)
    collection.objects.link(root)
    stem = look.principled("bambooStem", element.get("color", "#6f9a3c"), roughness=0.4, coat=0.3, noise=0.15)
    leaf = look.principled("bambooLeaf", look.mix(element.get("color", "#6f9a3c"), "#2f5a2a", 0.4), roughness=0.6, subsurface=0.15, sheen=0.3, noise=0.2)
    for index in range(9):
        height = rand.uniform(3.5, 5.5)
        cane = actors.capsule("cane", height, 0.045, 0.03, collection)
        cane.location = (rand.uniform(-0.8, 0.8), rand.uniform(-0.5, 0.5), 0)
        cane.rotation_euler = (rand.uniform(-0.08, 0.08), rand.uniform(-0.12, 0.12), 0)
        actors.finish(cane, stem, levels=1).parent = root
        for knot in range(1, int(height / 0.45)):
            ring = actors.ellipsoid("knot", (0.05, 0.05, 0.012), collection, segments=10)
            ring.location = (0, 0, knot * 0.45)
            actors.finish(ring, stem, levels=0).parent = cane
        # Lá tre: chùm lá thon dài rủ xuống ở các đốt trên cao.
        for tuft in range(6):
            z = height * rand.uniform(0.55, 0.98)
            turn = rand.uniform(0, math.pi * 2)
            for blade in range(7):
                spin = turn + rand.uniform(-0.9, 0.9)
                leafObj = actors.ellipsoid("leaf", (0.17, 0.028, 0.006), collection, segments=8)
                leafObj.location = (math.cos(spin) * 0.16, math.sin(spin) * 0.16, z)
                leafObj.rotation_euler = (rand.uniform(-0.2, 0.2), rand.uniform(0.3, 0.8), spin)
                actors.finish(leafObj, leaf, levels=0).parent = cane
    return root


def grass(collection, element, seed, night):
    """Cỏ: nhiều lá cỏ thuôn rải ngẫu nhiên thành dải, rộng theo element.width (đơn vị thế giới)."""
    rand = random.Random(seed)
    root = bpy.data.objects.new("grass", None)
    collection.objects.link(root)
    width = element.get("width", 600) * S
    mesh = bpy.data.meshes.new("grassBlades")
    bm = bmesh.new()
    for index in range(int(width * 700)):
        x, y = rand.uniform(-width / 2, width / 2), rand.uniform(-1.0, 1.0)
        height = rand.uniform(0.12, 0.32)
        lean, turn = rand.uniform(-0.3, 0.3), rand.uniform(0, math.pi)
        base = 0.012
        a = bm.verts.new((x - math.cos(turn) * base, y - math.sin(turn) * base, 0))
        b = bm.verts.new((x + math.cos(turn) * base, y + math.sin(turn) * base, 0))
        tip = bm.verts.new((x + lean * height * math.sin(turn), y - lean * height * math.cos(turn), height))
        bm.faces.new((a, b, tip))
    bm.to_mesh(mesh)
    bm.free()
    blades = bpy.data.objects.new("grassBlades", mesh)
    collection.objects.link(blades)
    blades.parent = root
    blades.data.materials.append(look.principled("grass", element.get("color", "#4f7a34"), roughness=0.6, subsurface=0.2, sheen=0.4, noise=0.3))
    return root


def card(collection, item: dict, width: float):
    """Phông vẽ: ảnh do bộ máy 2D vẽ dựng thành tấm phẳng; to ra theo khoảng cách để nhìn từ khung toàn cảnh đúng như bản 2D.

    ACT: phông là hình phẳng nên không đổ bóng và không có thị sai bên trong; đủ cho hậu cảnh xa và vật chưa có mô hình.
    """
    depth = item["depth"]
    x0, y0, x1, y1 = item["box"]
    distance = depthY(depth) + (0.6 if depth <= 1 else 0.0)
    grow = (wideDistance + distance) / wideDistance
    center = width / 2
    mesh = bpy.data.meshes.new("card")
    bm = bmesh.new()
    corners = [(x0, y1), (x1, y1), (x1, y0), (x0, y0)]
    verts = [bm.verts.new(((center + (x - center) * grow) * S, 0, -y * S * grow)) for x, y in corners]
    face = bm.faces.new(verts)
    uv = bm.loops.layers.uv.new("uv")
    for loop, (u, v) in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("card", mesh)
    collection.objects.link(obj)
    obj.location = (0, distance, 0)
    obj.visible_shadow = False
    material = bpy.data.materials.new("card")
    material.use_nodes = True
    material.blend_method = "HASHED"
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes["Principled BSDF"]
    image = nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.load(item["file"])
    image.extension = "CLIP"
    links.new(image.outputs["Color"], shader.inputs["Base Color"])
    links.new(image.outputs["Alpha"], shader.inputs["Alpha"])
    # Phông nhận ánh sáng cảnh (đêm thì tối theo) và tự sáng nhẹ để màu vẽ không chìm hẳn.
    links.new(image.outputs["Color"], shader.inputs["Emission Color"])
    shader.inputs["Emission Strength"].default_value = 0.12
    shader.inputs["Roughness"].default_value = 1.0
    obj.data.materials.append(material)
    return obj


def build(scene, collection, spec: dict, offsets: dict):
    """Dựng một bối cảnh; trả về các vật thể có id để cập nhật vị trí theo khung (thuyền trôi...)."""
    time = spec.get("time", "morning")
    palette = spec["palette"]
    night = time == "night"
    world(scene, palette, night, spec.get("matte"))
    lights(scene, collection, spec["lighting"], palette, time)
    ground(collection, spec)
    moving = {}
    width = spec.get("width", 1920)
    for index, element in enumerate(spec.get("elements", [])):
        kind = element["type"]
        seed = element.get("seed", index + 1)
        obj = None
        if kind == "house":
            obj = house(collection, element, night)
        elif kind == "tree":
            obj = tree(collection, element, seed)
        elif kind == "lantern":
            z = -element.get("y", -260) * S
            obj = lantern(collection, element, night, 2.6 - z - 0.17)
            # Treo dưới mái hiên, ngay mép trước của hiên nhà (cùng vạch lùi với nhà).
            place(obj, {**element, "depth": element.get("depth", 1.0)}, 0, z, width)
            obj.location.y += 0.1
            continue
        elif kind == "bamboo":
            obj = bamboo(collection, element, seed)
            element = {**element, "depth": element.get("depth", 0.7)}
        elif kind == "grass":
            obj = grass(collection, element, seed, night)
            element = {**element, "depth": element.get("depth", 1.15)}
        elif kind in ("hills", "mountains"):
            obj = hills(collection, element, palette, seed, kind == "mountains")
            element = {**element, "depth": element.get("depth", 0.12 if kind == "mountains" else 0.3)}
        if obj is None:
            continue
        if kind == "tree":
            element = {**element, "depth": element.get("depth", 0.85)}
        if kind == "house":
            # ACT: bản 2D phóng nhà to như biểu tượng; khối 3D chỉ giữ một nửa mức phóng để cửa, hiên đúng cỡ người.
            element = {**element, "depth": element.get("depth", 0.8), "scale": 1 + (element.get("scale", 1.0) - 1) * 0.45}
        place(obj, element, offsets.get(element.get("id", ""), 0), 0.0, width)
        if element.get("id"):
            moving[element["id"]] = (obj, element)
    for item in spec.get("cards", []):
        obj = card(collection, item, width)
        if item.get("id"):
            # Phông di chuyển (thuyền trôi): gốc toạ độ phông là vị trí ban đầu, dịch theo offset từng khung.
            moving[item["id"]] = (obj, {"card": True})
    if night:
        # Trăng: đĩa phát sáng ở xa phía sau, đúng chỗ trên khung toàn cảnh như bản 2D.
        moon = actors.ellipsoid("moon", (6, 6, 6), collection, segments=24)
        sun = palette.get("sun", [0.75, -760, "#f4f1de"])
        moon.location = ((sun[0] * spec.get("width", 1920) * 0.8) * S + 4, 230, 60)
        moon.data.materials.append(look.principled("moonGlow", sun[2], emission=6.0))
        moon.visible_shadow = False
    return moving


def camera(scene, collection):
    data = bpy.data.cameras.new("camera")
    data.sensor_fit = "VERTICAL"
    data.sensor_height = 24
    data.clip_start = 0.05
    data.clip_end = 2000
    obj = bpy.data.objects.new("camera", data)
    collection.objects.link(obj)
    scene.camera = obj
    return obj


def frameCamera(cam, view: dict, shot: dict, frame: int):
    """Đặt máy quay thật sao cho mặt phẳng sân khấu (Y = 0) hiện đúng khung hình mà bộ máy 2D đã bố cục."""
    lens = lenses.get(shot["size"], 35)
    height = view["height"] * S
    distance = height / 2 * lens / 12
    center = Vector((view["x"] * S, 0, -view["y"] * S))
    if shot["size"] in ("closeUp", "extremeCloseUp", "mediumClose"):
        # Đầu bản 3D to hơn bản 2D (cách điệu): lùi máy và nâng tâm khung một chút để không cắt đỉnh đầu.
        distance *= 1.12
        center.z += height * 0.09
    pitch = 0.0
    if shot.get("angle") == "low":
        pitch = math.atan(0.28 * height / distance)
    if shot.get("angle") == "high":
        pitch = -math.atan(0.28 * height / distance)
    position = center + Vector((0, -distance * math.cos(pitch), -distance * math.sin(pitch)))
    cam.data.lens = lens
    cam.location = position
    cam.rotation_mode = "XYZ"
    cam.rotation_euler = (math.pi / 2 + pitch, view.get("roll", 0), 0)
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = distance
    close = shot["size"] in ("closeUp", "extremeCloseUp", "mediumClose", "overShoulder")
    cam.data.dof.aperture_fstop = 2.0 if close else 5.6 if shot["size"] in ("medium", "twoShot") else 11
    for path in ("location", "rotation_euler", "lens"):
        (cam.data if path == "lens" else cam).keyframe_insert(path, frame=frame)
    cam.data.dof.keyframe_insert("focus_distance", frame=frame)
    cam.data.dof.keyframe_insert("aperture_fstop", frame=frame)
