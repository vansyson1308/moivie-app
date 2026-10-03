"""Diễn viên 3D dựng thủ tục từ hồ sơ nhân vật (cùng hồ sơ mà bộ vẽ 2D dùng).

Thiết kế theo nguyên lý hoạt hình 3D cách điệu (DreamWorks, Pixar):
- Hình khối tròn mềm, đầu to, mắt to để biểu cảm đọc được từ xa; trẻ em tròn hơn, người già gầy và còng hơn.
- Mỗi bộ phận là một khối bo tròn (subdivision) nối nhau ở khớp như đất nặn; vải phủ ngoài da.
- Diễn xuất không tính lại ở đây: khung xương, góc quay, biểu cảm, khẩu hình đều lấy nguyên từ bộ máy TypeScript.

Quy ước toạ độ: hệ thân của bộ máy 2D là x (trái nhân vật), y (xuống), z (trước mặt), đơn vị thế giới.
Trong Blender, gốc nhân vật đặt dưới chân, X là trái nhân vật, -Y là trước mặt, Z hướng lên, đơn vị mét.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

import look
import props as propKit

S = 0.005  # mét trên một đơn vị thế giới: người lớn cao khoảng 340 đơn vị ≈ 1,7 m
eyeSides = (("left", 0.37), ("right", -0.37))
# Cách điệu kiểu phim hoạt hình 3D: đầu to hơn và tay chân mập hơn tỉ lệ thật để dáng đọc rõ, dễ thương.
headScale = {"child": 1.16, "adult": 1.2, "elder": 1.18}
limbScale = 1.3


def local(p) -> Vector:
    """Điểm trong hệ thân (x trái, y xuống, z trước) sang toạ độ Blender của gốc nhân vật."""
    return Vector((p[0] * S, -p[2] * S, -p[1] * S))


def axes(left, down, forward) -> Matrix:
    """Ma trận quay từ ba trục của hệ thân (đã xoay/cúi) sang hệ Blender: X trái, Y sau lưng, Z lên."""
    x = local(left).normalized()
    y = -local(forward).normalized()
    z = -local(down).normalized()
    return Matrix((x, y, z)).transposed()


def finish(obj, material, levels=2, smooth=True):
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if levels:
        modifier = obj.modifiers.new("smooth", "SUBSURF")
        modifier.levels = levels
        modifier.render_levels = levels
    obj.data.materials.append(material)
    return obj


def link(obj, collection):
    collection.objects.link(obj)
    return obj


def loft(name: str, rings: list, collection, cap=True):
    """Khối tròn xoay tự do: mỗi vòng là (tâm x, y, z, bán kính ngang, bán kính sâu); vòng xếp theo thứ tự dọc trục."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    segments = 20
    loops = []
    for cx, cy, cz, rx, ry in rings:
        loops.append([bm.verts.new((cx + rx * math.cos(2 * math.pi * k / segments), cy + ry * math.sin(2 * math.pi * k / segments), cz)) for k in range(segments)])
    for a, b in zip(loops, loops[1:]):
        for k in range(segments):
            bm.faces.new((a[k], a[(k + 1) % segments], b[(k + 1) % segments], b[k]))
    if cap:
        bm.faces.new(list(reversed(loops[0])))
        bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    return link(bpy.data.objects.new(name, mesh), collection)


def capsule(name: str, length: float, r0: float, r1: float, collection, flatten=1.0):
    """Khối thuôn dọc trục +Z từ 0 tới length, hai đầu tròn bán kính r0, r1 (cánh tay, đùi, ngón tay)."""
    rings = []
    for k in range(5):
        a = math.pi / 2 * (1 - k / 4)
        rings.append((0, 0, -r0 * math.sin(a), r0 * math.cos(a) + 1e-4, r0 * math.cos(a) * flatten + 1e-4))
    for k in range(1, 4):
        t = k / 4
        r = r0 + (r1 - r0) * t
        rings.append((0, 0, length * t, r, r * flatten))
    for k in range(5):
        a = math.pi / 2 * k / 4
        rings.append((0, 0, length + r1 * math.sin(a), r1 * math.cos(a) + 1e-4, r1 * math.cos(a) * flatten + 1e-4))
    return loft(name, rings, collection)


