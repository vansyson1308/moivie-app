"""Đạo cụ cầm tay 3D: thư viện dựng sẵn (cùng tên với bản 2D) và đạo cụ SVG path đùn thành khối.

Toạ độ đạo cụ giống bản 2D: gốc (0, 0) là điểm tay nắm, x sang phải màn hình, y hướng xuống, đơn vị thế giới.
Trong Blender đạo cụ nằm trong mặt phẳng XZ (đối diện máy quay), Z hướng lên.
"""

import math
import re

import bpy
from mathutils import Vector

import actor as actors
import look


def color(value: str, fallback: str) -> str:
    """Màu CSS (#hex hoặc rgba()) sang #hex; độ trong suốt bỏ qua."""
    if not value:
        return fallback
    if value.startswith("#"):
        return value
    numbers = re.findall(r"[\d.]+", value)
    return "#" + "".join(f"{int(float(n)):02x}" for n in numbers[:3]) if len(numbers) >= 3 else fallback


def polygons(path: str, steps=10) -> list:
    """SVG path sang các đa giác khép kín. Hỗ trợ M L H V C Q Z (tuyệt đối và tương đối).

    ACT: lệnh cung A, S, T được coi như đoạn thẳng tới điểm cuối; đủ cho đạo cụ agent vẽ bằng đoạn thẳng và Bézier.
    """
    tokens = re.findall(r"[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?", path)
    shapes, points = [], []
    x = y = 0.0
    command = "M"
    index = 0
    sizes = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "Q": 4, "S": 4, "T": 2, "A": 7, "Z": 0}

    def close():
        if len(points) > 2:
            shapes.append(list(points))
        points.clear()

    while index < len(tokens):
        if re.match(r"[A-Za-z]", tokens[index]):
            command = tokens[index]
            index += 1
            if command in "Zz":
                close()
                continue
        size = sizes[command.upper()]
        values = [float(v) for v in tokens[index:index + size]]
        index += size
        if len(values) < size:
            break
        relative = command.islower()
        upper = command.upper()
        if upper == "H":
            values = [values[0] + (x if relative else 0), y]
        elif upper == "V":
            values = [x, values[0] + (y if relative else 0)]
        elif relative:
            values = [v + (x if k % 2 == 0 else y) for k, v in enumerate(values)] if upper != "A" else values[:5] + [values[5] + x, values[6] + y]
        if upper == "M":
            close()
            x, y = values
            points.append((x, y))
            command = "l" if relative else "L"
            continue
        if upper == "C":
            x0, y0 = x, y
            for step in range(1, steps + 1):
                t = step / steps
                a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                points.append((a * x0 + b * values[0] + c * values[2] + d * values[4], a * y0 + b * values[1] + c * values[3] + d * values[5]))
        elif upper == "Q":
            x0, y0 = x, y
            for step in range(1, steps + 1):
                t = step / steps
                a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
                points.append((a * x0 + b * values[0] + c * values[2], a * y0 + b * values[1] + c * values[3]))
        else:
            points.append((values[-2], values[-1]))
        x, y = values[-2], values[-1]
    close()
    return shapes


