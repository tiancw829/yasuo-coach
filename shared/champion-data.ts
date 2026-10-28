// Labels describe Data Dragon fields; growth fields are not linear level bonuses.
export const statFields = [
  { key: 'hp', label: '生命值', unit: '', growth: 'hpperlevel' },
  { key: 'mp', label: '资源上限（类型以被动／技能说明为准）', unit: '', growth: 'mpperlevel' },
  { key: 'attackdamage', label: '攻击力', unit: '', growth: 'attackdamageperlevel' },
  { key: 'armor', label: '护甲', unit: '', growth: 'armorperlevel' },
  { key: 'spellblock', label: '魔抗', unit: '', growth: 'spellblockperlevel' },
  { key: 'attackspeed', label: '攻速', unit: '次/秒', growth: 'attackspeedperlevel', growthUnit: '%' },
  { key: 'movespeed', label: '移动速度', unit: '' },
  { key: 'attackrange', label: '攻击距离', unit: '' },
  { key: 'hpregen', label: '生命回复', unit: '/5秒', growth: 'hpregenperlevel' },
  { key: 'mpregen', label: '资源回复（原始字段）', unit: '/5秒', growth: 'mpregenperlevel' },
  { key: 'crit', label: '暴击几率', unit: '%', growth: 'critperlevel' }
];
export const dataNotes = {
  stats: 'stats 为所选版本 Data Dragon 的原始基础属性及成长字段，包含 0 值。成长字段不能简单线性相加推算等级属性；特殊成长需另行核查。mp 不一定是法力值，亚索的资源是意流。',
  skills: 'cooldown 数组按技能等级排列，单位秒，不含技能急速；全 0 或 null 不作为可靠 CD。必须优先阅读 special：亚索 Q 受攻速影响，E 连续施放间隔不是对同一目标的重用间隔。被动和描述为官方说明，不保证包含完整伤害、加成、范围和消耗公式，缺失时明确说明资料未提供。'
};
