export type WorshipLeaderSection = {
  number: number;
  title: string;
  content: string;
};

export type BibleVerse = {
  chapter: number;
  verse: number;
  text: string;
};

export const TEN_COMMANDMENTS = `제일은, 너는 나외에는 다른 신들을 네게 두지 말라
제이는, 너를 위하여 새긴 우상을 만들지 말고, 또 위로 하늘에 있는 것이나, 아래로 땅에 있는 것이나,
땅 아래 물속에 있는 것의 어떤 형상도 만들지 말며, 그것들에게 절하지 말며, 그것들을 섬기지 말라.
제삼은, 너는 네 하나님 여호와의 이름을 망령되게 부르지 말라
제사는, 안식일을 기억하여 거룩하게 지키라
제오는, 네 부모를 공경하라
제육은, 살인하지 말라
제칠은, 간음하지 말라
제팔은, 도둑질하지 말라
제구는, 네 이웃에 대하여 거짓 증거하지 말라
제십은, 네 이웃의 집을 탐내지 말라`;

export const APOSTLES_CREED = `전능하사 천지를 만드신 하나님 아버지를 내가 믿사오며,
그 외아들 우리 주 예수 그리스도를 믿사오니,
이는 성령으로 잉태하사 동정녀 마리아에게 나시고,
본디오 빌라도에게 고난을 받으사 십자가에 못 박혀 죽으시고,
장사한 지 사흘 만에 죽은 자 가운데서 다시 살아나시며,
하늘에 오르사 전능하신 하나님 우편에 앉아 계시다가,
저리로서 산 자와 죽은 자를 심판하러 오시리라.

성령을 믿사오며,
거룩한 공회와 성도가 서로 교통하는 것과,
죄를 사하여 주시는 것과,
몸이 다시 사는 것과,
영원히 사는 것을 믿사옵나이다.

아멘.`;

export const THEME_CHANT = "하나님의 안경으로 / 세상을 바라보는 어린이";

export const OFFERING_SONG = `고백하며 드립니다. 봉헌찬양드리겠습니다.

나의 가장 큰 기쁨 나의 하나님 / 내가 가진 것은 다 하나님이 주셨어요
나의 두 손에 소중한 마음을 담아 / 하나님께 고백하며 드립니다. (x2)`;

const THANKS = [
  "지난 한 주도 우리를 지켜 주시고 주님의 집에 모여 예배드리게 하시니 감사드립니다.",
  "한 주 동안 우리의 삶을 돌보시고 기쁜 마음으로 주님 앞에 나오게 하시니 감사드립니다.",
  "새로운 한 주를 허락하시고 초등부 친구들이 함께 예배할 수 있도록 인도해 주셔서 감사드립니다.",
  "지난 한 주의 모든 순간에 함께하시고 오늘 다시 주님을 예배하게 하시니 감사드립니다.",
  "우리에게 건강과 믿음을 주시고 이 시간 한자리에 모여 예배드리게 하시니 감사드립니다.",
];

const WORSHIP = [
  "지금 드리는 찬양과 기도를 기쁘게 받아 주시고 우리의 마음이 오직 주님만 향하게 해주세요.",
  "예배의 처음부터 마지막까지 함께하시며 우리의 모든 고백을 기쁘게 받아 주세요.",
  "이 시간 정성과 기쁨으로 드리는 예배가 주님께 향기로운 예배가 되게 해주세요.",
  "우리의 몸과 마음을 온전히 드리오니 주님 홀로 영광 받아 주세요.",
];

const FOCUS = [
  "떠드는 마음과 다른 생각을 내려놓고 찬양과 기도와 말씀에 집중하게 해주세요.",
  "눈과 귀와 마음을 활짝 열어 예배의 모든 순서에 기쁘게 참여하게 해주세요.",
  "예배를 방해하는 마음을 내려놓고 주님께 집중하는 초등부 친구들이 되게 해주세요.",
  "말씀을 듣는 동안 마음을 모으고 주님의 음성에 귀 기울이게 해주세요.",
];

const WORD = [
  "전해 주시는 말씀을 잘 듣고 깨달은 말씀을 삶에서 실천하여 아름다운 열매를 맺게 해주세요.",
  "말씀을 전하시는 전도사님께 성령의 능력을 더하시고, 들은 말씀대로 살아갈 힘을 주세요.",
  "말씀 시간을 은혜롭게 인도하시고 배운 말씀을 학교와 가정에서 기억하며 살아가게 해주세요.",
  "오늘 주시는 말씀으로 우리의 믿음이 자라고 예수님의 사랑을 세상에 전하게 해주세요.",
];

const TEACHERS = [
  "초등부를 위해 애쓰시는 전도사님과 모든 선생님께 감사하는 마음을 주시고, 선생님들에게 위로와 새 힘을 더해주세요.",
  "늘 앞서 섬기시는 전도사님과 선생님들을 축복하시고 사랑으로 하나 되는 초등부가 되게 해주세요.",
  "우리를 위해 기도하고 수고하시는 전도사님과 선생님들에게 풍성한 은혜와 기쁨을 주세요.",
];