def custom(name: str, spec: dict, collection):
    """Đạo cụ agent tự vẽ: đùn SVG path thành tấm dày bo mép, phát sáng thật nếu có glow.

    ACT: hình con thuôn dài (tỉ lệ cạnh > 5) coi là cán/que, làm bằng tre và không phát sáng; phần còn lại theo màu fill.
    """
    scale = spec.get("scale", 1.0) * actors.S
    angle = spec.get("angle", 0.0)
    shapes = polygons(spec["path"])
    points = [point for shape in shapes for point in shape]
    size = max((max(abs(px), abs(py)) for px, py in points), default=40) * scale

    def thin(shape):
        xs, ys = [px for px, _ in shape], [py for _, py in shape]
        a, b = max(xs) - min(xs), max(ys) - min(ys)
        return max(a, b) > 5 * max(1e-6, min(a, b))

    glow = spec.get("glow")
    fill = spec.get("fill", "#cccccc")
    body = look.principled("prop", fill, roughness=0.45, sheen=0.2, emission=0.9 if glow else 0.0, emissionColor=color(glow, fill) if glow else None, transmission=0.1 if glow else 0.0)
    stick = look.principled("propStick", "#a07a4f", roughness=0.6, noise=0.2)
    objects = []
    for material, shapesOf in ((stick, [shape for shape in shapes if thin(shape)]), (body, [shape for shape in shapes if not thin(shape)])):
        if not shapesOf:
            continue
        curve = bpy.data.curves.new(name, "CURVE")
        curve.dimensions = "2D"
        curve.fill_mode = "BOTH"
        curve.extrude = max(0.004, size * 0.06)
        curve.bevel_depth = max(0.002, size * 0.025)
        curve.bevel_resolution = 3
        for shape in shapesOf:
            spline = curve.splines.new("POLY")
            spline.points.add(len(shape) - 1)
            for point, (px, py) in zip(spline.points, shape):
                rx = px * math.cos(angle) - py * math.sin(angle)
                ry = px * math.sin(angle) + py * math.cos(angle)
                point.co = (rx * scale, -ry * scale, 0, 1)
            spline.use_cyclic_u = True
        obj = bpy.data.objects.new(name, curve)
        collection.objects.link(obj)
        obj.rotation_euler = (math.pi / 2, 0, 0)
        obj.data.materials.append(material)
        objects.append(obj)
    root = group(name, collection, objects)
    lit = [point for shape in shapes if not thin(shape) for point in shape]
    if glow and lit:
        xs, ys = [px for px, _ in lit], [py for _, py in lit]
        # Nguồn sáng đặt trước mặt đạo cụ (phía máy quay) để không bị chính khối đạo cụ che.
        center = Vector(((min(xs) + max(xs)) / 2 * scale, -size * 0.25, -(min(ys) + max(ys)) / 2 * scale))
        glowLight(root, collection, color(glow, fill), center, size)
    return root


def group(name: str, collection, children: list):
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    for child in children:
        child.parent = root
    return root


def glowLight(root, collection, tone: str, at: Vector, size: float):
    """Nguồn sáng thật trong đạo cụ phát sáng: soi lên mặt và tay nhân vật cầm nó."""
    light = bpy.data.lights.new(root.name + "Glow", "POINT")
    light.energy = 8
    light.color = look.linear(look.mix(tone, "#ffffff", 0.2))[:3]
    light.shadow_soft_size = max(0.03, size * 0.4)
    lamp = bpy.data.objects.new(root.name + "Glow", light)
    collection.objects.link(lamp)
    lamp.parent = root
    lamp.location = at


def part(obj, material, location=(0, 0, 0), rotation=(0, 0, 0)):
    obj.location = location
    obj.rotation_euler = rotation
    return actors.finish(obj, material, levels=1)


def box(name, size, collection):
    bpy.ops.mesh.primitive_cube_add()
    obj = bpy.context.object
    for user in list(obj.users_collection):
        user.objects.unlink(obj)
    collection.objects.link(obj)
    obj.name = name
    for vertex in obj.data.vertices:
        vertex.co = Vector((vertex.co.x * size[0] / 2, vertex.co.y * size[1] / 2, vertex.co.z * size[2] / 2))
    obj.modifiers.new("bevel", "BEVEL").width = min(size) * 0.2
    return obj


