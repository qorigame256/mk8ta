// マリオカート8 デラックスの全96コース（ゲーム内のカップ順）。
// id は記録データと結び付くので、一度決めたら変えないこと（並べ替え・名前の修正は自由）。
// 機種表記（SFC など）の根拠は 仕様書.md の「コース一覧の出典」を参照。
const CUPS = [
  { name: "キノコカップ", dlc: false, courses: ["マリオカートスタジアム", "ウォーターパーク", "スイーツキャニオン", "ドッスンいせき"] },
  { name: "フラワーカップ", dlc: false, courses: ["マリオサーキット", "キノピオハーバー", "ねじれマンション", "ヘイホーこうざん"] },
  { name: "スターカップ", dlc: false, courses: ["サンシャインくうこう", "ドルフィンみさき", "エレクトロドリーム", "ワリオスノーマウンテン"] },
  { name: "スペシャルカップ", dlc: false, courses: ["スカイガーデン", "ホネホネさばく", "クッパキャッスル", "レインボーロード"] },
  { name: "たまごカップ", dlc: false, courses: ["GC ヨッシーサーキット", "エキサイトバイク", "ドラゴンロード", "ミュートシティ"] },
  { name: "どうぶつカップ", dlc: false, courses: ["GC ベビィパーク", "GBA チーズランド", "ネイチャーロード", "どうぶつの森"] },
  { name: "こうらカップ", dlc: false, courses: ["Wii モーモーカントリー", "GBA マリオサーキット", "DS プクプクビーチ", "N64 キノピオハイウェイ"] },
  { name: "バナナカップ", dlc: false, courses: ["GC カラカラさばく", "SFC ドーナツへいや3", "N64 ピーチサーキット", "3DS DKジャングル"] },
  { name: "このはカップ", dlc: false, courses: ["DS ワリオスタジアム", "GC シャーベットランド", "3DS ミュージックパーク", "N64 ヨッシーバレー"] },
  { name: "サンダーカップ", dlc: false, courses: ["DS チクタクロック", "3DS パックンスライダー", "Wii グラグラかざん", "N64 レインボーロード"] },
  { name: "ゼルダカップ", dlc: false, courses: ["Wii ワリオこうざん", "SFC レインボーロード", "ツルツルツイスター", "ハイラルサーキット"] },
  { name: "ベルカップ", dlc: false, courses: ["3DS ネオクッパシティ", "GBA リボンロード", "リンリンメトロ", "ビッグブルー"] },
  { name: "パワフルカップ", dlc: true, courses: ["Tour パリプロムナード", "3DS キノピオサーキット", "N64 チョコマウンテン", "Wii ココナッツモール"] },
  { name: "まねきネコカップ", dlc: true, courses: ["Tour トーキョースクランブル", "DS キノコリッジウェイ", "GBA スカイガーデン", "Tour ニンニンドージョー"] },
  { name: "カブカップ", dlc: true, courses: ["Tour ニューヨークドリーム", "SFC マリオサーキット3", "N64 カラカラさばく", "DS ワルイージピンボール"] },
  { name: "プロペラカップ", dlc: true, courses: ["Tour シドニーサンシャイン", "GBA スノーランド", "Wii キノコキャニオン", "アイスビルディング"] },
  { name: "ゴロいわカップ", dlc: true, courses: ["Tour ロンドンアベニュー", "GBA テレサレイク", "3DS ロックロックマウンテン", "Wii メイプルツリーハウス"] },
  { name: "ムーンカップ", dlc: true, courses: ["Tour ベルリンシュトラーセ", "DS ピーチガーデン", "Tour メリーメリーマウンテン", "3DS レインボーロード"] },
  { name: "フルーツカップ", dlc: true, courses: ["Tour アムステルダムブルーム", "GBA リバーサイドパーク", "Wii DKスノーボードクロス", "ヨッシーアイランド"] },
  { name: "ブーメランカップ", dlc: true, courses: ["Tour バンコクラッシュ", "DS マリオサーキット", "GC ワルイージスタジアム", "Tour シンガポールスプラッシュ"] },
  { name: "ハネカップ", dlc: true, courses: ["Tour アテネポリス", "GC デイジークルーザー", "Wii ムーンリッジ＆ハイウェイ", "シャボンロード"] },
  { name: "チェリーカップ", dlc: true, courses: ["Tour ロサンゼルスコースト", "GBA サンセットこうや", "Wii ノコノコみさき", "Tour バンクーバーバレー"] },
  { name: "ドングリカップ", dlc: true, courses: ["Tour ローマアバンティ", "GC DKマウンテン", "Wii デイジーサーキット", "Tour パックンしんでん"] },
  { name: "トゲゾーカップ", dlc: true, courses: ["Tour マドリードグランデ", "3DS ロゼッタプラネット", "SFC クッパじょう3", "Wii レインボーロード"] },
];

// 上の表から { id: "c01"…"c96", name, cup, dlc } の一覧を作る
const COURSES = [];
CUPS.forEach((cup) => {
  cup.courses.forEach((name) => {
    const id = "c" + String(COURSES.length + 1).padStart(2, "0");
    COURSES.push({ id, name, cup: cup.name, dlc: cup.dlc });
  });
});
const COURSE_BY_ID = Object.fromEntries(COURSES.map((c) => [c.id, c]));