def ellipsoid(name: str, radii, collection, segments=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=segments // 2)
    obj = bpy.context.object
    for user in list(obj.users_collection):
        user.objects.unlink(obj)
    collection.objects.link(obj)
    obj.name = name
    for vertex in obj.data.vertices:
        vertex.co = Vector((vertex.co.x * radii[0], vertex.co.y * radii[1], vertex.co.z * radii[2]))
    return obj


def hairline(style: str, u: float) -> float:
    """Đường chân tóc theo kinh độ u (giống bộ vẽ 2D): cao ở trán, thấp dần ra gáy."""
    settings = {
        "short": (0.6, 0.22, -0.42), "sidePart": (0.58, 0.2, -0.42), "long": (0.4, -0.08, -0.95), "bun": (0.45, 0.2, -0.4),
        "ponytail": (0.45, 0.2, -0.4), "bald": (2, 2, 2), "curly": (0.5, 0.16, -0.45), "bob": (0.24, -0.55, -0.7),
    }
    front, side, back = settings[style]
    c = math.cos(u)
    v = side + (front - side) * c if c >= 0 else side + (back - side) * -c
    if style == "sidePart":
        v -= max(0, math.sin(u)) * 0.18 * max(0, c)
    return v


def headPoint(rx, ry, rz, u, v, lift=1.0) -> Vector:
    """Điểm trên mặt elip của đầu: u kinh độ (0 giữa mặt), v vĩ độ (+ lên). Mặt nhìn về -Y."""
    return Vector((rx * math.sin(u) * math.cos(v) * lift, -rz * math.cos(u) * math.cos(v) * lift, ry * math.sin(v) * lift))


class Actor:
    def __init__(self, character: dict, faces: dict, props: dict, collection):
        self.c = character
        self.faces = faces
        self.props = props
        self.body = character["body"]
        self.collection = collection
        self.parts: dict = {}
        self.hands: dict = {}
        self.held: dict = {}
        self.stool = None
        self.build()

    # ---------- Dựng hình ----------

    def build(self):
        c, b = self.c, self.body
        outfit = c["outfit"]
        style = outfit["style"]
        child = c["age"] == "child"
        skinMaterial = look.skin(c["skin"])
        top = look.cloth(outfit["top"], silk=style == "aoDai")
        bottom = look.cloth(outfit["bottom"], silk=style == "aoDai")
        self.skinMaterial = skinMaterial
        legMaterial = skinMaterial if style == "dress" else bottom
        shortSleeve = style == "shirt" and c["age"] != "elder"
        loose = style == "aoBaBa"

        # Thân: các vòng elip từ hông lên vai, mô hình trong hệ thân với gốc ở hông, Z hướng lên.
        hip, shoulder, neck = b["hipY"], b["shoulderY"], b["neckY"]
        female = c["gender"] == "female"
        up = lambda y: (hip - y) * S
        chest = b["chestDepth"] * (1.12 if female else 1.02)
        widen = 1.12 if loose else 1.0
        rings = [
            (0, 0, up(hip + b["legRadius"] * 0.9), b["hipHalf"] * 0.8 * S, chest * 0.8 * S),
            (0, 0, up(hip), b["hipHalf"] * 1.04 * widen * S, b["chestDepth"] * 0.95 * S),
            (0, 0, up(shoulder + (hip - shoulder) * 0.68), b["waistHalf"] * widen * S, b["chestDepth"] * 0.88 * S),
            (0, -b["chestDepth"] * 0.05 * S, up(shoulder + (hip - shoulder) * 0.32), b["shoulderHalf"] * 0.94 * widen * S, chest * S),
            (0, 0, up(shoulder + b["armRadius"] * 0.3), b["shoulderHalf"] * 0.98 * S, b["chestDepth"] * 0.8 * S),
            (0, 0, up(shoulder - b["armRadius"] * 0.9), b["shoulderHalf"] * 0.62 * S, b["chestDepth"] * 0.55 * S),
            (0, 0, up(neck + (shoulder - neck) * 0.2), b["rx"] * 0.4 * S, b["rx"] * 0.36 * S),
        ]
        self.parts["torso"] = finish(loft(f"{c['id']}Torso", rings, self.collection), top)
        if style in ("aoDai", "robe", "dress"):
            # Tà áo dài / váy: khối loe từ eo xuống, tách hai tà trước sau với áo dài (xẻ tà hai bên).
            lengthTo = b["thigh"] * (0.9 if style == "dress" else 1.6 if style == "aoDai" else 1.85)
            flare = 1.05 if style == "aoDai" else 1.45
            skirt = [
                (0, 0, up(shoulder + (hip - shoulder) * 0.7), b["waistHalf"] * 1.02 * S, b["chestDepth"] * 0.9 * S),
                (0, 0, up(hip), b["hipHalf"] * 1.12 * S, b["chestDepth"] * 1.0 * S),
                (0, 0, up(hip) - lengthTo * 0.5 * S, b["hipHalf"] * 1.12 * flare * S, b["chestDepth"] * 1.05 * flare * S),
                (0, 0, up(hip) - lengthTo * S, b["hipHalf"] * 1.18 * flare * S, b["chestDepth"] * 1.1 * flare * S),
            ]
            obj = loft(f"{c['id']}Skirt", skirt, self.collection, cap=False)
            if style == "aoDai":
                # Xẻ tà: bỏ các mặt hai bên hông phía dưới eo để thấy quần.
                bm = bmesh.new()
                bm.from_mesh(obj.data)
                cut = [face for face in bm.faces if face.calc_center_median().z < up(hip) + 0.02 and abs(face.calc_center_median().x) > b["hipHalf"] * 0.95 * S]
                bmesh.ops.delete(bm, geom=cut, context="FACES")
                bm.to_mesh(obj.data)
                bm.free()
                solid = obj.modifiers.new("thick", "SOLIDIFY")
                solid.thickness = 0.006
            self.parts["skirt"] = finish(obj, top, levels=2)
            # Dáng ngồi: phần dưới hông vắt về phía trước theo đùi và nâng gấu lên ngang gối.
            obj.shape_key_add(name="Basis")
            sit = obj.shape_key_add(name="sit")
            for index, vertex in enumerate(obj.data.vertices):
                depth = max(0.0, up(hip) - vertex.co.z)
                sit.data[index].co = Vector((vertex.co.x, vertex.co.y - depth * (0.85 if vertex.co.y < 0 else 0.35), vertex.co.z + depth * 0.62))
        if style == "aoDai":
            collar = loft(f"{c['id']}Collar", [(0, 0, up(neck + (shoulder - neck) * 0.4), b["rx"] * 0.48 * S, b["rx"] * 0.44 * S), (0, 0, up(neck) + 0.02, b["rx"] * 0.42 * S, b["rx"] * 0.4 * S)], self.collection, cap=False)
            collar.modifiers.new("thick", "SOLIDIFY").thickness = 0.005
            self.parts["collar"] = finish(collar, top, levels=1)
        self.torsoParts = [name for name in ("torso", "skirt", "collar") if name in self.parts]

        # Cổ.
        self.parts["neck"] = finish(capsule(f"{c['id']}Neck", 0.05, b["rx"] * (0.36 if female else 0.42) * S, b["rx"] * 0.33 * S, self.collection), skinMaterial, levels=1)

        # Tay, chân: khối thuôn; tay áo ngắn thì cẳng tay và nửa dưới bắp tay là da.
        armR = b["armRadius"] * limbScale * (1.12 if loose or style in ("aoDai", "robe") else 1.0)
        for side in ("left", "right"):
            self.parts[f"{side}Upper"] = finish(capsule(f"{c['id']}{side}Upper", b["upperArm"] * S, armR * S, armR * 0.88 * S, self.collection), skinMaterial if shortSleeve else top)
            self.parts[f"{side}Fore"] = finish(capsule(f"{c['id']}{side}Fore", b["forearm"] * S, armR * 0.86 * S, armR * 0.72 * S, self.collection), skinMaterial if shortSleeve else top)
            if shortSleeve:
                self.parts[f"{side}Sleeve"] = finish(capsule(f"{c['id']}{side}Sleeve", b["upperArm"] * 0.5 * S, armR * 1.2 * S, armR * 1.12 * S, self.collection), top)
            legR = b["legRadius"] * limbScale * (1.2 if loose or style == "aoDai" else 1.0)
            self.parts[f"{side}Thigh"] = finish(capsule(f"{c['id']}{side}Thigh", b["thigh"] * S, legR * 1.12 * S, legR * 0.9 * S, self.collection), legMaterial)
            self.parts[f"{side}Shin"] = finish(capsule(f"{c['id']}{side}Shin", b["shin"] * S, legR * 0.9 * S, legR * (0.92 if loose else 0.72) * S, self.collection), legMaterial)
            self.parts[f"{side}Foot"] = finish(capsule(f"{c['id']}{side}Foot", b["foot"] * 0.85 * S, b["legRadius"] * 0.62 * S, b["legRadius"] * 0.66 * S, self.collection, flatten=0.62), look.principled("shoe", outfit["shoes"], roughness=0.55, coat=0.2))
            self.hands[side] = {}

        self.buildHead()

    def hand(self, side: str, shape: str):
        """Bàn tay theo dáng (thả lỏng, nắm, xoè, chỉ, cầm, vẫy): lòng bàn tay dẹt và bốn ngón khép, ngón cái tách."""
        if shape in self.hands[side]:
            return self.hands[side][shape]
        b = self.body
        palm = b["palm"] * S * 1.2
        name = f"{self.c['id']}{side}Hand{shape}"
        root = bpy.data.objects.new(name, None)
        self.collection.objects.link(root)
        curls = {"relaxed": [0.35, 0.4, 0.45, 0.5], "fist": [1.4, 1.45, 1.5, 1.55], "open": [0.05] * 4, "point": [0.0, 1.4, 1.45, 1.5], "grip": [1.0] * 4, "wave": [0.0] * 4}[shape]
        spread = 0.22 if shape in ("open", "wave") else 0.06
        sign = 1 if side == "left" else -1
        meat = ellipsoid(name + "Palm", (palm * 0.42, palm * 0.2, palm * 0.5), self.collection, segments=16)
        meat.parent = root
        meat.location = (0, 0, -palm * 0.45)
        finish(meat, self.skinMaterial, levels=1)
        for index, curl in enumerate(curls):
            length = palm * (0.5 if index == 3 else 0.62)
            finger = capsule(f"{name}F{index}", length, palm * 0.11, palm * 0.095, self.collection)
            finish(finger, self.skinMaterial, levels=1)
            finger.parent = root
            offset = (index - 1.5) * palm * 0.2 * sign
            finger.location = (offset, 0, -palm * 0.85)
            # Ngón tay chĩa xuống (-Z) rồi gập về phía lòng bàn tay (-Y là phía trước của tay thả xuôi).
            finger.rotation_euler = (math.pi + curl, (index - 1.5) * spread * sign, 0)
        thumb = capsule(f"{name}Thumb", palm * 0.42, palm * 0.12, palm * 0.1, self.collection)
        finish(thumb, self.skinMaterial, levels=1)
        thumb.parent = root
        thumb.location = (-sign * palm * 0.3, -palm * 0.1, -palm * 0.35)
        thumb.rotation_euler = (math.pi + (1.2 if shape in ("fist", "grip") else 0.5), -sign * (0.4 if shape in ("open", "wave") else 0.7), 0)
        self.hands[side][shape] = root
        return root

    def buildHead(self):
        c, b = self.c, self.body
        rx, ry, rz = b["rx"] * S, b["ry"] * S, b["rz"] * S
        child = c["age"] == "child"
        name = c["id"]
        self.head = bpy.data.objects.new(name + "Head", None)
        self.collection.objects.link(self.head)

        def attach(obj):
            obj.parent = self.head
            return obj

        # Hộp sọ: elip, hàm thu nhỏ về cằm, má đầy (trẻ con tròn hơn), mặt hơi phẳng.
        skull = ellipsoid(name + "Skull", (rx, rz, ry), self.collection, segments=32)
        for vertex in skull.data.vertices:
            co = vertex.co
            below = max(0.0, -co.z / ry)
            front = max(0.0, -co.y / rz)
            narrow = 1 - 0.22 * below ** 1.6 * (0.6 if child else 1.0)
            co.x *= narrow
            co.y *= 1 - 0.12 * below ** 2
            co.z -= 0.08 * ry * below ** 2 * front
            if child:
                co.z *= 1 - 0.12 * below
                co.x *= 1 + 0.06 * below * (1 - below)
            co.y -= 0.03 * rz * front * (1 - abs(co.x) / rx)
        attach(finish(skull, self.skinMaterial, levels=2))
        self.skull = skull

        # Mắt to: nhãn cầu trắng, mống mắt là đĩa phủ trên mặt trước, xoay theo hướng nhìn.
        eyeR = rx * (0.3 if child else 0.26)
        # Trẻ con: nét mặt dồn thấp, trán cao, cằm ngắn (tỉ lệ "baby schema" khiến nhân vật đáng yêu).
        eyeV = -0.1 if child else -0.02
        self.eyes = []
        self.lids = []
        lash = look.principled("lash", "#1a1210", roughness=0.5)
        for side, u in eyeSides:
            center = headPoint(rx, ry, rz, u, eyeV) * 0.82
            pivot = bpy.data.objects.new(f"{name}{side}Eye", None)
            self.collection.objects.link(pivot)
            attach(pivot)
            pivot.location = center
            ball = ellipsoid(f"{name}{side}Ball", (eyeR, eyeR, eyeR * 1.06), self.collection, segments=24)
            ball.parent = pivot
            finish(ball, look.eyeWhite(), levels=1)
            # Mống mắt là chỏm cầu ôm sát nhãn cầu (không phải đĩa phẳng) để mí mắt trượt qua không bị xuyên.
            irisR = eyeR * 0.62
            disc = ellipsoid(f"{name}{side}Iris", (eyeR * 1.012, eyeR * 1.012, eyeR * 1.072), self.collection, segments=48)
            bm = bmesh.new()
            bm.from_mesh(disc.data)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if math.hypot(v.co.x, v.co.z) > irisR * 1.05 or v.co.y > 0], context="VERTS")
            bm.to_mesh(disc.data)
            bm.free()
            disc.parent = pivot
            finish(disc, look.iris(c["eyes"], irisR), levels=1)
            self.eyes.append((pivot, u))
            # Mí trên và mí dưới: vỏ bán cầu màu da, xoay quanh trục ngang để nhắm/mở và tạo biểu cảm.
            for which in ("upper", "lower"):
                lid = ellipsoid(f"{name}{side}{which}Lid", (eyeR * 1.05, eyeR * 1.05, eyeR * 1.1), self.collection, segments=32)
                bm = bmesh.new()
                bm.from_mesh(lid.data)
                keep = (lambda v: v.co.z > 0) if which == "upper" else (lambda v: v.co.z < -eyeR * 0.45)
                bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v)], context="VERTS")
                bm.to_mesh(lid.data)
                bm.free()
                thick = lid.modifiers.new("thick", "SOLIDIFY")
                thick.thickness = eyeR * 0.1
                thick.offset = 1.0
                finish(lid, self.skinMaterial, levels=1)
                if which == "upper":
                    # Viền mi: dải sẫm ở mép mí trên, thay cho nét kẻ mắt của bản 2D để mắt đọc được từ xa.
                    lid.data.materials.append(lash)
                    edge = eyeR * (0.22 if c["gender"] == "female" else 0.12)
                    for polygon in lid.data.polygons:
                        if min(lid.data.vertices[index].co.z for index in polygon.vertices) < edge:
                            polygon.material_index = 1
                lid.parent = pivot
                self.lids.append((lid, which, side))
            # Chân mày: thanh cong thuôn.
            brow = capsule(f"{name}{side}Brow", eyeR * 1.35, eyeR * 0.2, eyeR * 0.12, self.collection, flatten=0.55)
            finish(brow, look.hair(c["hair"]["color"] if c["hair"]["style"] != "bald" else "#8a8580"), levels=1)
            attach(brow)
            self.parts[f"{side}Brow"] = brow

        # Mũi tròn nhỏ, tai.
        nose = ellipsoid(name + "Nose", (rx * 0.12, rx * 0.12, ry * 0.14), self.collection, segments=16)
        nose.location = headPoint(rx, ry, rz, 0, -0.3 if child else -0.26) * 0.98
        attach(finish(nose, self.skinMaterial, levels=1))
        if hairline(c["hair"]["style"], math.pi / 2) >= -0.05:
            for u in (math.pi / 2, -math.pi / 2):
                ear = ellipsoid(name + "Ear", (rx * 0.09, rx * 0.16, ry * 0.24), self.collection, segments=16)
                ear.location = headPoint(rx, ry, rz, u, -0.05) * 0.98
                attach(finish(ear, self.skinMaterial, levels=1))

        # Miệng: đĩa elip nằm trên mặt, đổi dáng bằng shape key (mở, rộng, tròn, cười, mếu).
        mouth = ellipsoid(name + "Mouth", (rx * 0.28, rz * 0.06, ry * 0.12), self.collection, segments=24)
        mouth.location = headPoint(rx, ry, rz, 0, -0.5 if child else -0.52) * 0.96

        def hug(x, z):
            # Độ lùi của mặt elip của đầu tại điểm (x, z) quanh miệng: miệng há rộng vẫn dán theo mặt, không chĩa ra trước.
            px, pz = (mouth.location.x + x) / rx, (mouth.location.z + z) / ry
            return rz * (1 - math.sqrt(max(0.05, 1 - px * px - pz * pz))) * 0.96

        for vertex in mouth.data.vertices:
            vertex.co.y += hug(vertex.co.x, vertex.co.z) - hug(0, 0)
        attach(finish(mouth, look.mouth(), levels=1))
        mouth.shape_key_add(name="Basis")
        for key in ("open", "wide", "round", "smile", "frown", "closed"):
            block = mouth.shape_key_add(name=key)
            for index, vertex in enumerate(mouth.data.vertices):
                x, y, z = vertex.co
                dx, dz = 0.0, 0.0
                if key == "open":
                    dz = z * 1.7 + (-abs(z) * 0.5 if z < 0 else 0)
                elif key == "wide":
                    dx = x * 0.35
                elif key == "round":
                    dx = -x * 0.45
                    dz = z * 0.8
                elif key == "smile":
                    dz = (x / (rx * 0.28)) ** 2 * ry * 0.16
                elif key == "frown":
                    dz = -(x / (rx * 0.28)) ** 2 * ry * 0.12
                elif key == "closed":
                    dz = -z * 0.85
                block.data[index].co = Vector((x + dx, y + hug(x + dx, z + dz) - hug(x, z), z + dz))
        self.mouth = mouth

        self.buildHair()
        self.buildExtras(eyeR, eyeV)

    def buildExtras(self, eyeR: float, eyeV: float):
        """Nước mắt, kính, râu, mũ: các chi tiết nhận diện mà bản 2D cũng có."""
        c, b = self.c, self.body
        rx, ry, rz = b["rx"] * S, b["ry"] * S, b["rz"] * S
        name = c["id"]
        water = look.principled("tear", "#cfe8ff", roughness=0.02, transmission=1.0, coat=1.0)
        self.tears = []
        for u in (0.37, -0.37):
            drop = ellipsoid(name + "Tear", (eyeR * 0.22, eyeR * 0.16, eyeR * 0.34), self.collection, segments=12)
            drop.location = headPoint(rx, ry, rz, u * 0.95, eyeV - 0.28, 1.01)
            finish(drop, water, levels=1).parent = self.head
            self.tears.append(drop)
        if c.get("glasses"):
            frame = look.principled("glassesFrame", "#2b2522", roughness=0.3, coat=0.5)
            parts = []
            for side, u in eyeSides:
                bpy.ops.mesh.primitive_torus_add(major_radius=eyeR * 1.35, minor_radius=eyeR * 0.1, major_segments=32, minor_segments=8)
                ring = bpy.context.object
                for user in list(ring.users_collection):
                    user.objects.unlink(ring)
                self.collection.objects.link(ring)
                ring.location = headPoint(rx, ry, rz, u, eyeV, 1.0) + Vector((0, -eyeR * 0.5, 0))
                ring.rotation_euler = (math.pi / 2, 0, 0)
                parts.append(finish(ring, frame, levels=0))
            bridge = capsule(name + "Bridge", rx * 0.2, eyeR * 0.08, eyeR * 0.08, self.collection)
            bridge.location = headPoint(rx, ry, rz, 0.12, eyeV + 0.05, 1.04)
            bridge.rotation_euler = (0, -math.pi / 2, 0)
            parts.append(finish(bridge, frame, levels=0))
            for part in parts:
                part.parent = self.head
        beard = c.get("beard", "none")
        if beard != "none":
            material = look.hair(c["hair"]["color"])
            if beard in ("full", "goatee"):
                shell = ellipsoid(name + "Beard", (rx * 1.04, rz * 1.06, ry * 1.04), self.collection, segments=32)
                bm = bmesh.new()
                bm.from_mesh(shell.data)
                wide = 0.9 if beard == "full" else 0.28
                drop = []
                for vertex in bm.verts:
                    u = math.atan2(vertex.co.x, -vertex.co.y)
                    v = math.asin(max(-1.0, min(1.0, vertex.co.z / (ry * 1.04))))
                    if abs(u) > wide * math.pi / 2 or v > (-0.42 if beard == "full" else -0.62):
                        drop.append(vertex)
                bmesh.ops.delete(bm, geom=drop, context="VERTS")
                bm.to_mesh(shell.data)
                bm.free()
                shell.modifiers.new("thick", "SOLIDIFY").thickness = rx * 0.1
                finish(shell, material, levels=2).parent = self.head
            for sign in (1, -1):
                whisker = capsule(name + "Mustache", rx * 0.28, ry * 0.07, ry * 0.035, self.collection, flatten=0.6)
                whisker.location = headPoint(rx, ry, rz, sign * 0.05, -0.4, 1.03)
                whisker.rotation_euler = (0, sign * (math.pi / 2 + 0.35), 0)
                finish(whisker, material, levels=1).parent = self.head
        hat = c.get("hat", "none")
        if hat in ("cap", "beret", "khanDong"):
            material = look.cloth(c.get("hatColor", "#e3cc8c"))
            if hat == "khanDong":
                bpy.ops.mesh.primitive_torus_add(major_radius=rx * 1.0, minor_radius=ry * 0.2, major_segments=40, minor_segments=12)
                piece = bpy.context.object
                for user in list(piece.users_collection):
                    user.objects.unlink(piece)
                self.collection.objects.link(piece)
                piece.scale = (1, rz / rx, 1)
                piece.location = (0, 0, ry * 0.55)
            else:
                piece = ellipsoid(name + "Hat", (rx * 1.12, rz * 1.12, ry * (0.75 if hat == "cap" else 0.45)), self.collection, segments=32)
                bm = bmesh.new()
                bm.from_mesh(piece.data)
                bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -ry * 0.05], context="VERTS")
                bm.to_mesh(piece.data)
                bm.free()
                piece.location = (rx * (0.1 if hat == "beret" else 0), 0, ry * 0.42)
                piece.rotation_euler = (0, 0.2 if hat == "beret" else 0, 0)
                if hat == "cap":
                    brim = ellipsoid(name + "Brim", (rx * 0.8, rz * 0.7, ry * 0.04), self.collection, segments=24)
                    brim.location = (0, -rz * 0.9, ry * 0.45)
                    finish(brim, material, levels=1).parent = self.head
            finish(piece, material, levels=1).parent = self.head

    def holdProp(self, side: str, kind: str):
        key = (side, kind)
        if key not in self.held:
            self.held[key] = propKit.build(f"{self.c['id']}{side}{kind}", kind, self.props, self.collection)
        return self.held[key]

    def buildStool(self, top: float):
        """Ghế đẩu gỗ dưới hông khi ngồi (giống bản 2D). ACT: chiều cao lấy theo khung ngồi đầu tiên; đủ vì hông không đổi khi đã ngồi."""
        b = self.body
        half = b["hipHalf"] * 1.25 * S
        wood = look.principled("stool", "#8a6440", roughness=0.6, noise=0.25)
        root = bpy.data.objects.new(self.c["id"] + "Stool", None)
        self.collection.objects.link(root)
        plank = loft(self.c["id"] + "Plank", [(0, 0, top - 0.035, half, half * 0.8), (0, 0, top, half, half * 0.8)], self.collection)
        finish(plank, wood, levels=1).parent = root
        for x, y in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            leg = capsule(self.c["id"] + "StoolLeg", top - 0.04, 0.014, 0.012, self.collection)
            leg.location = (x * half * 0.62, y * half * 0.45, 0)
            leg.rotation_euler = (-y * 0.08, x * 0.08, 0)
            finish(leg, wood, levels=1).parent = root
        self.stool = root

    def buildHair(self):
        c, b = self.c, self.body
        rx, ry, rz = b["rx"] * S, b["ry"] * S, b["rz"] * S
        style = c["hair"]["style"]
        material = look.hair(c["hair"]["color"])
        name = c["id"]
        if style == "bald":
            if c["age"] == "elder":
                # Vành tóc bạc quanh gáy.
                ring = loft(name + "Fringe", [(0, rz * 0.12, ry * 0.05, rx * 1.02, rz * 0.95), (0, rz * 0.1, ry * 0.32, rx * 0.98, rz * 0.9)], self.collection, cap=False)
                bm = bmesh.new()
                bm.from_mesh(ring.data)
                bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < -rz * 0.25], context="FACES")
                bm.to_mesh(ring.data)
                bm.free()
                ring.modifiers.new("thick", "SOLIDIFY").thickness = rx * 0.12
                finish(ring, material, levels=2).parent = self.head
            return
        # Mũ tóc: phần mặt cầu nằm trên đường chân tóc, nâng dày và bo tròn; mép trước tách thành lọn mái.
        lift = 1.12 if style == "curly" else 1.07
        cap = ellipsoid(name + "Hair", (rx * lift, rz * lift, ry * lift), self.collection, segments=40)
        bm = bmesh.new()
        bm.from_mesh(cap.data)
        drop = []
        for vertex in bm.verts:
            x, y, z = vertex.co
            u = math.atan2(x / (rx * lift), -y / (rz * lift))
            v = math.asin(max(-1.0, min(1.0, z / (ry * lift))))
            front = max(0.0, math.cos(u))
            clump = 0 if style == "bob" else abs(math.sin(u * 9 + 0.6)) ** 0.7 * 0.08 * front
            if v < hairline(style, u) - clump:
                drop.append(vertex)
        bmesh.ops.delete(bm, geom=drop, context="VERTS")
        bm.to_mesh(cap.data)
        bm.free()
        cap.modifiers.new("thick", "SOLIDIFY").thickness = rx * 0.08
        finish(cap, material, levels=2).parent = self.head
        if style == "long":
            back = loft(name + "LongHair", [
                (0, rz * 0.35, -ry * 0.1, rx * 0.95, rz * 0.6),
                (0, rz * 0.55, -ry * 1.2, rx * 0.95, rz * 0.32),
                (0, rz * 0.6, -ry * 2.6, rx * 0.82, rz * 0.22),
                (0, rz * 0.62, -ry * 3.2, rx * 0.6, rz * 0.12),
            ], self.collection)
            finish(back, material, levels=2).parent = self.head
            self.backHair = back
        if style == "bun":
            bun = ellipsoid(name + "Bun", (rx * 0.42, rx * 0.42, rx * 0.4), self.collection)
            bun.location = headPoint(rx, ry, rz, math.pi, 0.62, 1.15)
            finish(bun, material, levels=1).parent = self.head
        if style == "ponytail":
            tail = capsule(name + "Tail", ry * 1.6, rx * 0.25, rx * 0.12, self.collection)
            tail.location = headPoint(rx, ry, rz, math.pi, 0.25, 1.05)
            tail.rotation_euler = (math.radians(160), 0, 0)
            finish(tail, material, levels=2).parent = self.head
        if c.get("hat") == "nonLa":
            # Nón lá: chóp nón cong nhẹ, vành rộng gấp hai đầu.
            radius, height = rx * 2.1, ry * 1.35
            hat = loft(name + "NonLa", [(0, 0, ry * 0.42, radius, radius), (0, 0, ry * 0.42 + height * 0.35, radius * 0.62, radius * 0.62), (0, 0, ry * 0.42 + height * 0.75, radius * 0.22, radius * 0.22), (0, 0, ry * 0.42 + height, 0.002, 0.002)], self.collection, cap=False)
            hat.modifiers.new("thick", "SOLIDIFY").thickness = 0.004
            finish(hat, look.principled("nonLa", c.get("hatColor", "#e3cc8c"), roughness=0.75, sheen=0.3, noise=0.12), levels=1).parent = self.head

    # ---------- Diễn theo từng khung ----------

    def show(self, root, visible: bool, frame: int):
        # Ẩn/hiện cả cụm (Blender không truyền hide_render từ cha xuống con).
        # Vật dựng muộn (dáng tay, đạo cụ, ghế) phải ẩn ở mọi khung trước khi xuất hiện lần đầu.
        for obj in [root, *root.children_recursive]:
            if frame > 1 and not (obj.animation_data and obj.animation_data.action):
                obj.hide_render = True
                obj.keyframe_insert("hide_render", frame=frame - 1)
            obj.hide_render = not visible
            obj.keyframe_insert("hide_render", frame=frame)

    def hide(self, frame: int):
        """Diễn viên không có mặt trong khung này (vào cảnh muộn, đã ra khỏi cảnh)."""
        roots = [*self.parts.values(), self.head, *(hand for shapes in self.hands.values() for hand in shapes.values()), *(obj for obj in self.held.values() if obj)]
        for obj in roots + ([self.stool] if self.stool else []):
            self.show(obj, False, frame)

    def key(self, obj, matrix: Matrix, frame: int, visible=True):
        self.show(obj, visible, frame)
        obj.matrix_world = matrix
        obj.keyframe_insert("location", frame=frame)
        obj.rotation_mode = "QUATERNION"
        obj.keyframe_insert("rotation_quaternion", frame=frame)
        obj.keyframe_insert("scale", frame=frame)

    def segment(self, root: Matrix, a, b, up=(0, 0, 1)) -> Matrix:
        """Ma trận đặt một khối thuôn (+Z) nằm từ khớp a tới khớp b."""
        p, q = local(a), local(b)
        direction = (q - p).normalized()
        rotation = direction.to_track_quat("Z", "Y")
        return root @ Matrix.Translation(p) @ rotation.to_matrix().to_4x4()

    def pose(self, actor: dict, frame: int, ride: float = 0.0):
        pose = actor["pose"]
        joints = actor["joints"]
        yaw = pose["yaw"]
        root = Matrix.Translation((pose["x"] * S, ride, -pose["y"] * S)) @ Matrix.Rotation(yaw, 4, "Z")
        o = actor["torso"]
        torsoFrame = axes(o[3:6], o[6:9], o[9:12]).to_4x4()
        torsoFrame.translation = local(o[0:3])
        for name in self.torsoParts:
            self.key(self.parts[name], root @ torsoFrame, frame)
        if "skirt" in self.parts:
            sit = self.parts["skirt"].data.shape_keys.key_blocks["sit"]
            sit.value = min(1.0, pose["seat"])
            sit.keyframe_insert("value", frame=frame)
        neckBase = joints["neck"]
        self.key(self.parts["neck"], self.segment(root, neckBase, actor["head"]), frame)
        for side in ("left", "right"):
            self.key(self.parts[f"{side}Upper"], self.segment(root, joints[f"{side}Shoulder"], joints[f"{side}Elbow"]), frame)
            if f"{side}Sleeve" in self.parts:
                self.key(self.parts[f"{side}Sleeve"], self.segment(root, joints[f"{side}Shoulder"], joints[f"{side}Elbow"]), frame)
            self.key(self.parts[f"{side}Fore"], self.segment(root, joints[f"{side}Elbow"], joints[f"{side}Wrist"]), frame)
            self.key(self.parts[f"{side}Thigh"], self.segment(root, joints[f"{side}Hip"], joints[f"{side}Knee"]), frame)
            self.key(self.parts[f"{side}Shin"], self.segment(root, joints[f"{side}Knee"], joints[f"{side}Ankle"]), frame)
            self.key(self.parts[f"{side}Foot"], self.segment(root, joints[f"{side}Ankle"], joints[f"{side}Toe"]), frame)
            # Bàn tay nối tiếp cẳng tay; các dáng tay khác được ẩn.
            wrist = self.segment(root, joints[f"{side}Elbow"], joints[f"{side}Wrist"])
            forearm = (local(joints[f"{side}Wrist"]) - local(joints[f"{side}Elbow"])).length
            handMatrix = wrist @ Matrix.Translation((0, 0, forearm)) @ Matrix.Rotation(math.pi, 4, "X")
            wanted = pose["hands"][side]
            self.hand(side, wanted)
            for shape, obj in self.hands[side].items():
                self.key(obj, handMatrix, frame, visible=shape == wanted)
            # Đạo cụ trong tay: gốc tại lòng bàn tay, dựng đứng đối diện máy quay, lật ngang khi nhìn sang trái như bản 2D.
            holding = (pose.get("hold") or {}).get(side)
            if holding:
                self.holdProp(side, holding)
            center = handMatrix @ Vector((0, 0, -self.body["palm"] * S * 0.6))
            mirror = -1 if math.sin(yaw) < -0.05 else 1
            for (owner, kind), obj in self.held.items():
                if owner == side and obj:
                    shown = kind == holding
                    self.key(obj, Matrix.Translation(center) @ Matrix.Diagonal((mirror, 1, 1, 1)), frame, visible=shown)
        if pose["seat"] > 0.02 and not self.stool:
            self.buildStool(-(joints["hip"][1] + self.body["legRadius"] * 0.9) * S)
        if self.stool:
            hip = local(joints["hip"])
            self.key(self.stool, root @ Matrix.Translation((hip.x, hip.y, 0)), frame, visible=pose["seat"] > 0.02)
        self.poseHead(actor, root, frame)
        # Sau poseHead: khoá hiện của đầu phủ cả cụm con, nước mắt phải đặt lại.
        for drop in self.tears:
            self.show(drop, pose["tears"] >= 0.05, frame)

    def poseHead(self, actor: dict, root: Matrix, frame: int):
        pose = actor["pose"]
        faces = self.faces
        expression = pose["expression"]
        grow = headScale[self.c["age"]]
        head = Matrix.Translation(local(actor["head"])) @ Matrix.Rotation(pose["headYaw"], 4, "Z") @ Matrix.Rotation(-pose["headPitch"], 4, "X") @ Matrix.Rotation(-pose["headRoll"], 4, "Y")
        # Đầu phóng to quanh cằm chứ không quanh tâm, để cổ vẫn nối đúng.
        head = head @ Matrix.Translation((0, 0, (grow - 1) * self.body["ry"] * S * 0.85)) @ Matrix.Scale(grow, 4)
        self.key(self.head, root @ head, frame)
        # Mắt nhìn: look[0] là hướng ngang trên màn hình, đổi sang góc quay nhãn cầu.
        lookX, lookY = pose["look"]
        for pivot, u in self.eyes:
            pivot.rotation_mode = "XYZ"
            pivot.rotation_euler = (-lookY * 0.25, 0, -lookX * 0.45 * (1 if math.cos(pose["yaw"]) >= 0 else -1))
            pivot.keyframe_insert("rotation_euler", frame=frame)
        lidTop, lidBottom = faces["lids"][expression]
        blink = pose["blink"]
        closed = min(1.0, blink + lidTop * 0.8)
        for lid, which, side in self.lids:
            lid.rotation_mode = "XYZ"
            if which == "upper":
                # Mí trên hạ xuống khi chớp/buồn; góc nghiêng theo cảm xúc (giận: nghiêng vào trong).
                tilt = -faces["brows"][expression][0] * 0.8 * (1 if side == "left" else -1)
                # Mép mí trên ở xích đạo nhãn cầu khi góc 0: mở to là ngửa ra sau (-0,55), nhắm là úp xuống (~1,45).
                lid.rotation_euler = (-0.55 + closed * 2.0, tilt, 0)
            else:
                # Mí dưới thường nấp gần hết vào gò má, chỉ nhô lên khi cười híp mắt hoặc chớp.
                lid.rotation_euler = (0.55 - lidBottom * 1.1 - blink * 0.35, 0, 0)
            lid.keyframe_insert("rotation_euler", frame=frame)
        b = self.body
        rx, ry, rz = b["rx"] * S, b["ry"] * S, b["rz"] * S
        inner, outer = faces["brows"][expression]
        for side, u in eyeSides:
            brow = self.parts[f"{side}Brow"]
            sign = 1 if side == "left" else -1
            # Bảng 2D tính theo trục y hướng xuống: số âm là nhướng lên; đuôi mày cao hơn đầu mày khi outer < inner.
            base = headPoint(rx, ry, rz, u, 0.2 - (inner + outer) * 0.3, 1.0)
            brow.rotation_mode = "XYZ"
            brow.location = base + Vector((-sign * rx * 0.16, 0, 0))
            # Đầu mày hơi cao hơn đuôi mày làm nền: nét mặt hiền, không cau có.
            brow.rotation_euler = (0, sign * (math.pi / 2 - (inner - outer) * 1.6 + 0.08), 0)
            brow.keyframe_insert("location", frame=frame)
            brow.keyframe_insert("rotation_euler", frame=frame)
        # Miệng: dáng khẩu hình Preston Blair + độ mở theo giọng + khoé miệng theo cảm xúc.
        shape = faces["visemes"].get(pose["viseme"], faces["visemes"]["X"])
        opened = 0.0 if shape["h"] == 0 else max(0.2, pose["mouth"]) * shape["h"]
        # Khoé miệng hơi cong lên làm nền: nhân vật hoạt hình hiếm khi có miệng thẳng đơ.
        smile = faces["smiles"][expression] + 0.25
        keys = self.mouth.data.shape_keys.key_blocks
        values = {
            "open": opened, "wide": max(0.0, shape["w"] - 0.85) * 3, "round": shape["round"],
            "smile": max(0.0, smile), "frown": max(0.0, -smile), "closed": 1.0 if opened < 0.05 else 0.0,
        }
        for name, value in values.items():
            keys[name].value = value
            keys[name].keyframe_insert("value", frame=frame)