def builtIn(name: str, kind: str, collection):
    """Thư viện đạo cụ dựng sẵn, kích thước và điểm nắm khớp với bản 2D (đơn vị thế giới, y xuống)."""
    w = lambda v: v * actors.S
    at = lambda x, y, z=0.0: (w(x), w(z), -w(y))
    wood = look.principled("wood", "#8a6440", roughness=0.6, noise=0.25)
    paper = look.principled("paper", "#f5efe0", roughness=0.8)
    parts = []
    glow = None
    if kind == "lantern":
        parts.append(part(actors.capsule(name + "String", w(20), w(0.8), w(0.8), collection), look.principled("string", "#2b2522"), at(0, 20), (math.pi, 0, 0)))
        parts.append(part(actors.ellipsoid(name + "Body", (w(17), w(17), w(23)), collection, 20), look.principled("lanternPaper", "#e74c3c", roughness=0.6, emission=5.0, emissionColor="#ffb070", transmission=0.2), at(0, 42)))
        glow = ("#ffb070", Vector(at(0, 42)), w(30))
    elif kind in ("stick", "oar"):
        top, bottom = (-20, 150) if kind == "stick" else (-30, 220)
        parts.append(part(actors.capsule(name + "Shaft", w(bottom - top), w(3.5), w(3.5), collection), wood, at(0, top), (math.pi, 0, 0)))
        if kind == "oar":
            parts.append(part(actors.ellipsoid(name + "Blade", (w(13), w(3), w(36)), collection, 16), wood, at(0, 235)))
    elif kind == "letter":
        parts.append(part(box(name + "Sheet", (w(34), w(1), w(24)), collection), paper, at(11, 10)))
    elif kind == "book":
        parts.append(part(box(name + "Cover", (w(30), w(7), w(38)), collection), look.principled("book", "#2e6f95", roughness=0.5), at(11, 13)))
    elif kind == "phone":
        parts.append(part(box(name + "Body", (w(16), w(2.5), w(28)), collection), look.principled("phone", "#2c3e50", roughness=0.2, coat=0.8), at(6, -12)))
    elif kind == "cup":
        parts.append(part(actors.capsule(name + "Cup", w(20), w(10), w(11), collection), look.principled("ceramic", "#f1ead8", roughness=0.25, coat=0.6), at(8, 2)))
    elif kind == "bowl":
        parts.append(part(actors.ellipsoid(name + "Bowl", (w(18), w(18), w(10)), collection, 20), look.principled("ceramic", "#f1ead8", roughness=0.25, coat=0.6), at(10, -6)))
    elif kind == "flower":
        parts.append(part(actors.capsule(name + "Stem", w(55), w(1.5), w(1.5), collection), look.principled("stem", "#4f8a3c"), at(0, 0)))
        for petal in range(6):
            a = petal / 6 * math.pi * 2
            parts.append(part(actors.ellipsoid(name + "Petal", (w(7), w(2), w(5)), collection, 12), look.principled("petal", "#f4a7b9", roughness=0.5, subsurface=0.3), at(4 + math.cos(a) * 9, -60 + math.sin(a) * 9), (0, -a, 0)))
        parts.append(part(actors.ellipsoid(name + "Heart", (w(5), w(3), w(5)), collection, 12), look.principled("pollen", "#f7d154"), at(4, -60)))
    elif kind == "umbrella":
        parts.append(part(actors.capsule(name + "Shaft", w(150), w(2), w(2), collection), look.principled("handle", "#5d4037"), at(0, 0)))
        canopy = actors.ellipsoid(name + "Canopy", (w(90), w(90), w(45)), collection, 24)
        parts.append(part(canopy, look.principled("canopy", "#c0392b", roughness=0.5, sheen=0.3), at(0, -140)))
    elif kind == "fan":
        parts.append(part(actors.ellipsoid(name + "Leaf", (w(45), w(1.5), w(30)), collection, 20), look.principled("fanPaper", "#e8c07a", roughness=0.7), at(0, -25)))
    elif kind in ("basket", "bag"):
        tone = "#c49a5a" if kind == "basket" else "#8e5b3a"
        parts.append(part(box(name + "Body", (w(46), w(30), w(34)), collection), look.principled(kind, tone, roughness=0.8, noise=0.3), at(1, 30)))
        handle = actors.capsule(name + "Handle", w(40), w(2.5), w(2.5), collection)
        parts.append(part(handle, look.principled(kind, tone, roughness=0.8, noise=0.3), at(-19, 12), (0, math.pi / 2, 0)))
    else:
        return None
    root = group(name, collection, parts)
    if glow:
        glowLight(root, collection, glow[0], glow[1], glow[2])
    return root


def build(name: str, kind: str, specs: dict, collection):
    return custom(name, specs[kind], collection) if kind in specs else builtIn(name, kind, collection)
