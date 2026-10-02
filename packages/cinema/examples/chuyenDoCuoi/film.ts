import { createFilm } from "@toonflow/cinema";

const film = createFilm({
  title: "Chuyến đò cuối",
  narrator: "Thiện Minh",
  music: "calm",
  author: "Toonflow Cinema",
  look: { grain: 0.06, vignette: 0.4 },
});

film.cast({
  tu: {
    name: "Ông Tư", age: "elder", skin: "#c48a5c", beard: "goatee", hat: "nonLa",
    outfit: { style: "aoBaBa", top: "#5b4a3a", bottom: "#2a2522" }, voice: "Thái Sơn",
  },
  lan: {
    name: "Cô Lan", gender: "female", hair: { style: "long" },
    outfit: { style: "aoDai", top: "#f4f1ea", bottom: "#f4f1ea" }, voice: "Ngọc Linh",
  },
});

film.set("benDo", {
  width: 2400, time: "dawn", ground: "dirt", weather: "mist", ambience: "river",
  elements: [
    { type: "mountains", seed: 4 },
    { type: "clouds" },
    { type: "bamboo", x: 300, depth: 0.55, scale: 0.8 },
    { type: "river", y: -150, depth: 0.8 },
    { type: "tree", x: 220, depth: 0.9, scale: 1.1 },
    { type: "pier", x: 1250, width: 560 },
    { type: "boat", id: "do", x: 1700, y: 40 },
    { type: "reeds", x: 2150, width: 500 },
  ],
});

film.set("giuaSong", {
  width: 3200, time: "morning", ground: "none", ambience: "river",
  elements: [
    { type: "mountains", seed: 9, scale: 0.8 },
    { type: "clouds", seed: 2 },
    { type: "hills", seed: 3, color: "#7fa66a" },
    { type: "bamboo", x: 900, depth: 0.45, scale: 0.6 },
    { type: "bamboo", x: 2300, depth: 0.45, scale: 0.7, seed: 4 },
    { type: "river", y: -60, depth: 1 },
    { type: "boat", id: "do", x: 900, y: 30 },
  ],
});

film.set("benKia", {
  width: 2400, time: "golden", ground: "grass", ambience: "river",
  elements: [
    { type: "mountains", seed: 12 },
    { type: "river", y: -150, depth: 0.8 },
    { type: "house", x: 500, depth: 0.7, scale: 0.8 },
    { type: "palm", x: 250, depth: 0.85 },
    { type: "boat", id: "do", x: 1700, y: 40 },
    { type: "grass", x: 900, width: 900 },
  ],
});

film.chapter("Chuyến đò cuối", "Một phim ngắn dựng hoàn toàn trên máy");

film.scene("benDo", {
  tu: { x: 1660, facing: "left", posture: "sit", ride: "do", hold: "oar" },
  lan: { x: 300, facing: "right" },
}, s => {
  s.shot("establishing", { move: "panRight" })
    .narrate("Ở bến sông này, suốt bốn mươi năm, ông Tư chèo đò đưa người sang sông.")
    .narrate("Ngày mai, cây cầu mới sẽ thông xe.");
  s.shot("full", { on: "lan", move: "follow" })
    .act("lan", "walk", { to: 1360 });
  s.shot("auto")
    .say("lan", "Ông Tư ơi, cho con qua sông với!", { emotion: "happy" })
    .act("tu", "stand")
    .say("tu", "Lên đi con. Chuyến này ông không lấy tiền.", { emotion: "tender" })
    .say("lan", "Sao vậy ông?", { emotion: "surprised" })
    .say("tu", "Chuyến cuối rồi. Mai có cầu, đâu còn ai cần đò nữa.", { emotion: "sad" });
  s.shot("closeUp", { on: "lan", move: "push" })
    .say("lan", "Con vẫn cần mà ông.", { emotion: "sad" });
});

film.scene("giuaSong", {
  tu: { x: 780, facing: "right", ride: "do", hold: "oar" },
  lan: { x: 960, facing: "left", posture: "sit", ride: "do", hold: "letter" },
}, s => {
  s.shot("establishing", { move: "follow", on: "tu", transition: "dissolve", transitionDuration: 1.2 })
    .act("tu", "row", { duration: 7 })
    .move("do", { to: 1900, duration: 9, with: true })
    .narrate("Con đò trôi chậm giữa dòng, như muốn kéo dài thêm một chút.", { with: true, delay: 1 });
  s.shot("twoShot", { on: ["tu", "lan"], move: "push" })
    .say("lan", "Học trò của con viết thư cảm ơn ông. Con mang tới tặng ông nè.", { emotion: "tender" })
    .act("lan", "give", { at: "tu", prop: "letter" });
  s.shot("closeUp", { on: "tu", move: "dollyIn", angle: "low" })
    .act("tu", "cry")
    .say("tu", "Bốn mươi năm... ông chưa từng nghĩ có người còn nhớ tới ông.", { emotion: "sad", with: true, delay: 0.6 });
}, { music: "sad" });

film.scene("benKia", {
  tu: { x: 1640, facing: "left", ride: "do", hold: "oar" },
  lan: { x: 1300, facing: "right" },
}, s => {
  s.shot("medium", { on: ["lan"], transition: "dissolve", transitionDuration: 1 })
    .say("lan", "Mai con sẽ đi cầu. Nhưng con sẽ nhớ chuyến đò của ông mãi.", { emotion: "tender" })
    .act("lan", "bow");
  s.shot("wide", { move: "dollyOut" })
    .act("tu", "wave")
    .act("lan", "wave", { with: true })
    .move("do", { to: 2600, duration: 7, with: true, delay: 1.2 })
    .narrate("Có những con đò không bao giờ cập bến cuối cùng.", { with: true, delay: 2 })
    .narrate("Nó neo lại, trong lòng người ở lại.");
}, { music: "hopeful" });

export default film;
