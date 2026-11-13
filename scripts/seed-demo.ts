/**
 * Fills a demo database with fictional people and deliveries, for screenshots and the showcase video.
 * Refuses any database whose name doesn't contain "demo", and wipes the app tables first.
 *
 *   createdb shiplog_demo   (or CREATE DATABASE shiplog_demo)
 *   DATABASE_URL=postgres://…/shiplog_demo bun run db:migrate
 *   DATABASE_URL=postgres://…/shiplog_demo bun run scripts/seed-demo.ts
 *
 * Then sign in as the lead with /dev/as?email=ana.souza@demo.shiplog (development only).
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { account, comments, shipments, tickets, user, verifications, type TimelineEntry } from "@/lib/db/schema";

const url = process.env.DATABASE_URL ?? "";
if (!/demo/i.test(new URL(url).pathname)) {
  console.error(`Refusing to seed ${new URL(url).pathname}: the database name must contain "demo".`);
  process.exit(1);
}

const PROJECT = "demo/plataforma";
const HOUR = 3_600_000;
// São Paulo is UTC-3: `at(2, 14, 30)` is two days ago at 14:30 there.
function at(daysAgo: number, hour: number, minute = 0): Date {
  const d = new Date(Date.now() - daysAgo * 24 * HOUR);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  return new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`);
}

const people = [
  { id: "demo-ana", name: "Ana Souza", role: "lead", slack: "UDEMOANA" },
  { id: "demo-bruno", name: "Bruno Lima", role: "dev", slack: "UDEMOBRUNO" },
  { id: "demo-carla", name: "Carla Mendes", role: "dev", slack: "UDEMOCARLA" },
  { id: "demo-diego", name: "Diego Rocha", role: "dev", slack: "UDEMODIEGO" },
  { id: "demo-fernanda", name: "Fernanda Alves", role: "member", slack: "UDEMOFERNANDA" },
  { id: "demo-gabriel", name: "Gabriel Nunes", role: "member", slack: "UDEMOGABRIEL" },
  { id: "demo-helena", name: "Helena Prado", role: "member", slack: "UDEMOHELENA" },
] as const;
type Person = (typeof people)[number]["id"];
const slackOf = (id: Person) => people.find((p) => p.id === id)!.slack;
// GitLab IDs of the people who connected GitLab (everyone but members).
const gitlabOf = (id: Person) => 100 + people.filter((p) => p.role !== "member").findIndex((p) => p.id === id);

interface Delivery {
  iid: number;
  title: string;
  labels: string[];
  dev: Person;
  requester?: Person;
  hubspot?: boolean;
  branch: "Main" | "Staging";
  notes: string;
  published?: Date;
  via?: "confirmed" | "auto";
  verifiedBy?: Person[];
  reported?: { by: Person; comment: string };
  thread?: Array<{ by: Person; body: string; at: Date }>;
}

const deliveries: Delivery[] = [
  {
    iid: 834,
    title: "Portal > Chamados > Mostrar o status do chamado em tempo real",
    labels: ["Type: Melhoria", "Product: Portal"],
    dev: "demo-carla",
    requester: "demo-fernanda",
    hubspot: true,
    branch: "Main",
    notes: "O status do chamado agora atualiza sozinho no portal do proprietário, sem precisar recarregar a página.",
    published: at(0, 10, 12),
    verifiedBy: ["demo-fernanda"],
  },
  {
    iid: 831,
    title: "Admin > Console > Convidar usuários em massa por planilha",
    labels: ["Type: Nova", "Product: Admin Console"],
    dev: "demo-bruno",
    requester: "demo-helena",
    branch: "Main",
    notes: "Agora é possível convidar vários usuários de uma vez enviando uma planilha. Os convites com e-mail inválido aparecem numa lista para correção.",
    published: at(0, 9, 40),
  },
  {
    iid: 829,
    title: "Produção - Bug: Baixa > Documentos > Ordenação por data invertida",
    labels: ["Type: Bug", "Product: Documentos"],
    dev: "demo-diego",
    requester: "demo-gabriel",
    hubspot: true,
    branch: "Main",
    notes: "A lista de documentos volta a mostrar os mais recentes primeiro.",
    published: at(1, 16, 5),
    verifiedBy: ["demo-gabriel", "demo-ana"],
  },
  {
    iid: 826,
    title: "Lize IA > Respostas citam a seção do manual usada",
    labels: ["Type: Melhoria", "Product: Lize IA"],
    dev: "demo-carla",
    branch: "Main",
    notes: "As respostas da Lize IA agora indicam a seção do manual em que se basearam, com link direto para ela.",
    published: at(1, 11, 30),
    via: "auto",
  },
  {
    iid: 823,
    title: "Admin > Preventivas > Lembrete por e-mail 7 dias antes da manutenção",
    labels: ["Type: Nova", "Product: Preventivas"],
    dev: "demo-bruno",
    requester: "demo-helena",
    branch: "Staging",
    notes: "Os responsáveis passam a receber um e-mail 7 dias antes de cada manutenção preventiva programada.",
    published: at(2, 15, 20),
  },
  {
    iid: 818,
    title: "Produção - Bug: Média > Vistorias > Data da vistoria aparece com um dia a menos",
    labels: ["Type: Bug", "Product: Vistorias"],
    dev: "demo-diego",
    requester: "demo-fernanda",
    hubspot: true,
    branch: "Staging",
    notes: "A data da vistoria agora aparece corretamente, sem o dia a menos para quem acessa de outros fusos.",
    published: at(3, 14, 0),
    reported: { by: "demo-fernanda", comment: "No relatório em PDF a data ainda sai com um dia a menos." },
    thread: [{ by: "demo-diego", body: "Vi aqui, o PDF usa outra formatação. Corrijo ainda hoje.", at: at(3, 16, 40) }],
  },
  {
    iid: 820,
    title: "Portal > Garantias > Filtrar garantias por sistema construtivo",
    labels: ["Type: Melhoria", "Product: Garantias"],
    dev: "demo-carla",
    requester: "demo-gabriel",
    branch: "Main",
    notes: "No portal, as garantias agora podem ser filtradas por sistema construtivo, como elétrica, hidráulica e impermeabilização.",
    published: at(4, 10, 45),
    verifiedBy: ["demo-gabriel"],
    thread: [
      { by: "demo-gabriel", body: "Testei com o empreendimento Jardins, tudo certo.", at: at(4, 13, 10) },
      { by: "demo-carla", body: "Valeu! Se aparecer algum sistema sem garantia, me avisa.", at: at(4, 13, 32) },
    ],
  },
  {
    iid: 815,
    title: "Admin > Manuais > Exportar manual em PDF com sumário clicável",
    labels: ["Type: Melhoria", "Product: Manuais"],
    dev: "demo-bruno",
    requester: "demo-helena",
    hubspot: true,
    branch: "Main",
    notes: "O PDF exportado do manual agora tem um sumário clicável que leva direto a cada capítulo.",
    published: at(5, 17, 10),
    verifiedBy: ["demo-helena"],
  },
  {
    iid: 812,
    title: "Produção - Bug: Alta > Chamados > Anexos não abrem no app iOS",
    labels: ["Type: Bug", "Product: Chamados"],
    dev: "demo-diego",
    requester: "demo-fernanda",
    hubspot: true,
    branch: "Main",
    notes: "Os anexos dos chamados voltam a abrir normalmente no aplicativo para iPhone.",
    published: at(6, 11, 20),
    verifiedBy: ["demo-fernanda", "demo-gabriel"],
  },
  // A draft still waiting for the dev: shows under "Precisa de atenção".
  {
    iid: 837,
    title: "Admin > Vistorias > Assinatura digital do proprietário na entrega",
    labels: ["Type: Nova", "Product: Vistorias"],
    dev: "demo-bruno",
    requester: "demo-helena",
    branch: "Staging",
    notes: "O proprietário agora pode assinar o termo de vistoria direto no celular, na hora da entrega.",
  },
];

await db().execute(sql`
  truncate table llm_audit_log, weight_reviews, verifications, comments, shipment_merge_requests,
    shipments, tickets, gitlab_events, account, session, verification, "user" restart identity cascade
`);

await db()
  .insert(user)
  .values(
    people.map((p) => ({ id: p.id, name: p.name, email: `${p.name.toLowerCase().replace(" ", ".")}@demo.shiplog`, emailVerified: true, role: p.role })),
  );
await db()
  .insert(account)
  .values([
    ...people.map((p) => ({ id: `${p.id}-slack`, userId: p.id, providerId: "slack", accountId: p.slack })),
    ...people
      .filter((p) => p.role !== "member")
      .map((p) => ({ id: `${p.id}-gitlab`, userId: p.id, providerId: "gitlab", accountId: String(gitlabOf(p.id)) })),
  ]);

const entry = (when: Date, event: string, data?: Record<string, unknown>): TimelineEntry =>
  data ? { at: when.toISOString(), event, data } : { at: when.toISOString(), event };

for (const [i, d] of deliveries.entries()) {
  const [t] = await db()
    .insert(tickets)
    .values({
      gitlabIssueId: 900_000 + d.iid,
      gitlabProjectId: 4242,
      projectPath: PROJECT,
      iid: d.iid,
      title: d.title,
      webUrl: `https://gitlab.com/${PROJECT}/-/work_items/${d.iid}`,
      labels: [...d.labels, `Branch: ${d.branch}`],
      nativeWeight: [1, 2, 3, 5][i % 4],
      assigneeGitlabIds: [gitlabOf(d.dev)],
      requesterRaw: d.requester ? people.find((p) => p.id === d.requester)!.name : null,
      requesterSlackId: d.requester ? slackOf(d.requester) : null,
      requesterSource: d.requester ? "template" : "none",
      hubspotUrls: d.hubspot ? [`https://app.hubspot.com/contacts/0000000/record/0-5/${50_000_000 + d.iid}`] : [],
      gitlabState: "opened",
      gitlabStatus: `Deployed ${d.branch}`,
    })
    .returning();

  const ready = d.published ? new Date(d.published.getTime() - 2 * 60_000) : at(0, 9, 5);
  const timeline: TimelineEntry[] = [entry(ready, "created")];
  if (d.published) timeline.push(entry(d.published, d.via === "auto" ? "auto_publish" : "confirm"));

  const verified = d.verifiedBy?.length && !d.reported;
  const [s] = await db()
    .insert(shipments)
    .values({
      ticketId: t.id,
      branch: d.branch,
      status: d.published ? "published" : "pending_confirmation",
      recipientUserId: d.dev,
      recipientGitlabId: gitlabOf(d.dev),
      notesDraft: d.notes,
      notesFinal: d.published ? d.notes : null,
      publishedVia: d.published ? (d.via ?? "confirmed") : null,
      publishedAt: d.published ?? null,
      pendingSince: d.published ? null : ready,
      verificationStatus: d.reported ? "issue_reported" : verified ? "verified" : "unverified",
      timeline,
      createdAt: ready,
    })
    .returning();

  for (const [n, by] of (d.verifiedBy ?? []).entries()) {
    const when = new Date(d.published!.getTime() + (n + 1) * 47 * 60_000);
    await db().insert(verifications).values({ shipmentId: s.id, userId: by, kind: "verified", createdAt: when, updatedAt: when });
  }
  if (d.reported) {
    const when = new Date(d.published!.getTime() + 90 * 60_000);
    const [c] = await db()
      .insert(comments)
      .values({ ticketId: t.id, shipmentId: s.id, authorUserId: d.reported.by, body: d.reported.comment, createdAt: when })
      .returning();
    await db()
      .insert(verifications)
      .values({ shipmentId: s.id, userId: d.reported.by, kind: "issue_reported", commentId: c.id, createdAt: when, updatedAt: when });
  }
  for (const c of d.thread ?? []) {
    await db().insert(comments).values({ ticketId: t.id, shipmentId: s.id, authorUserId: c.by, body: c.body, createdAt: c.at });
  }
}

console.log(`Seeded ${people.length} people and ${deliveries.length} deliveries into ${new URL(url).pathname.slice(1)}.`);
process.exit(0);
