"""Vật liệu kiểu phim hoạt hình 3D: vật lý ánh sáng thật (path tracing) nhưng màu và độ nhám được cách điệu.

Nguyên lý của các xưởng như DreamWorks/Pixar: hình khối cách điệu + ánh sáng vật lý. Da có tán xạ dưới bề mặt
(ánh sáng xuyên qua tai, má ửng), vải có sheen (lông tơ bắt sáng ở mép), tóc bóng dọc sợi, mắt có lớp giác mạc
bóng để lúc nào cũng có đốm sáng phản chiếu.
"""

import bpy

_cache: dict = {}


def linear(color: str) -> tuple:
    """Mã màu sRGB (#rrggbb) sang màu tuyến tính mà Blender dùng khi tính ánh sáng."""
    color = color.lstrip("#")
    values = [int(color[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    return tuple(value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in values) + (1.0,)


def mix(a: str, b: str, t: float) -> str:
    x = [int(a.lstrip("#")[index:index + 2], 16) for index in (0, 2, 4)]
    y = [int(b.lstrip("#")[index:index + 2], 16) for index in (0, 2, 4)]
    return "#" + "".join(f"{round(p + (q - p) * t):02x}" for p, q in zip(x, y))


def principled(name: str, color: str, roughness=0.5, subsurface=0.0, sheen=0.0, coat=0.0, emission=0.0, emissionColor=None, metallic=0.0, anisotropic=0.0, transmission=0.0, noise=0.0):
    key = (name, color, roughness, subsurface, sheen, coat, emission, emissionColor, metallic, anisotropic, transmission, noise)
    if key in _cache:
        return _cache[key]
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = linear(color)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if subsurface:
        # Burley: tán xạ dưới bề mặt kiểu khuếch tán, nhanh hơn random walk nhiều lần, đủ cho da cách điệu.
        shader.subsurface_method = "BURLEY"
        shader.inputs["Subsurface Weight"].default_value = subsurface
        shader.inputs["Subsurface Radius"].default_value = (1.0, 0.42, 0.25)
        shader.inputs["Subsurface Scale"].default_value = 0.025
    if sheen:
        shader.inputs["Sheen Weight"].default_value = sheen
        shader.inputs["Sheen Roughness"].default_value = 0.4
    if coat:
        shader.inputs["Coat Weight"].default_value = coat
        shader.inputs["Coat Roughness"].default_value = 0.03
    if anisotropic:
        shader.inputs["Anisotropic"].default_value = anisotropic
    if transmission:
        shader.inputs["Transmission Weight"].default_value = transmission
    if emission:
        shader.inputs["Emission Color"].default_value = linear(emissionColor or color)
        shader.inputs["Emission Strength"].default_value = emission
    if noise:
        # Biến thiên màu rất nhẹ theo nhiễu: vải, gỗ, đất không bao giờ phẳng lì một màu.
        texture = nodes.new("ShaderNodeTexNoise")
        texture.inputs["Scale"].default_value = 18.0
        texture.inputs["Detail"].default_value = 6.0
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = linear(mix(color, "#000000", noise))
        ramp.color_ramp.elements[1].color = linear(mix(color, "#ffffff", noise * 0.6))
        links.new(texture.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    _cache[key] = material
    return material


def skin(color: str):
    return principled("skin", color, roughness=0.48, subsurface=0.35, sheen=0.15)


def cloth(color: str, silk=False):
    # Lụa (áo dài) bóng mượt hơn; vải bố/vải bông nhám và có lông tơ bắt sáng.
    return principled("silk" if silk else "cloth", color, roughness=0.32 if silk else 0.82, sheen=0.35 if silk else 0.7, noise=0.04 if silk else 0.1)


def hair(color: str):
    return principled("hair", color, roughness=0.32, anisotropic=0.6, sheen=0.3, coat=0.15)


def mouth():
    """Lòng miệng: dải răng ở trên, lưỡi ở dưới, họng sẫm ở giữa. Toạ độ Generated bám lưới gốc nên khi miệng há,
    các dải giãn theo; miệng khép thì chỉ còn một nét sẫm."""
    if "mouth" in _cache:
        return _cache["mouth"]
    material = bpy.data.materials.new("mouth")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes["Principled BSDF"]
    shader.inputs["Roughness"].default_value = 0.45
    coords = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    elements = ramp.color_ramp.elements
    elements[0].position = 0.0
    elements[0].color = linear("#b5525a")
    elements[1].position = 0.78
    elements[1].color = linear("#f2ece0")
    elements.new(0.3).color = linear("#4a1418")
    links.new(coords.outputs["Generated"], separate.inputs["Vector"])
    links.new(separate.outputs["Z"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    _cache["mouth"] = material
    return material


def eyeWhite():
    return principled("sclera", "#f4f1ec", roughness=0.25, subsurface=0.15, coat=1.0)


def iris(color: str, radius: float):
    """Mống mắt (chỏm cầu, trục nhìn -Y): viền sẫm, vân sáng dần vào trong, con ngươi đen; lớp giác mạc bóng để luôn bắt đốm sáng."""
    key = ("iris", color, radius)
    if key in _cache:
        return _cache[key]
    material = bpy.data.materials.new("iris")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes["Principled BSDF"]
    shader.inputs["Roughness"].default_value = 0.35
    shader.inputs["Coat Weight"].default_value = 1.0
    shader.inputs["Coat Roughness"].default_value = 0.0
    coords = nodes.new("ShaderNodeTexCoord")
    gradient = nodes.new("ShaderNodeTexGradient")
    gradient.gradient_type = "SPHERICAL"
    # Toạ độ vật thể tính bằng mét: chuẩn hoá theo bán kính đĩa để mép đĩa ứng với Fac = 0, tâm = 1.
    mapping = nodes.new("ShaderNodeMapping")
    # Chỉ tính khoảng cách tới trục nhìn (bỏ trục Y), vì mống mắt là chỏm cầu.
    mapping.inputs["Scale"].default_value = (1 / radius, 0.0, 1 / radius)
    links.new(coords.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], gradient.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    elements = ramp.color_ramp.elements
    elements[0].position = 0.0
    elements[0].color = linear(mix(color, "#000000", 0.7))
    elements[1].position = 0.6
    elements[1].color = linear("#040303")
    for position, tone in ((0.1, mix(color, "#000000", 0.25)), (0.4, mix(color, "#f0c890", 0.35)), (0.57, mix(color, "#000000", 0.3))):
        elements.new(position).color = linear(tone)
    links.new(gradient.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    _cache[key] = material
    return material
