import { z } from 'zod';

export const Version = z.string().regex(/^\d+\.\d+\.\d+$/);
export const ChampionId = z.string().regex(/^[A-Za-z0-9]+$/).max(40);
export const Slots = ['Q', 'W', 'E', 'R'] as const;
export type Slot = typeof Slots[number];
export const SourceSchema = z.object({ id: z.string(), label: z.string(), url: z.string().url(), patch: z.string(), checkedAt: z.string() });
export type Source = z.infer<typeof SourceSchema>;
export const SpellSchema = z.object({ slot: z.enum(Slots), name: z.string(), description: z.string(), cooldown: z.array(z.number()).nullable(), image: z.string(), special: z.string().optional() });
export const ChampionSchema = z.object({ id: ChampionId, key: z.string(), name: z.string(), title: z.string(), tags: z.array(z.string()), image: z.string(), stats: z.record(z.number()), passive: z.object({ name: z.string(), description: z.string() }), spells: z.array(SpellSchema) });
export type Champion = z.infer<typeof ChampionSchema>;
export const ItemSchema = z.object({ id: z.string(), name: z.string(), description: z.string(), gold: z.number(), image: z.string(), maps: z.record(z.boolean()), purchasable: z.boolean(), stats: z.record(z.number()) });
export type Item = z.infer<typeof ItemSchema>;
export const RuneSchema = z.object({ id: z.number(), key: z.string(), name: z.string(), description: z.string(), image: z.string(), tree: z.string() });
export type Rune = z.infer<typeof RuneSchema>;
export const SnapshotSchema = z.object({ version: Version, fetchedAt: z.string(), champions: z.record(ChampionSchema), items: z.record(ItemSchema), runes: z.array(RuneSchema) });
export type Snapshot = z.infer<typeof SnapshotSchema>;
export const ThreatSchema = z.object({ slot: z.enum(Slots), priority: z.enum(['最高', '高', '留意']), wall: z.enum(['可挡', '不可挡', '部分可挡', '待核查']), interaction: z.string(), response: z.string() });
export const GuideSchema = z.object({
  enemy: ChampionId, identity: z.string(), difficulty: z.enum(['有发挥空间', '细节博弈', '谨慎处理']),
  summary: z.string(), reminders: z.array(z.string()).length(3), threats: z.array(ThreatSchema),
  phases: z.array(z.object({ label: z.string(), title: z.string(), body: z.string() })).length(4),
  mistakes: z.array(z.string()).min(3), runeStyle: z.enum(['sustain', 'duel', 'burst']),
  damage: z.enum(['ap', 'ad', 'mixed']), buildNote: z.string(), summonerNote: z.string(),
  wallPlan: z.string(), aliases: z.array(z.string())
});
export type Guide = z.infer<typeof GuideSchema>;
export const KnowledgeSchema = z.object({ revision: z.string(), reviewedPatch: Version, checkedAt: z.string(), verification: z.string(), guides: z.array(GuideSchema) });
export type Knowledge = z.infer<typeof KnowledgeSchema>;
export const LoadoutRuleSchema = z.object({
  starter: z.enum(['1086','1054','1055']),
  alternative: z.enum(['1086','1054','1055']),
  starterReason: z.string().min(1),
  alternativeReason: z.string().min(1),
  runeReason: z.string().min(1),
  defensiveRune: z.enum(['SecondWind','BonePlating']),
  defensiveReason: z.string().min(1)
});
export type LoadoutRule = z.infer<typeof LoadoutRuleSchema>;
export const LoadoutRulesSchema = z.object({ revision:z.string(), patch:Version, basis:z.string(), default:LoadoutRuleSchema, matchups:z.record(LoadoutRuleSchema) });
export const SettingsInput = z.object({ baseUrl: z.string().trim().url().max(500).refine(v => { try { const u = new URL(v); return !u.username && !u.password && !u.search && !u.hash && (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))); } catch { return false; } }, '请使用 HTTPS 接口地址（本机服务可使用 HTTP），地址不能包含账号、查询参数或锚点'), model: z.string().trim().min(1).max(150), apiKey: z.string().max(1000).optional(), clearKey: z.boolean().optional() });
export type Settings = { baseUrl: string; model: string; apiKey: string };
export type PublicSettings = { baseUrl: string; model: string; hasKey: boolean };
export const AdviceInput = z.object({ enemy: ChampionId, version: Version, context: z.string().max(1200).default(''), question: z.string().max(1200).default(''), history: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string().max(5000) })).max(8).default([]) });
export const AdviceSchema = z.object({ headline: z.string().min(1).max(180), actions: z.array(z.string().min(1).max(500)).min(1).max(5), explanation: z.string().min(1).max(3500), sourceIds: z.array(z.string()).min(1).max(8) }).strict();
export type Advice = z.infer<typeof AdviceSchema>;
export type BuildGroup = { label: string; reason: string; items: Item[]; missing: string[]; kind?: 'starter'; quantities?: Record<string,number>; totalGold?: number|null; budgetValid?: boolean };
export type RunePage = { label: string; reason: string; primary: Rune[]; secondary: Rune[]; missing: string[]; shards: string[] };
export type Matchup = {
  version: string; fetchedAt: string; enemy: Champion; player: Champion; guide: Guide; refined: boolean;
  knowledgeRevision: string; reviewedPatch: string; stale: boolean; verification: string;
  sources: Source[]; builds: BuildGroup[]; runePages: RunePage[]; statsStatus: string;
  loadoutBasis: string;
};
