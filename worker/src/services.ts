export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function listGames(db: D1Database, userId: string) {
  return (
    await db
      .prepare(
        `SELECT g.id,g.name,g.kind,COALESCE(SUM(i.want_play),0) playCount,COALESCE(SUM(i.want_gm),0) gmCount,COALESCE(MAX(CASE WHEN i.user_id=? THEN i.want_play END),0) wantPlay,COALESCE(MAX(CASE WHEN i.user_id=? THEN i.want_gm END),0) wantGm FROM games g LEFT JOIN interests i ON i.game_id=g.id GROUP BY g.id ORDER BY g.name`,
      )
      .bind(userId, userId)
      .all<{
        id: string;
        name: string;
        kind: string;
        playCount: number;
        gmCount: number;
        wantPlay: number;
        wantGm: number;
      }>()
  ).results.map((g) => ({ ...g, wantPlay: !!g.wantPlay, wantGm: !!g.wantGm }));
}
export async function setInterest(
  db: D1Database,
  userId: string,
  gameId: string,
  wantPlay: boolean,
  wantGm: boolean,
) {
  if (typeof wantPlay !== "boolean" || typeof wantGm !== "boolean")
    throw new ApiError(400, "Ogiltigt intresse.");
  if (
    !(await db.prepare("SELECT id FROM games WHERE id=?").bind(gameId).first())
  )
    throw new ApiError(404, "Spelet saknas.");
  await db
    .prepare(
      "INSERT INTO interests VALUES (?,?,?,?,?) ON CONFLICT(user_id,game_id) DO UPDATE SET want_play=excluded.want_play,want_gm=excluded.want_gm,updated_at=excluded.updated_at",
    )
    .bind(userId, gameId, +wantPlay, +wantGm, new Date().toISOString())
    .run();
}
export interface Slot {
  day: number;
  period: string;
  preference: string;
}
export function validateSlot(s: Slot) {
  if (
    !s ||
    !Number.isInteger(s.day) ||
    s.day < 0 ||
    s.day > 6 ||
    !["day", "afternoon", "evening"].includes(s.period) ||
    !["often", "sometimes", "rarely"].includes(s.preference)
  )
    throw new ApiError(400, "Ogiltig tillgänglighet.");
}
export async function setAvailability(
  db: D1Database,
  userId: string,
  slots: Slot[],
) {
  if (!Array.isArray(slots) || slots.length > 21)
    throw new ApiError(400, "Ogiltig vecka.");
  slots.forEach(validateSlot);
  if (new Set(slots.map((s) => `${s.day}/${s.period}`)).size !== slots.length)
    throw new ApiError(400, "Dubbla tider.");
  await db.batch([
    db.prepare("DELETE FROM availability WHERE user_id=?").bind(userId),
    ...slots.map((s) =>
      db
        .prepare("INSERT INTO availability VALUES (?,?,?,?)")
        .bind(userId, s.day, s.period, s.preference),
    ),
  ]);
}
export async function listPlans(db: D1Database, userId: string) {
  const plans = (
    await db
      .prepare(
        "SELECT p.id,p.title,p.game_id gameId,g.name gameName,p.description,p.creator_id creatorId,p.status,p.confirmed_option_id confirmedOptionId FROM plans p JOIN games g ON g.id=p.game_id ORDER BY p.created_at DESC LIMIT 100",
      )
      .all<{
        id: string;
        title: string;
        gameId: string;
        gameName: string;
        description: string;
        creatorId: string;
        status: string;
        confirmedOptionId: string | null;
      }>()
  ).results;
  const options = (
    await db
      .prepare(
        `SELECT o.id,o.plan_id planId,o.starts_at startsAt,o.ends_at endsAt,SUM(CASE WHEN v.vote='yes' THEN 1 ELSE 0 END) yesCount,SUM(CASE WHEN v.vote='maybe' THEN 1 ELSE 0 END) maybeCount,SUM(CASE WHEN v.vote='no' THEN 1 ELSE 0 END) noCount,MAX(CASE WHEN v.user_id=? THEN v.vote END) myVote FROM plan_options o LEFT JOIN votes v ON v.option_id=o.id GROUP BY o.id ORDER BY o.starts_at`,
      )
      .bind(userId)
      .all<{
        id: string;
        planId: string;
        startsAt: string;
        endsAt: string;
        yesCount: number;
        maybeCount: number;
        noCount: number;
        myVote: string | null;
      }>()
  ).results;
  return plans.map((p) => ({
    ...p,
    options: options.filter((o) => o.planId === p.id),
  }));
}
export async function vote(
  db: D1Database,
  userId: string,
  planId: string,
  optionId: string,
  value: string | null,
) {
  if (value !== null && !["yes", "maybe", "no"].includes(value))
    throw new ApiError(400, "Ogiltigt svar.");
  const option = await db
    .prepare(
      "SELECT o.id FROM plan_options o JOIN plans p ON p.id=o.plan_id WHERE o.id=? AND p.id=? AND p.status=?",
    )
    .bind(optionId, planId, "proposed")
    .first();
  if (!option)
    throw new ApiError(409, "Förslaget saknas eller är redan bekräftat.");
  if (value === null)
    await db
      .prepare(
        "DELETE FROM votes WHERE user_id=? AND option_id=? AND EXISTS(SELECT 1 FROM plan_options o JOIN plans p ON p.id=o.plan_id WHERE o.id=? AND p.id=? AND p.status='proposed')",
      )
      .bind(userId, optionId, optionId, planId)
      .run();
  else
    await db
      .prepare(
        "INSERT INTO votes SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM plan_options o JOIN plans p ON p.id=o.plan_id WHERE o.id=? AND p.id=? AND p.status='proposed') ON CONFLICT(user_id,option_id) DO UPDATE SET vote=excluded.vote",
      )
      .bind(userId, optionId, value, optionId, planId)
      .run();
}