function weekNumber(sunday: string) {
  const [year, month, day] = sunday.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 604_800_000);
}

/** 같은 주에는 같은 기도문을, 다음 주에는 반드시 다른 조합을 만든다. */
export function buildOpeningPrayer(sunday: string) {
  const week = weekNumber(sunday);
  return [
    "사랑의 주님,",
    THANKS[week % THANKS.length],
    WORSHIP[week % WORSHIP.length],
    FOCUS[(week * 3) % FOCUS.length],
    WORD[(week * 5) % WORD.length],
    TEACHERS[(week * 7) % TEACHERS.length],
    "감사드리며 거룩하신 예수님의 이름으로 기도드립니다. 아멘.",
  ].join(" ");
}

export function isFirstSunday(sunday: string) {
  return Number(sunday.slice(8, 10)) <= 7;
}

export function normalizeClassToken(value: string | undefined) {
  const match = (value || "").match(/(\d+)\s*(?:학년\s*|-\s*)(\d+)/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : "";
}

export function prayerLeaderLabel(sunday: string, prayerClass: string) {
  if (isFirstSunday(sunday)) return "(첫째주) 김정권 장로님";
  return prayerClass ? `${prayerClass}반 000 어린이` : "000 어린이";
}

export function normalizeBibleReference(reference: string) {
  return reference
    .replace(/말씀/g, "")
    .replace(/[()（）]/g, "")
    .replace(/[~～－–—]/g, "-")
    .replace(/(\d+)\s*(?:장|편)\s*/g, "$1:")
    .replace(/절/g, "")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function preacherLabel(preacher: string) {
  const value = preacher.trim();
  if (!value) return "담당 교역자님";
  if (/님$/.test(value)) return value;
  if (/(전도사|목사|장로|권사|집사|선생)$/.test(value)) return `${value}님`;
  return value;
}

export function buildWorshipLeaderSections(input: {
  sunday: string;
  prayerClass: string;
  scripture: string;
  normalizedScripture?: string;
  testament?: "구약" | "신약";
  verses?: BibleVerse[];
  sermonTitle: string;
  preacher: string;
}): WorshipLeaderSection[] {
  const reference = (input.normalizedScripture || input.scripture || "").trim();
  const scripture = reference || "말씀 본문 확인 필요";
  const verses = input.verses || [];
  // 본문이 안 채워지는 이유는 둘이고 조치도 다르다.
  //   본문 표기 자체가 없다  → 월간교육계획에 그 주일 행이 없거나 본문 칸이 비었다
  //   표기는 있는데 못 찾았다 → 성경 표기가 이상하다
  // 둘을 "성경 DB 오류" 하나로 뭉뚱그리면 엉뚱한 곳을 찾게 된다.
  const verseText = verses.length
    ? verses.map((row) => `${row.verse}   ${row.text}`).join("\n")
    : reference
      ? `"${reference}" 을(를) 성경에서 찾지 못했습니다. 본문 표기를 확인해주세요.`
      : "이 주일의 말씀 본문이 아직 정해지지 않았습니다. 화면 위에서 본문을 직접 입력하면 여기에 채워집니다.";
  const sermonTitle = input.sermonTitle || "말씀 주제 확인 필요";

  return [
    { number: 1, title: "시작기도", content: buildOpeningPrayer(input.sunday) },
    { number: 2, title: "십계명", content: TEN_COMMANDMENTS },
    { number: 3, title: "사도신경", content: APOSTLES_CREED },
    { number: 4, title: "주제 제창", content: THEME_CHANT },
    { number: 5, title: "봉헌찬양", content: OFFERING_SONG },
    {
      number: 6,
      title: "봉헌기도",
      content: `이 시간 예배와 헌금을 위해 ${prayerLeaderLabel(input.sunday, input.prayerClass)} 대표 기도 하겠습니다. 다 함께 두 손 모으고 기도 드리겠습니다.`,
    },
    {
      number: 7,
      title: "말씀봉독",
      content: `성경봉독 하도록 하겠습니다. 오늘 말씀은 ${scripture} 말씀입니다. (${input.testament || "구약/신약"} p.000)\n\n${scripture}\n\n${verseText}`,
    },
    {
      number: 8,
      title: "말씀주제",
      content: `오늘 말씀의 주제는 "${sermonTitle}"라는 주제로 ${preacherLabel(input.preacher)}께서 귀한 말씀 전해주시겠습니다.`,
    },
  ];
}

export function worshipLeaderScriptText(dateLabel: string, sections: WorshipLeaderSection[]) {
  return [`${dateLabel} 예배인도`, ...sections.map((section) => `${section.number}. ${section.title}\n${section.content}`)].join("\n\n");
}
