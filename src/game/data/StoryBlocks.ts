/**
 * 追捕克伦克 — 剧情分块定义
 * readAloud：进入块时朗读（勿改原文）；readAloudSummaryForAI：仅传给 AI 的念白摘要
 */

import { getEffectiveAttributeMod } from './Player';
import type { SceneBattleSlots } from './BattlePrefabs';

export interface StoryBlock {
  id: string;
  name: string;
  readAloud: string[];
  /** 仅写入系统提示词，减轻 token，不替代朗读 */
  readAloudSummaryForAI: string;
  context: string;
  transitions: string[];
  /** 本场景最多两场预制战斗的槽位 ID（见 BattlePrefabs） */
  battlePrefabSlots: SceneBattleSlots;
}

export const STORY_BLOCKS: Record<string, StoryBlock> = {
  BLOCK_00: {
    id: 'BLOCK_00',
    name: '开始冒险',
    readAloud: [
      '第十区的生活永远不会沉闷。作为一个活跃的枢纽地区，它总能给人们提供新的机遇、新的挑战和新的阴谋诡计。在这块地方，像你这样有前途的冒险者可以通过对所属公会尽忠，来实现通往荣耀、财富或权贵之路。但在此之前，你还是先需要一份可助你证明自己价值的工作。',
      '今天是你的幸运日。下午时分，你从一位联络人手中收到一张便条：「我今天听说有人需要帮手来找些东西。而且似乎非常认真。或许正是你显身手的好机会。黄昏时分锯齿监狱外见。」',
      '太阳落到城市的尖顶与塔楼后方时，一场小雨也开始淅淅沥沥地拍打着鹅卵石。你看到一位身着精致服装的男性维多肯从监狱旁靠近你。他深蓝色的脸庞上透露着文雅，却也带着一丝担忧。他看了一眼你和周围的环境，然后向你举手致意并低声问道：「你来这，是要帮我们找东西吗？」',
    ],
    readAloudSummaryForAI:
      '第十区；联络人便条约定黄昏锯齿监狱外见面；雨夜维多肯纳休斯现身，询问是否接「找东西」的委托。',
    context: `【事件优先】开场地点：锯齿监狱外，雨夜。纳休斯·文（十会盟督学）已到场。
【关键】玩家必须先通过联络人便条得知：赴约地点为锯齿监狱外、与「找人/找东西」类委托相关；未表态前不要跳转其它街区。
检定仅用六维：力量/敏捷/体质/智力/感知/魅力；不设技能名。
玩家明确接受委托→next=BLOCK_01。拒绝则纳休斯劝说，仍以事件对话为主，少写战斗。
无战斗槽。`,
    transitions: ['BLOCK_01'],
    battlePrefabSlots: [null, null],
  },

  BLOCK_01: {
    id: 'BLOCK_01',
    name: '纳休斯·文简报',
    readAloud: [
      '纳休斯在你明确应承之后，将一份锯齿监狱的卷宗交到你手中。文件上的画像是个得意洋洋、狠相毕露的男性鬼怪——他便是今早日出前从转往乌泽途中逃脱的囚犯，锻炉街一带鬼怪黑帮的头目克仑可。纳休斯要你尽快查明他的下落：此人罪案累累，狱中还曾煽动骚乱；若放任不管，街头只会更乱。',
      '他压低声音继续说明：按常理该由俄佐立接手，但十会盟怀疑这次越狱背后有公会势力插手，事态可能牵连甚广，才改请「局外人」来查。骚帮兄弟会与克仑可血仇最深，正四处打探消息；你们须抢在他们之前，将克仑可活着缉拿归案，交给他公开受审。你切不可动用私刑，更不可擅自审问犯人。',
      '说到酬劳，纳休斯取出一小袋钱币搁在你掌心：先付十奇诺，供你在城里打听、奔走之用；待你把克仑可活着交到本人手中，再付一百奇诺为谢，并会向你的公会领袖传达你的忠勇。交接地点定在本区边缘、遭古鲁袭击而半毁的一座瑟雷尼亚旧粮仓——但眼下，你得先凭卷宗与街头的线索，把这个藏起来的鬼怪头目揪出来。',
    ],
    readAloudSummaryForAI:
      '纳休斯交卷宗：目标为越狱的克仑可；须活捉、交官方审问、禁私审；疑有公会牵涉故托外人；骚帮亦在追寻。报酬先十奇诺调查费，交人后另付一百奇诺并通报公会；最终于瑟雷尼亚旧粮仓交接。',
    context: `【简报】纳休斯交付卷宗与任务梗概：克仑可逃脱、鬼怪帮、骚帮、活捉不私审、报酬与粮仓交付等（按对话逐步透露）。
【寻获藏身处三条线】模组设计为三种方向最终指向克仑可藏身处(BLOCK_07)：
(1) 城中联络人与线人情报 BLOCK_02；(2) 公共场所蒐集谣言 BLOCK_03；(3) 广场西下水道与街巷 BLOCK_04～06。
若剧情中已排除或关闭其中两条线、仅剩**唯一**一条仍可行时：你必须在本轮用检定与叙事**强制**把玩家导向 BLOCK_07（可降低 DC、加强线索指向），并在玩家明确动身前往时填 next。
事件：感知/智力检定可察觉纳休斯有所隐瞒（DC 由你按紧张度给，约 12～15）。
禁止每轮自动转场；next 仅玩家明确「前往某处」时填写。战斗极少；本块无预制槽。
检定字段 dice.skill 必须为「力量|敏捷|体质|智力|感知|魅力」之一。`,
    transitions: ['BLOCK_02', 'BLOCK_03', 'BLOCK_04', 'BLOCK_05', 'BLOCK_06'],
    battlePrefabSlots: [null, null],
  },

  BLOCK_02: {
    id: 'BLOCK_02',
    name: '会见联络人',
    readAloud: [
      '你决定去拜访自己在城中的联络人，看看他们是否知道什么有用的情报。',
    ],
    readAloudSummaryForAI: '玩家前往城中联络人处打听克仑可情报。',
    context: `【事件】会见联络人：等待、会面、套话。以对话与调查为主；可获指向下水道/街区/帮派的线索。
若仅剩一种方式能找到藏身处，强制把后续检定与叙事推向 BLOCK_07。
转场：玩家明确去其它地点时 next。本场景无预制战斗槽；若需单次冲突可用 dice。
检定：仅六维属性名。`,
    transitions: ['BLOCK_03', 'BLOCK_04', 'BLOCK_05', 'BLOCK_06'],
    battlePrefabSlots: [null, null],
  },

  BLOCK_03: {
    id: 'BLOCK_03',
    name: '蒐集谣言',
    readAloud: [
      '你前往公共集会场所，混入人群中，试图打探有关克仑可的情报。',
    ],
    readAloudSummaryForAI: '玩家在公共场所向人群打听克仑可相关谣言。',
    context: `【事件】人群蒐集情报：魅力/感知相关检定打听消息；失败可引发跟踪或敌意（叙事）。
唯一路径剩余时强制导向 BLOCK_07。少写长战斗；最多两场预制战斗。
检定：六维之一。`,
    transitions: ['BLOCK_02', 'BLOCK_04', 'BLOCK_05', 'BLOCK_06'],
    battlePrefabSlots: [null, null],
  },

  BLOCK_04: {
    id: 'BLOCK_04',
    name: '广场西下水道',
    readAloud: [
      '你来到广场西边，找到了那道被挪移过的下水道格栅。圆型的检修竖井下连通着一片黑暗。竖井一侧用螺栓固定着一道铁梯。下水道刺鼻的气味直冲你的鼻子。你可以看到底部有些微弱的光，照着漂满垃圾的水。',
      '你在昏暗的地道中，站立在到小腿深的污水里。地道两边各有一条凸起的走道，可以让你从满是污泥的臭水中脱身。装着魔法火焰的小提灯散发着微光照明。墙壁上还覆盖着苔藓与地衣。',
    ],
    readAloudSummaryForAI: '广场西格栅入下水道；污水、走道、微光提灯。',
    context: `【事件】探索、追踪、环境危害；预制多轮战斗仅 slot_block04_a；若第二场遭遇需战斗可用单次 dice（六维检定）。
追踪成功可直达运河旁旧仓一带并衔接 BLOCK_07（玩家明确动身时 next）。
唯一线索剩此线时强制检定指向 BLOCK_07。`,
    transitions: ['BLOCK_05', 'BLOCK_06', 'BLOCK_07'],
    battlePrefabSlots: ['slot_block04_a', null],
  },

  BLOCK_05: {
    id: 'BLOCK_05',
    name: '锡街',
    readAloud: [
      '你来到了锡街——这个熙熙攘攘的集场区域挤满了商人、艺人、购物者和狂欢者。白天是购物用餐的主要地点，晚上则是剧院和酒馆活跃的时间。这里也是骚帮兄弟会占据的地盘。',
    ],
    readAloudSummaryForAI: '锡街集场繁华，骚帮地盘，可找军火商与酒馆线。',
    context: `【事件】骚帮、酒馆、军火商线索；交涉与潜入冲突。战斗最多两场：slot_block05_a / slot_block05_b。
【立绘】集场 BLOCK_05、酒馆室内 BLOCK_05_tavern、工坊室内 BLOCK_05_falish_workshop；仅在叙事**已进入**对应空间后填 sceneVisualId。法莉什线：后巷/撬锁/门外检定时勿填工坊室内；进入房间、提灯照亮室内后再填。离开酒馆/工坊回到街道时填 BLOCK_05。
获得克仑可下落时玩家动身→BLOCK_07。唯一路径时强制导向 BLOCK_07。`,
    transitions: ['BLOCK_04', 'BLOCK_06', 'BLOCK_11', 'BLOCK_07'],
    battlePrefabSlots: ['slot_block05_a', 'slot_block05_b'],
  },

  BLOCK_06: {
    id: 'BLOCK_06',
    name: '锻炉街',
    readAloud: [
      '你来到了锻炉街——第十区的制造业中心，工人们日夜劳作。鬼怪在这里十分常见，这里正是克仑可帮会的地盘。帮会的大部分成员已知克仑可出逃的消息。',
    ],
    readAloudSummaryForAI: '锻炉街制造业与克仑可帮派地盘。',
    context: `【事件】帮派地盘、冲突、俘虏与拷问线索；战斗最多两场：slot_block06_a / slot_block06_b。
套出藏身处后玩家动身→BLOCK_07。唯一路径时强制导向 BLOCK_07。`,
    transitions: ['BLOCK_04', 'BLOCK_05', 'BLOCK_12', 'BLOCK_07'],
    battlePrefabSlots: ['slot_block06_a', 'slot_block06_b'],
  },

  BLOCK_07: {
    id: 'BLOCK_07',
    name: '克仑可藏身处',
    readAloud: [
      '运河旁矗立着一栋被烟灰染污的木制大型建筑，建筑上还装饰着褪色的波洛斯军团徽记，上面的木头布满破裂与焦痕。门板紧闭的仓门朝北面向河道，一条木砌走道从建筑开始一直延伸到码头的凸堤。长得很像的另一道仓门朝南面向主街道。建筑两旁的巷道侧还另设有两道房门——西侧一道双扇门，而东侧则是一道单扇门。',
    ],
    readAloudSummaryForAI: '运河旁烧毁大仓，多扇门与走道，克仑可藏身处外围。',
    context: `【事件】潜入、巡逻、开锁与感知检定；室内搜刮与对峙前奏。战斗最多两场：slot_block07_a / slot_block07_b。
进入核心对峙→BLOCK_08。`,
    transitions: ['BLOCK_08'],
    battlePrefabSlots: ['slot_block07_a', 'slot_block07_b'],
  },

  BLOCK_08: {
    id: 'BLOCK_08',
    name: '直面克仑可',
    readAloud: [
      '你推开办公室的门。昏暗的房间里，克仑可和两个鬼怪头目正围坐在一张沉重的木桌旁，桌上散落着地图和武器。克仑可抬起头，狠相毕露的脸上闪过一丝惊讶。',
    ],
    readAloudSummaryForAI: '办公室内克仑可与两名头目，对峙或战斗。',
    context: `【事件】对峙、谈判或战斗；多轮投骰由 slot_block08_a / slot_block08_b 预制（见 BattlePrefabs）。
俘虏或制服后→BLOCK_09。`,
    transitions: ['BLOCK_09'],
    battlePrefabSlots: ['slot_block08_a', 'slot_block08_b'],
  },

  BLOCK_11: {
    id: 'BLOCK_11',
    name: '暗线交易',
    readAloud: [
      '你在锡街的暗巷里再次见到了法莉什。她没有立刻交出情报，而是先观察你是否可信：你是来结束混乱，还是只是换一个主子效忠。',
    ],
    readAloudSummaryForAI:
      '法莉什提出交易试探。玩家可用态度与条件交换线索，关系变化会影响后续潜入难度。',
    context: `【关系事件块】此块用于“与法莉什建立合作或决裂”。
若玩家保护其利益、避免暴力威胁、给出合理交换，可提高 falish 关系并给出指向 BLOCK_07 的捷径线索（如更安全入口、守卫换班时机）。
若玩家强迫或背弃承诺，降低 falish 关系，并可能给出误导性路径（仍不阻断主线）。
本块以对话与单次检定为主，少写战斗。玩家明确动身追捕克仑可时 next=BLOCK_07。`,
    transitions: ['BLOCK_07', 'BLOCK_05', 'BLOCK_06'],
    battlePrefabSlots: [null, null],
  },

  BLOCK_12: {
    id: 'BLOCK_12',
    name: '街头调停',
    readAloud: [
      '锻炉街的空气里全是火药味。骚帮与克仑可旧部在街口隔空叫骂，任何一句错话都可能点燃新一轮冲突。',
    ],
    readAloudSummaryForAI:
      '街头调停节点。玩家可选威慑、交易或安抚，改变 shattergang 与 krenko 阵营关系。',
    context: `【关系事件块】本块聚焦“玩家如何处理两帮矛盾”。
若玩家偏袒单方，可能提升一方关系并降低另一方关系；若尝试调停并给出可执行条件，可获得中立线索奖励（例如减少一次外围冲突）。
允许轻量检定（魅力/感知/智力）；避免长战斗。玩家明确前往藏身处时 next=BLOCK_07。`,
    transitions: ['BLOCK_07', 'BLOCK_05', 'BLOCK_06'],
    battlePrefabSlots: [null, null],
  },

  BLOCK_09: {
    id: 'BLOCK_09',
    name: '移交',
    readAloud: [
      '雨越下越大，直到演变成倾盆大雨时，你才走到第十区的市郊。你被带往一个老粮仓，那是纳休斯指定的会面地点。这座潮湿、破败的灰土建筑坐落在一片无人照管的田野里，那里长满了各种野生植物，整个地方几乎彻底回归自然。纳休斯从屋门口走向田野，他手里拿着一只小包，身旁还跟着两位全副武装的警卫。',
    ],
    readAloudSummaryForAI: '市郊粮仓移交，大雨，纳休斯与警卫。',
    context: `【事件】移交、对话、收束冲突。无战斗槽。
【分支结局】根据关键 NPC 关系决定结局导向：
- 若 nassius 关系较高且整体秩序稳定，可 next=BLOCK_10（官方移交结局）；
- 若多方关系维持在中性区，且玩家有调停行为，可 next=BLOCK_13（街区平衡结局）；
- 若 shattergang/krenko 等关系失衡且矛盾激化，可 next=BLOCK_14（黑帮反噬结局）。
仅在移交对话收束、玩家明确结束当前事件时填写 next。`,
    transitions: ['BLOCK_10', 'BLOCK_13', 'BLOCK_14'],
    battlePrefabSlots: [null, null],
  },

  BLOCK_10: {
    id: 'BLOCK_10',
    name: '结局',
    readAloud: [
      '你成功将克仑可移交给了纳休斯。在所属公会中，你赢得了 1 点声望。追捕克伦克的冒险，到此告一段落——但这座城市的阴谋远未结束……',
    ],
    readAloudSummaryForAI: '任务结束，声望+1，故事收束。',
    context: `【结局】总结与余韵；不再安排战斗或转场。next 恒为 null。`,
    transitions: [],
    battlePrefabSlots: [null, null],
  },

  BLOCK_13: {
    id: 'BLOCK_13',
    name: '结局：街区平衡',
    readAloud: [
      '你完成移交后，没有任何一方立刻欢呼胜利。可至少今晚，锻炉街和锡街都暂时安静了下来。人们没有记住你的名字，却记住了没有爆炸发生的这个夜晚。',
    ],
    readAloudSummaryForAI: '中立调停结局。玩家通过关系平衡与克制，换来短期秩序稳定。',
    context: `【结局】强调“关系平衡带来短期和平”。不再安排战斗或转场。next 恒为 null。`,
    transitions: [],
    battlePrefabSlots: [null, null],
  },

  BLOCK_14: {
    id: 'BLOCK_14',
    name: '结局：黑帮反噬',
    readAloud: [
      '你把人交了出去，但街头并没有因此安静。几处仓库在夜里接连起火，关于“清算名单”的流言迅速传开。你意识到自己只是把风暴推迟了一晚。',
    ],
    readAloudSummaryForAI: '失衡反噬结局。玩家行动使阵营矛盾升级，暴力连锁在城中蔓延。',
    context: `【结局】强调“关系失衡后的社会反噬”。不再安排战斗或转场。next 恒为 null。`,
    transitions: [],
    battlePrefabSlots: [null, null],
  },
};

/** 当前剧情块在数据上允许前往的场景名列表（供 UI 与 DM 提示词共用） */
export function getExitDestinationNames(blockId: string): string {
  const block = STORY_BLOCKS[blockId];
  if (!block?.transitions?.length) return '（本章已无可转场地点）';
  return block.transitions.map((tid) => STORY_BLOCKS[tid]?.name ?? tid).join('、');
}

/** 属性检定加值：检定名须含「力量|敏捷|体质|智力|感知|魅力」之一 */
export function getCheckModifier(
  equippedIds: readonly string[],
  checkName: string
): number {
  const table: Array<[string, 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha']> = [
    ['力量', 'str'],
    ['敏捷', 'dex'],
    ['体质', 'con'],
    ['智力', 'int'],
    ['感知', 'wis'],
    ['魅力', 'cha'],
  ];
  for (const [label, key] of table) {
    if (checkName.includes(label)) {
      return getEffectiveAttributeMod(equippedIds, key);
    }
  }
  return 0;
}
