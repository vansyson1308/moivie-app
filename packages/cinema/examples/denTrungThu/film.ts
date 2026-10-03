import { createFilm } from "@toonflow/cinema";

const film = createFilm({
  title: "Đèn Trung Thu",
  format: "scope",
  narrator: "Thiện Minh",
  music: "calm",
  author: "Toonflow Cinema",
  look: { grain: 0.05, vignette: 0.45 },
});

film.cast({
  na: {
    name: "Bé Na", age: "child", gender: "female", hair: { style: "bun" },
    outfit: { style: "dress", top: "#d9534f" }, voice: "Ngọc Huyền",
  },
  ba: {
    name: "Bà nội", age: "elder", gender: "female", hair: { style: "bun", color: "#d6d1c8" },
    outfit: { style: "aoBaBa", top: "#6b4f7a", bottom: "#2a2522" }, voice: "Quỳnh Anh",
  },
  bo: {
    name: "Bố", outfit: { style: "jacket", top: "#3d5a80", bottom: "#2f2a27" },
    hair: { style: "short" }, voice: "Quốc Tuấn",
  },
});

// Đèn ông sao: ngôi sao năm cánh trên cán tre, phát sáng.
film.prop("denOngSao", {
  path: "M0,-159 L8.8,-137.1 L32.3,-135.5 L14.3,-120.4 L20,-97.5 L0,-110 L-20,-97.5 L-14.3,-120.4 L-32.3,-135.5 L-8.8,-137.1 Z M-2.5,0 L2.5,0 L2.5,-92 L-2.5,-92 Z",
  fill: "#f2c94c", glow: "rgba(255,196,90,0.55)",
});

film.set("sanNha", {
  width: 2400, time: "night", ground: "dirt", weather: "fireflies", ambience: "night",
  elements: [
    { type: "hills", seed: 6, color: "#2c3f5a" },
    { type: "bamboo", x: 250, depth: 0.7, scale: 0.9 },
    { type: "house", x: 1300, depth: 0.97, scale: 1.6 },
    { type: "tree", x: 380, depth: 0.95, scale: 1.2 },
    { type: "lantern", x: 950, y: -330, color: "#e74c3c" },
    { type: "lantern", x: 1550, y: -330, color: "#f39c12" },
    { type: "grass", x: 1900, width: 700 },
  ],
});

film.chapter("Đèn Trung Thu", "Một phim ngắn dựng hoàn toàn trên máy");

film.scene("sanNha", {
  na: { x: 1050, facing: "front", posture: "sit", expression: "sad" },
  ba: { x: 1400, facing: "left" },
}, s => {
  s.shot("establishing", { move: "craneDown", transition: "iris", transitionDuration: 1.4 })
    .narrate("Đêm Trung Thu, cả xóm rộn ràng tiếng trống. Chỉ có bé Na ngồi lặng im trước hiên nhà.");
  s.shot("twoShot", { on: ["na", "ba"] })
    .say("na", "Bà ơi, năm nay bố có về không bà?", { emotion: "sad" })
    .act("na", "look", { at: "ba", with: true });
  s.shot("closeUp", { on: "ba", move: "push" })
    .say("ba", "Bố con làm xa lắm. Nhưng bà làm cho con cái đèn ông sao này nè.", { emotion: "tender" });
  s.shot("medium", { on: ["ba", "na"] })
    .act("ba", "walk", { to: 1180 })
    .act("ba", "give", { at: "na", prop: "denOngSao" })
    .act("ba", "walk", { to: 1330 })
    .act("ba", "turn", { at: "na" });
  s.shot("closeUp", { on: "na", move: "push" })
    .say("na", "Con không cần đèn. Con chỉ cần bố thôi.", { emotion: "sad" })
    .act("na", "turn", { at: "back", delay: 0.2 })
    .act("na", "cry", { with: true, duration: 2.4 });
}, { music: "sad" });

film.scene("sanNha", {
  na: { x: 1050, facing: "back", posture: "sit", hold: "denOngSao", expression: "sad" },
  ba: { x: 1330, facing: "left" },
  bo: { x: -150, facing: "right" },
}, s => {
  s.shot("wide", { transition: "dissolve", transitionDuration: 1.2 })
    .narrate("Trăng lên cao. Đèn ông sao vẫn sáng trong tay em.");
  s.shot("full", { on: "bo", move: "follow" })
    .act("bo", "walk", { to: 650, speed: 1.2 })
    .say("bo", "Na ơi! Bố về rồi đây!", { emotion: "happy" });
  s.shot("closeUp", { on: "na", duration: 2 })
    .act("na", "turn", { at: "front", duration: 0.9 })
    .act("na", "emote", { expression: "surprised", with: true });
  s.shot("medium", { on: ["bo", "na"] })
    .act("na", "stand")
    .act("na", "run", { to: 760 })
    .act("na", "embrace", { with: true, delay: 0.3 })
    .act("bo", "embrace", { with: true })
    .act("bo", "emote", { expression: "happy", with: true })
    .say("na", "Bố ơi!", { emotion: "happy", with: true, delay: 0.4 });
  s.shot("wide", { move: "dollyOut" })
    .act("ba", "laugh")
    .narrate("Có những ánh đèn không cần thắp, vẫn sáng trọn một mùa trăng.", { with: true, delay: 0.5 });
}, { music: "hopeful" });

export default film;
