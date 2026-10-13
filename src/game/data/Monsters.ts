/**
 * 追捕克伦克 - 简化怪物数据
 * 供 AI DM 与战斗结算使用
 */

export interface MonsterDef {
  id: string;
  name: string;
  ac: number;
  hp: number;
  hpMax: number;
  /** 每回合攻击次数 */
  attacksPerRound: number;
  /** 单次攻击伤害（固定值，已简化） */
  damagePerHit: number;
  /** 伤害类型 */
  damageType?: string;
  /** 特殊能力描述，供 DM 叙事与规则判定 */
  abilities?: string[];
}

/** 鬼怪帮众 */
export const GOBLIN_GANG: MonsterDef = {
  id: 'goblin_gang',
  name: '鬼怪帮众',
  ac: 14,
  hp: 10,
  hpMax: 10,
  attacksPerRound: 1,
  damagePerHit: 5,
  damageType: '穿刺',
  abilities: ['迅捷逃生：生命<5时可用附赠动作后撤，下回合攻击前需 DC12 感知(察觉) 定位，每场战斗限一次'],
};

/** 刻洛战士 */
export const KRAUL_WARRIOR: MonsterDef = {
  id: 'kraul_warrior',
  name: '刻洛战士',
  ac: 18,
  hp: 27,
  hpMax: 27,
  attacksPerRound: 1,
  damagePerHit: 6,
  damageType: '穿刺',
  abilities: [
    '集群战术：身边 5 尺内有其他敌人时，攻击检定视为优势（玩家 AC 临时 -2）',
    '蛛行：可在墙/天花板移动',
  ],
};

/** 焦灼使者警卫 */
export const SCORCHBRINGER_GUARD: MonsterDef = {
  id: 'scorchbringer_guard',
  name: '焦灼使者警卫',
  ac: 16,
  hp: 11,
  hpMax: 11,
  attacksPerRound: 1,
  damagePerHit: 4, // 轻锤；焦灼使者 7 火焰另算
  damageType: '钝击',
  abilities: [
    '焦灼使者(充能)：1d6 掷出 4-6 可用，30尺线 7 火焰伤害，敏捷 DC12 减半',
    '炸药罐：死亡或焦灼使者掷出 1 时，10 尺内 7 火焰伤害，敏捷 DC12 减半',
  ],
};

/** 士兵 */
export const SOLDIER: MonsterDef = {
  id: 'soldier',
  name: '士兵',
  ac: 18,
  hp: 16,
  hpMax: 16,
  attacksPerRound: 2,
  damagePerHit: 6,
  damageType: '挥砍',
  abilities: ['阵形战术：身边 5 尺内有盟友时，抵抗威吓/控制时优势，相关检定 DC+2'],
};

/** 克仑可（Boss） */
export const KRENKO: MonsterDef = {
  id: 'krenko',
  name: '克仑可',
  ac: 17,
  hp: 21,
  hpMax: 21,
  attacksPerRound: 2,
  damagePerHit: 7, // 5 挥砍 + 2 毒素
  damageType: '挥砍+毒素',
  abilities: [
    '迅捷逃生：同鬼怪帮众',
    '攻击重定向(反应)：玩家攻击克仑可时，可指定 5 尺内鬼怪帮众代受，每场战斗限两次',
  ],
};

export const MONSTERS: Record<string, MonsterDef> = {
  [GOBLIN_GANG.id]: GOBLIN_GANG,
  [KRAUL_WARRIOR.id]: KRAUL_WARRIOR,
  [SCORCHBRINGER_GUARD.id]: SCORCHBRINGER_GUARD,
  [SOLDIER.id]: SOLDIER,
  [KRENKO.id]: KRENKO,
};
